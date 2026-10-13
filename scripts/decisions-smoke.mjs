import { parseArgs } from 'node:util';
import { createBridge, choice, noul, score, scoreLevels } from '../src/index.mjs';
import { requireCondition as check } from '../src/errors.mjs';
import { loadConfig, configuredProvider } from '../src/cli/config.mjs';

// Four bounded protocol checks; no prediction-quality assertion or stored response.
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
export async function runDecisionsSmoke(argv, env = process.env) {
    check(env.RUN_LIVE_TESTS === '1', 'Live inference requires RUN_LIVE_TESTS=1.', 'CONFIGURATION_ERROR');
    const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
        'env-file': { type: 'string' }, model: { type: 'string' }, 'base-url': { type: 'string' }, 'api-key-env': { type: 'string' },
    } });
    const overrides = { provider: 'openai-decisions', maxRetries: 0, timeoutMs: 30000 };
    for (const [flag, field] of [['model', 'model'], ['base-url', 'baseURL'], ['api-key-env', 'apiKeyEnv']]) {
        if (values[flag] !== undefined) overrides[field] = values[flag];
    }
    const loaded = await loadConfig({ env, envFile: values['env-file'], overrides });
    const provider = await configuredProvider(loaded);
    const bridge = createBridge({ provider, timeoutMs: 30000 });
    const summaries = [];
    const cases = [
        ['legacy', { state: { report: 'Export fails in Safari, but works in Chrome.' }, questions: {
            route: choice('Select a queue.', { engineering: 'Technical issues.', other: null }),
            browser: noul('Does the report describe a browser-specific failure?'),
            impact: score('Rate the impact.', ['Minor', 'Workaround available', 'Blocked']),
        } }],
        ['criteria', { state: 'An executed test failed.', questions: { failed: noul('Is a failed test reported?', {
            true: 'An executed test is reported as failed.', false: 'No failed executed test is reported.',
        }) } }],
        ['multimodal', { input: [{ type: 'text', text: 'This is a synthetic one-pixel image.' },
            { type: 'image', dataUrl: image, detail: 'low' }, { type: 'text', text: 'Evaluate visible content only.' }],
            safetyIdentifier: 'decision-protocol-smoke', questions: {
                visible: choice('Is an image supplied?', [{ value: true }, { value: false }]),
                detail: scoreLevels('Rate visible detail.', [{ label: 'Low' }, { label: 'High' }]),
            } }],
    ];
    for (const [label, request] of cases) {
        const result = await bridge.evaluate(request);
        summaries.push({ label, model: result.model, usage: result.meta.openaiDecisions.usage });
    }
    const { decision } = await provider.createDecision({ input: [{ role: 'user', content: 'The field is boolean true.' },
        { role: 'user', content: [{ type: 'input_text', text: 'Choose the matching typed value.' }] }], questions: [
        { type: 'predicate', instructions: 'Is a field value supplied?' },
        { type: 'choice', instructions: 'Select the field value.', choices: [
            { value: true, description: 'Boolean true.' }, { value: 'true', description: 'The string true.' },
        ] },
    ] });
    summaries.push({ label: 'native', model: decision.model, usage: decision.usage });
    return { passed: true, requests: summaries.length, checks: summaries };
}
