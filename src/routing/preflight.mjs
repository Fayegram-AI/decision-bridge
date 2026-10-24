// Execution refreshes may expose lazy targets skipped by an earlier cooldown.
import { abortError } from '../async.mjs';
import { eligible } from './eligibility.mjs';

/** Run inside the caller's work budget; inspection remains synchronous and offline. */
export async function refreshEligibility(state, request, call, signal, { direct } = {}) {
    const { registry, policy, operation, cooldowns } = state;
    while (true) {
        if (signal.aborted) throw abortError();
        const report = eligible(registry, policy, request, operation, call, cooldowns, { direct });
        const pending = [...report.verified, ...report.provisional].filter(id => !registry.get(id).isInitialized());
        if (!pending.length) return report;
        for (const id of pending) {
            if (signal.aborted) throw abortError();
            await registry.get(id).initialize(signal);
        }
        // Successful initialization is cached, bounding progress by the registry size.
        // Recheck capabilities and any cooldowns that expired while factories ran.
    }
}
