import { resolve, join } from 'node:path';
import { mkdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { DecisionError } from '../errors.mjs';
import { validateRequest } from '../validation.mjs';
import { decisionProfile } from './decisions.mjs';
import { validateConfig, KEY_ENVS } from './config-validation.mjs';
import { OPENAI_DEFAULT_MODEL } from '../providers/openai-profile.mjs';
import { validateExtractionRequest } from '../extraction/validation.mjs';

/** Templates are honest edit points for an unknown protocol, never fake inference. */
function providerTemplate(kind) {
    const helper = kind === 'decision' ? 'defineDecisionProvider' : 'defineGenerativeProvider';
    const entry = kind === 'decision' ? 'decision' : 'generative';
    return `import { DecisionError } from '@fayegram-ai/decision-bridge';
import { ${helper} } from '@fayegram-ai/decision-bridge/custom/${entry}';

// Connect your service here. options contains configured JSON plus selected apiKey/model.
export function createProvider(options = {}) {
    return ${helper}({
        name: 'my-${kind}-provider',
        ...(options.model ? { defaultModel: options.model } : {}),
        // Declare new capabilities/preflight only after implementing their wire mapping.
        async evaluate(request, { signal } = {}) {
            void request; void signal;
            // Return canonical model, answers, usage and optional metadata; respect signal.
            throw new DecisionError('Connect this provider to your service before evaluation.',
                { code: 'CONFIGURATION_ERROR' });
        },
    });
}
`;
}

export async function initialize(directory, config, native = false, moduleBase = process.cwd()) {
    const custom = ['custom-decision', 'custom-generative'].includes(config.provider);
    const generateModule = custom && !config.module && !config.preset;
    const defaultKey = KEY_ENVS[config.preset ?? config.provider] ?? 'CUSTOM_PROVIDER_API_KEY';
    const template = validateConfig({ ...config, $schema: './decision.config.schema.json',
        apiKeyEnv: config.apiKeyEnv ?? defaultKey,
        ...(generateModule ? { module: './provider.mjs' } : {}),
        ...(config.module ? { module: resolve(moduleBase, config.module) } : {}),
        ...(config.provider === 'jev' && config.model === undefined ? { model: 'jev-latest' } : {}),
        ...(config.provider === 'openai-decisions' && config.model === undefined ? { model: OPENAI_DEFAULT_MODEL } : {}),
        ...(custom && config.model === undefined ? { model: 'YOUR_MODEL' } : {}),
    }, { complete: true });
    const request = config.provider === 'cloudflare-extraction' ? {
        state: 'Invoice total: 1080 USD. Due date: 2026-11-01.',
        fields: { total: { type: 'number', unit: 'USD' }, due_date: { type: 'date' } },
    } : { state: "ModuleNotFoundError: No module named 'pytest'", questions: {
        category: { type: 'choice', instructions: 'Classify the failure using only the supplied evidence.',
            criteria: { dependency: 'A required package or module is unavailable.',
                network: 'A network operation failed.', assertion: 'A test assertion failed.', unknown: 'Insufficient evidence.' } },
        missing_dependency: { type: 'noul', instructions: 'Does this indicate a missing Python package?' },
    } };
    const profile = decisionProfile(config.provider);
    const sample = config.provider === 'cloudflare-extraction' ? validateExtractionRequest(request, { model: template.model })
        : native ? profile.native(profile.encode(validateRequest(request, template.model)), profile.options(template)) : request;
    // OpenAI request files inherit selection from configuration, including after later edits.
    const generated = { ...sample };
    if (config.provider === 'openai-decisions') delete generated.model;
    const schema = await readFile(new URL('../../schemas/decision.config.schema.json', import.meta.url), 'utf8');
    const files = {
        'decision.config.json': JSON.stringify(template, null, 2) + '\n',
        'decision.config.schema.json': schema,
        'request.json': JSON.stringify(generated, null, 2) + '\n',
        '.env.example': `${template.apiKeyEnv}=replace_with_your_api_key\n` +
            (['cloudflare-decisions', 'cloudflare-extraction'].includes(config.provider) ? 'CLOUDFLARE_ACCOUNT_ID=replace_with_your_account_id\n' : ''),
        '.gitignore': '.env\n.env.*\n!.env.example\nnode_modules/\n*.tmp\n',
        ...(generateModule ? { 'provider.mjs': providerTemplate(config.provider === 'custom-decision' ? 'decision' : 'generative') } : {}),
    };
    try { await mkdir(directory, { recursive: true }); }
    catch { throw new DecisionError('Cannot create initialization directory.', { code: 'IO_ERROR' }); }
    for (const name of Object.keys(files)) {
        try { await lstat(join(directory, name)); throw new DecisionError('Initialization would overwrite existing files.', { code: 'IO_ERROR' }); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const created = [];
    try {
        for (const [name, content] of Object.entries(files)) {
            await writeFile(join(directory, name), content, { flag: 'wx', mode: 0o600 });
            created.push(name);
        }
    } catch {
        await Promise.all(created.map(name => unlink(join(directory, name)).catch(() => {})));
        throw new DecisionError('Cannot initialize files; existing files were preserved.', { code: 'IO_ERROR' });
    }
    return { initialized: true, directory, files: Object.keys(files), provider: template.provider,
        ...(template.preset ? { preset: template.preset } : {}) };
}
