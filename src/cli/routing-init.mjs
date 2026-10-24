// Routing templates use the same exclusive creation and rollback policy as v1 init.
import { mkdir, readFile, writeFile, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DecisionError } from '../errors.mjs';
import { validateRoutingConfig } from './routing-config.mjs';
import { KEY_ENVS } from './config-validation.mjs';

export async function initializeRouting(directory, input, extracting, moduleBase) {
    const config = validateRoutingConfig(input.schemaVersion === 2 ? input : {
        schemaVersion: 2, defaultRoute: 'auto', routes: {
            auto: { policy: 'deterministic', candidates: ['primary'] },
            primary: { operation: extracting ? 'extraction' : 'decision', config: input },
        },
    });
    config.$schema = './decision.config.schema.json';
    const keys = new Set();
    let cloudflare = false;
    for (const [id, route] of Object.entries(config.routes)) {
        if (id === 'auto') continue;
        const provider = route.config;
        const key = provider.apiKeyEnv ?? KEY_ENVS[provider.preset ?? provider.provider];
        if (key && !provider.noAuth) { provider.apiKeyEnv = key; keys.add(key); }
        if (provider.module) provider.module = resolve(moduleBase, provider.module);
        if (provider.provider.startsWith('cloudflare-')) cloudflare = true;
    }
    const request = extracting ? { state: 'Invoice total: 1080 USD.', fields: { total: { type: 'number', unit: 'USD' } } }
        : { state: 'ModuleNotFoundError: No module named pytest', questions: {
            missing_dependency: { type: 'noul', instructions: 'Does this indicate a missing Python package?' },
        } };
    const files = {
        'decision.config.json': JSON.stringify(config, null, 2) + '\n',
        'decision.config.schema.json': await readFile(new URL('../../schemas/decision.config.schema.json', import.meta.url), 'utf8'),
        'request.json': JSON.stringify(request, null, 2) + '\n',
        '.env.example': [...keys].map(key => `${key}=replace_with_your_api_key\n`).join('') +
            (cloudflare ? 'CLOUDFLARE_ACCOUNT_ID=replace_with_your_account_id\n' : ''),
        '.gitignore': '.env\n.env.*\n!.env.example\nnode_modules/\n*.tmp\n',
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
            await writeFile(join(directory, name), content, { flag: 'wx', mode: 0o600 }); created.push(name);
        }
    } catch {
        await Promise.all(created.map(name => unlink(join(directory, name)).catch(() => {})));
        throw new DecisionError('Cannot initialize routing files; existing files were preserved.', { code: 'IO_ERROR' });
    }
    return { initialized: true, directory, files: Object.keys(files), schemaVersion: 2 };
}
