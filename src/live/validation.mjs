import { DecisionError, requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { fields, validateDecisionQuestions, validateDecisionInput } from '../providers/decisions-input.mjs';
import { validateDecisionResponse } from '../providers/decisions-validation.mjs';

export const TRANSCRIPTS = ['session.input_transcript.delta', 'session.output_transcript.delta'];
const text = value => typeof value === 'string' && value.length > 0;
const nullableId = value => value === null || text(value);

export function validateLiveConfiguration(input, { resolved = false, allowUnknown = false } = {}) {
    const config = cloneJson(input, 'Live Decisions configuration');
    fields(config, ['delegation', 'triggers'], [], 'Live configuration', 'VALIDATION_ERROR', allowUnknown);
    if (config.delegation !== undefined) {
        fields(config.delegation, ['type', 'decisions', 'acknowledgement_delay_ms'],
            ['type', ...(resolved ? ['decisions'] : [])], 'delegation', 'VALIDATION_ERROR', allowUnknown);
        check(config.delegation.type === 'decisions', 'This controller configures Decisions delegation.');
        const delay = config.delegation.acknowledgement_delay_ms;
        check(delay === undefined || Number.isInteger(delay) && delay >= 0 && delay <= 800, 'Invalid acknowledgement delay.');
        const decisions = config.delegation.decisions;
        if (decisions !== undefined) {
            fields(decisions, ['model', 'questions'], [], 'delegation decisions', 'VALIDATION_ERROR', allowUnknown);
            check(decisions.model === undefined || (allowUnknown ? typeof decisions.model === 'string' && decisions.model.trim()
                : decisions.model === 'gpt-6-luna'), 'Unsupported Live Decisions model.');
            if (decisions.questions !== undefined) validateDecisionQuestions(decisions.questions, { allowUnknown });
        }
    }
    if (config.triggers !== undefined) {
        check(Array.isArray(config.triggers), 'triggers must be an array.');
        for (const trigger of config.triggers) {
            fields(trigger, ['type', 'event_type', 'decisions'], ['type', 'event_type', 'decisions'], 'trigger', 'VALIDATION_ERROR', allowUnknown);
            check(trigger.type === 'decisions' && TRANSCRIPTS.includes(trigger.event_type), 'Invalid Decisions trigger.');
            fields(trigger.decisions, ['questions'], ['questions'], 'trigger decisions', 'VALIDATION_ERROR', allowUnknown);
            validateDecisionQuestions(trigger.decisions.questions, { allowUnknown });
        }
    }
    return freezeJson(config);
}

function item(input, created = false) {
    validateDecisionInput([input], { live: true, pairTools: false, allowUnknown: created });
    check(created ? text(input.id) : input.id === undefined || input.id === null || text(input.id), 'Invalid item ID.');
}

export function validateLiveCommand(input) {
    const command = cloneJson(input, 'Live command');
    check(isRecord(command) && typeof command.type === 'string', 'Live command requires a type.');
    check(command.event_id === undefined || command.event_id === null || text(command.event_id), 'Invalid client event ID.');
    const base = ['type', 'event_id'];
    if (command.type === 'session.update') {
        fields(command, [...base, 'session'], ['type', 'session'], 'session update');
        validateLiveConfiguration(command.session);
    } else if (command.type === 'decision.item.create') {
        fields(command, [...base, 'item'], ['type', 'item'], 'item create');
        item(command.item);
    } else if (command.type === 'decision.item.delete') {
        fields(command, [...base, 'item_id'], ['type', 'item_id'], 'item delete');
        check(text(command.item_id), 'Item delete requires an ID.');
    } else if (command.type === 'decision.create') {
        fields(command, base, base, 'decision create');
        check(text(command.event_id), 'Manual evaluation requires an event ID.');
    } else {
        fields(command, [...base, 'delegation_id', 'content'], ['type', 'delegation_id', 'content'], 'commentary');
        check(command.type === 'session.commentary.append' && nullableId(command.delegation_id) &&
            typeof command.content === 'string', 'Invalid commentary command.');
    }
    return freezeJson(command);
}

/** Only inspect the Decisions subset of full Live session snapshots. */
export function configurationFromSession(session) {
    const result = {};
    if (session.delegation?.type === 'decisions') result.delegation = session.delegation;
    if (Array.isArray(session.triggers)) result.triggers = session.triggers.filter(trigger => trigger.type === 'decisions');
    return validateLiveConfiguration(result, { resolved: true, allowUnknown: true });
}

export function validateLiveEvent(input) {
    // Nested request validators are reused below, but server content must leave
    // this boundary as a response error. Unknown exceptions never expose text.
    try { return validateServerEvent(input); }
    catch (error) {
        if (error instanceof DecisionError) {
            if (error.code === 'INVALID_RESPONSE') throw error;
            throw new DecisionError(error.message, { ...error.toJSON(), code: 'INVALID_RESPONSE' });
        }
        throw new DecisionError('Invalid Live server event.', { code: 'INVALID_RESPONSE' });
    }
}

function validateServerEvent(input) {
    const event = cloneJson(input, 'Live event', 'INVALID_RESPONSE');
    const invalid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
    invalid(isRecord(event) && text(event.type) && text(event.event_id), 'Live server events require type and event_id.');
    invalid(event.client_event_id === undefined || text(event.client_event_id), 'Invalid acknowledgement correlation ID.');
    if (event.type === 'decision.event') {
        invalid(nullableId(event.delegation_id) && nullableId(event.trigger_id) && nullableId(event.source_event_id) &&
            (event.source_event_type === null || TRANSCRIPTS.includes(event.source_event_type)) &&
            event.event?.type === 'decision.completed', 'Invalid Decision event envelope.');
        validateDecisionResponse(event.event.decision, undefined, { allowRefusals: true });
    } else if (TRANSCRIPTS.includes(event.type)) {
        invalid(typeof event.delta === 'string' && Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms) &&
            event.start_ms >= 0 && event.end_ms >= event.start_ms, 'Invalid transcript delta.');
    } else if (['session.started', 'session.created', 'session.updated', 'session.closed'].includes(event.type)) {
        invalid(isRecord(event.session), 'Missing Live session snapshot.');
        configurationFromSession(event.session);
    } else if (event.type === 'decision.item.created') item(event.item, true);
    else if (event.type === 'decision.item.deleted') invalid(text(event.item_id), 'Missing deleted item ID.');
    else if (event.type === 'session.delegation.created') invalid(isRecord(event.delegation) && text(event.delegation.id) &&
        ['client', 'responses', 'decisions'].includes(event.delegation.target), 'Invalid delegation metadata.');
    else if (event.type === 'error') invalid(isRecord(event.error) && text(event.error.code) && text(event.error.type) &&
        (event.error.client_event_id === undefined || text(event.error.client_event_id)), 'Invalid Live error.');
    return freezeJson(event);
}
