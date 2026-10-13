// Integrate this handler into an existing Worker with a configured AI binding.
// Authorize callers and cap incoming HTTP bodies at 13 MiB before this handler.
// For Omni, select clef-omni and use its configured budget (36 MiB by default).
// SDK preflight runs after JSON parsing; it does not protect unbounded HTTP intake.
import { createBridge, CloudflareDecisionsProvider, publicError } from '../src/index.mjs';

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') return new Response('Use POST with a common decision request.', { status: 405 });
        try {
            const provider = new CloudflareDecisionsProvider({ transport: 'binding', ai: env.AI, model: 'clef' });
            const bridge = createBridge({ provider });
            const result = await bridge.evaluate(await request.json(), { signal: request.signal });
            return Response.json(result);
        } catch (error) {
            const details = publicError(error);
            const invalid = ['VALIDATION_ERROR', 'UNSUPPORTED_CAPABILITY', 'REQUEST_TOO_LARGE'].includes(details.code);
            return Response.json({ error: details }, { status: invalid ? 400 : 502 });
        }
    },
};
