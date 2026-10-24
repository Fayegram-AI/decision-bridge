// CLI-only file IO and terminal clarification; never imported by the SDK entry point.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { DecisionError, requireCondition as check, publicError } from '../errors.mjs';
import { createDecisionRouter, createExtractionRouter } from '../routing/index.mjs';
import { routerInternals } from '../routing/router.mjs';
import { clarificationGate } from '../routing/budget.mjs';
import { routingOptions } from './routing-config.mjs';
import { readJson, readJsonLines, createWriter, assertDistinctFiles } from './io.mjs';
import { mapOrdered } from './ordered.mjs';
import { initializeRouting } from './routing-init.mjs';

function promptHandler(stdin, stderr) {
    return (question, { signal }) => new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DecisionError('Clarification cancelled.', { code: 'ABORTED' })); return; }
        // EOF persists across batch rows; a new readline interface cannot observe it again.
        if (stdin.readableEnded || stdin.destroyed) { resolve({ action: 'cancel' }); return; }
        const input = createInterface({ input: stdin, terminal: false });
        let finished = false;
        const close = () => finish({ action: 'cancel' });
        const aborted = () => finish(undefined, new DecisionError('Clarification cancelled.', { code: 'ABORTED' }));
        function finish(value, error) {
            if (finished) return;
            finished = true;
            signal.removeEventListener('abort', aborted);
            input.removeListener('close', close);
            input.close(); stdin.pause();
            if (error) reject(error); else resolve(value);
        }
        input.once('close', close);
        input.once('error', () => finish(undefined, new DecisionError('Cannot read clarification.', { code: 'IO_ERROR' })));
        input.once('line', line => {
            const value = line.trim();
            if (value === 's' && question.selectorAvailable) finish({ action: 'use-selector' });
            else if (/^[1-9]\d*$/.test(value) && Number(value) <= question.candidates.length) finish({ action: 'select', route: question.candidates[Number(value) - 1].id });
            else if (value === 'c' || !value) finish({ action: 'cancel' });
            else finish(undefined, new DecisionError('Invalid route selection.', { code: 'VALIDATION_ERROR' }));
        });
        signal.addEventListener('abort', aborted, { once: true });
        stderr.write('Multiple eligible routes remain. Choose a route for this request:\n' +
            question.candidates.map((item, i) => `  ${i + 1}. ${item.id}\n`).join('') +
            (question.selectorAvailable ? '  s. Use configured decision selector\n' : '') + '  c. Cancel\nSelection: ');
        stdin.resume();
    });
}

export async function runRoutingCli(command, positionals, values, loaded, context) {
    const { stdin, stdout, stderr, cwd, signal, extracting, scrub } = context;
    check(['init', 'inspect', 'validate', 'evaluate', 'batch'].includes(command), 'Routing supports init, inspect, validate, evaluate and batch.', 'USAGE_ERROR');
    check(!values.native, 'Routing uses the common decision request or extraction request schema.', 'USAGE_ERROR');
    check(!(values.interactive && values['no-interactive']), 'Choose one interactive setting.', 'USAGE_ERROR');
    const path = values.input ?? positionals[1];
    check(command === 'init' || path, 'Routing commands require an explicit request file or -.', 'USAGE_ERROR');
    if (command === 'init') {
        const result = await initializeRouting(resolve(cwd, positionals[1] ?? '.'), loaded.config, extracting, loaded.moduleBase);
        stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0;
    }
    const tty = !!stdin.isTTY && !!stderr.isTTY && path !== '-';
    check(!values.interactive || tty, '--interactive requires terminal stdin/stderr and a request file.', 'USAGE_ERROR');
    const interactive = tty && !values['no-interactive'] && !values['no-routing-prompt'];
    const options = routingOptions(loaded);
    if (interactive) options.onAmbiguity = promptHandler(stdin, stderr);
    const router = (extracting ? createExtractionRouter : createDecisionRouter)(options);
    const call = { signal, ...(values.route === undefined ? {} : { route: values.route }), clarify: interactive };
    const io = { stdin, cwd, signal, maxInputBytes: 64 * 1024 * 1024 };
    if (values.output && values.output !== '-' && path !== '-') await assertDistinctFiles(path, values.output, cwd);
    const writer = await createWriter({ output: values.output, force: values.force, stdout, cwd, signal });
    try {
        if (command === 'inspect' || command === 'validate') {
            const report = router.inspect(await readJson(path, io), call);
            if (command === 'validate') check(report.outcome !== 'impossible', 'No route can execute this request.', 'NO_ELIGIBLE_ROUTE');
            await writer.write(JSON.stringify({ ...(command === 'validate' ? { valid: true } : {}), ...report }, null, values.compact ? 0 : 2) + '\n');
        } else if (command === 'evaluate') {
            const result = await router[extracting ? 'extract' : 'evaluate'](await readJson(path, io), call);
            await writer.write(JSON.stringify(result, null, values.compact ? 0 : 2) + '\n');
        } else {
            const runtime = routerInternals.get(router);
            const gate = clarificationGate();
            let failed = false;
            let order = 0;
            async function execute(row) {
                const index = order++;
                try {
                    if (row.error) return { line: row.line, ok: false, error: row.error };
                    const ticket = await runtime.prepare(row.input, call, { wait: () => gate.wait(index), done: () => gate.done(index) });
                    return { line: row.line, ok: true, result: await runtime.execute(ticket) };
                } catch (error) { return { line: row.line, ok: false, error: scrub(publicError(error)) }; }
                finally { gate.done(index); }
            }
            for await (const record of mapOrdered(readJsonLines(path, io), execute, { concurrency: Number(values.concurrency ?? 4), signal })) {
                if (!record.ok) failed = true;
                await writer.write(JSON.stringify(record) + '\n');
            }
            await writer.finish(); return signal.aborted ? 130 : failed ? 1 : 0;
        }
        await writer.finish(); return 0;
    } catch (error) { await writer.abort(); throw error; }
}
