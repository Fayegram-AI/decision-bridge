import { DecisionError, requireCondition as check, publicError } from '../errors.mjs';
import { validateLiveCommand, validateLiveConfiguration, validateLiveEvent } from '../live/validation.mjs';
import { createLiveState } from '../live/state.mjs';
import { assertDistinctFiles, createWriter, readJson, readJsonLines } from './io.mjs';

/** Offline protocol tools deliberately do not load provider configuration or keys. */
export async function runLiveCli(positionals, values, context) {
    const [command, positional] = positionals;
    check(['validate', 'replay'].includes(command) && positionals.length <= 2, 'Use live validate or live replay.', 'USAGE_ERROR');
    check(Object.keys(values).every(key => ['input', 'output', 'force', 'pretty', 'compact', 'kind'].includes(key)),
        'Unsupported option for offline Live tools.', 'USAGE_ERROR');
    check(!(values.input && positional), 'Supply one Live input file.', 'USAGE_ERROR');
    check(!(values.pretty && values.compact), 'Choose pretty or compact output.', 'USAGE_ERROR');
    check(!values.force || (values.output && values.output !== '-'), '--force requires file output.', 'USAGE_ERROR');
    const path = values.input ?? positional;
    check(path, 'Live tools require an explicit input file or -.', 'USAGE_ERROR');
    if (values.output && values.output !== '-' && path !== '-') await assertDistinctFiles(path, values.output, context.cwd);
    const validators = { config: validateLiveConfiguration, command: validateLiveCommand, event: validateLiveEvent };
    check(command !== 'validate' || Object.hasOwn(validators, values.kind ?? ''), 'Live validation requires --kind config, command or event.', 'USAGE_ERROR');
    check(command !== 'replay' || values.kind === undefined, '--kind applies only to validation.', 'USAGE_ERROR');
    const writer = await createWriter({ ...context, output: values.output, force: values.force });
    try {
        if (command === 'validate') {
            const input = await readJson(path, context);
            try { validators[values.kind](input); }
            catch (error) {
                // An offline event file is caller input, even though the SDK's
                // event validator correctly describes malformed server responses.
                if (values.kind === 'event' && error instanceof DecisionError && error.code === 'INVALID_RESPONSE') {
                    throw new DecisionError(error.message, { ...error.toJSON(), code: 'VALIDATION_ERROR', source: 'client' });
                }
                throw error;
            }
            await writer.write(JSON.stringify({ valid: true, operation: 'live', kind: values.kind,
                validationScope: 'structure' }, null, values.compact ? 0 : 2) + '\n');
            await writer.finish();
            return 0;
        }
        const state = createLiveState();
        let failed = false;
        for await (const row of readJsonLines(path, context)) {
            let record;
            try {
                if (row.error) { failed = true; record = { line: row.line, ok: false, error: row.error }; }
                else {
                    const input = row.input;
                    check(input && typeof input === 'object' && Object.keys(input).length === 2 &&
                        Object.hasOwn(input, 'event') && ['client', 'server'].includes(input.direction), 'Replay requires direction and event.');
                    let event;
                    if (input.direction === 'client') {
                        const command = validateLiveCommand(input.event);
                        state.observeClient(command);
                        event = { type: 'command', eventType: command.type, ...(command.event_id ? { eventId: command.event_id } : {}) };
                    } else event = state.accept(validateLiveEvent(input.event)) ?? { type: 'ignored', eventType: input.event.type };
                    record = { line: row.line, ok: true, event };
                }
            } catch (error) { failed = true; record = { line: row.line, ok: false, error: publicError(error) }; }
            await writer.write(JSON.stringify(record) + '\n');
        }
        await writer.finish();
        return failed ? 1 : 0;
    } catch (error) { await writer.abort(); throw error; }
}
