import { freezeJson } from '../validation.mjs';
import { requireCondition as check } from '../errors.mjs';
import { validateDecisionResponse } from '../providers/decisions-validation.mjs';
import { TRANSCRIPTS, configurationFromSession, validateLiveConfiguration } from './validation.mjs';
import { openaiError } from '../providers/openai-errors.mjs';

/** Bounded correlation history. Evicted sources become unmatched, never guessed. */
export function createLiveState({ configuration, maxHistory = 4096 } = {}) {
    let config = configuration === undefined ? undefined : validateLiveConfiguration(configuration);
    let generation = 0;
    let sequence = 0;
    let lostConfigurationHistory = false;
    let closed = false;
    const sources = new Map();
    const delegations = new Map();
    const seen = new Map();
    const pendingConfigurations = new Map();
    const latest = new Map();
    function remember(map, key, value) {
        map.set(key, value);
        if (map.size > maxHistory) map.delete(map.keys().next().value);
    }
    function questionsFor(type) {
        if (!config || pendingConfigurations.size || lostConfigurationHistory) return undefined;
        if (type === 'delegation') return config.delegation?.decisions.questions;
        const matches = config.triggers?.filter(trigger => trigger.event_type === type) ?? [];
        return matches.length === 1 ? matches[0].decisions.questions : undefined;
    }
    function clear() {
        closed = true;
        config = undefined;
        lostConfigurationHistory = false;
        for (const map of [sources, delegations, seen, pendingConfigurations, latest]) map.clear();
    }
    return {
        clear,
        observeClient(command) {
            check(!closed, 'Live session is closed.', 'CONNECTION_CLOSED');
            if (command.type === 'session.update') {
                // Offline logs may omit optional IDs. Without one no acknowledgement
                // can prove which update completed; do not guess a source snapshot.
                if (!command.event_id) { lostConfigurationHistory = true; return; }
                // An evicted unresolved update can still take effect upstream. Retain
                // uncertainty even after all remaining IDs have been acknowledged.
                if (!pendingConfigurations.has(command.event_id) && pendingConfigurations.size >= maxHistory) lostConfigurationHistory = true;
                remember(pendingConfigurations, command.event_id, true);
            }
        },
        abandon(command) {
            // Do not assume a timed-out update failed server-side. Its effect is unknown
            // until a resolved snapshot arrives, so source correlation stays conservative.
            // A correlated acknowledgement/rejection already removed this marker;
            // known rejection leaves the previous accepted configuration intact.
            if (command.type === 'session.update' && pendingConfigurations.has(command.event_id)) config = undefined;
        },
        accept(event) {
            check(!closed, 'Live session is closed.', 'CONNECTION_CLOSED');
            if (seen.has(event.event_id)) return freezeJson({ type: 'duplicate', eventId: event.event_id, eventType: event.type });
            remember(seen, event.event_id, true);
            const base = { eventId: event.event_id, eventType: event.type };
            if (['session.created', 'session.updated'].includes(event.type)) {
                config = configurationFromSession(event.session);
                generation++;
                if (event.client_event_id) pendingConfigurations.delete(event.client_event_id);
                return freezeJson({ type: 'configuration', ...base, configuration: config, generation });
            }
            if (TRANSCRIPTS.includes(event.type)) {
                const snapshot = { type: event.type, sequence: ++sequence, generation,
                    questions: questionsFor(event.type) };
                remember(sources, event.event_id, snapshot);
                return freezeJson({ type: 'transcript', ...base, direction: event.type === TRANSCRIPTS[0] ? 'input' : 'output',
                    delta: event.delta, sequence: snapshot.sequence });
            }
            if (event.type === 'session.delegation.created' && event.delegation.target === 'decisions') {
                remember(delegations, event.delegation.id, { generation, questions: questionsFor('delegation') });
                return freezeJson({ type: 'delegation', ...base, delegationId: event.delegation.id });
            }
            if (event.type === 'decision.event') {
                // Mixed origins are observable but cannot establish one trustworthy snapshot.
                const triggerOrigin = event.delegation_id === null && event.trigger_id !== null &&
                    event.source_event_id !== null && event.source_event_type !== null;
                const delegationOrigin = event.delegation_id !== null && event.trigger_id === null &&
                    event.source_event_id === null && event.source_event_type === null;
                const observedSource = triggerOrigin ? sources.get(event.source_event_id) : undefined;
                const source = observedSource?.type === event.source_event_type ? observedSource : undefined;
                const snapshot = source ?? (delegationOrigin ? delegations.get(event.delegation_id) : undefined);
                let matched = !!snapshot?.questions;
                let reason = 'source_or_configuration_unavailable';
                const decision = validateDecisionResponse(event.event.decision, undefined, { allowRefusals: true });
                if (matched) {
                    try { validateDecisionResponse(decision, { questions: snapshot.questions }, { allowRefusals: true }); }
                    catch { matched = false; reason = 'configuration_mismatch'; }
                }
                let stale = false;
                // Transcript order is known even when the question snapshot is not.
                // Only an observed ID with the same direction can advance that order.
                if (source) {
                    stale = source.sequence <= (latest.get(source.type) ?? -1);
                    if (!stale) latest.set(source.type, source.sequence);
                }
                if (delegationOrigin) delegations.delete(event.delegation_id);
                return freezeJson({ type: 'decision', ...base, decision,
                    correlation: { matched, stale, sourceEventId: event.source_event_id, sourceEventType: event.source_event_type,
                        delegationId: event.delegation_id, triggerId: event.trigger_id,
                        ...(matched ? { generation: snapshot.generation } : { reason }) } });
            }
            if (event.type === 'error') {
                const hint = event.error.type === 'rate_limit_error' ? 429 : 400;
                // Live supplies protocol errors, not an HTTP response/status.
                const { status: _status, ...error } = openaiError({ error: event.error }, hint).toJSON();
                const clientEventId = event.error.client_event_id ?? event.client_event_id;
                if (clientEventId) pendingConfigurations.delete(clientEventId);
                return freezeJson({ type: 'error', ...base, error, ...(clientEventId ? { clientEventId } : {}) });
            }
            if (event.type === 'session.closed') {
                clear();
                return freezeJson({ type: 'closed', ...base });
            }
            if (['decision.item.created', 'decision.item.deleted'].includes(event.type)) {
                return freezeJson({ type: 'item', ...base, ...(event.item ? { item: event.item } : { itemId: event.item_id }) });
            }
            return undefined;
        },
    };
}
