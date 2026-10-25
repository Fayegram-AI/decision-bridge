# Live Decisions

Requires **0.1.3 or later**. See [version availability](../README.md#version-availability)
and [installation](GETTING_STARTED.md#install-into-your-application).

Use `@fayegram-ai/decision-bridge/live` with a GPT-Live connection your application has
opened. Your application handles authentication, audio and reconnection. The controller
sends Decisions commands, handles acknowledgements, and matches results to their source
events when enough information is available. It makes no additional HTTP inference
calls.

```javascript
import { createLiveDecisions } from '@fayegram-ai/decision-bridge/live';

const live = createLiveDecisions({ transport: {
    send(event) { connection.send(JSON.stringify(event)); },
    subscribe(listener) {
        const message = event => listener({ kind: 'event', event: JSON.parse(event.data) });
        const closed = () => listener({ kind: 'close' });
        const failed = () => listener({ kind: 'error' });
        connection.addEventListener('message', message);
        connection.addEventListener('close', closed);
        connection.addEventListener('error', failed);
        return () => {
            connection.removeEventListener('message', message);
            connection.removeEventListener('close', closed);
            connection.removeEventListener('error', failed);
        };
    },
} });

live.subscribe(event => {
    if (event.type === 'decision') {
        console.log(event.decision, event.correlation);
    }
});
await live.configure({
    delegation: { type: 'decisions', decisions: {
        model: 'gpt-6-luna',
        questions: [{ type: 'predicate', name: 'ready', instructions: 'Is the requested action fully specified?' }],
    } },
});
```

The connection must already support the required Live events and Decisions
permissions. Start the session with Decisions delegation if it will delegate to
Decisions; Live does not allow changing the delegation type after startup.
`transport.subscribe` receives a listener for `{ kind: 'event',
event }`, `{ kind: 'close' }`, and `{ kind: 'error' }` notifications and must
return an unsubscribe function. `send` may return a promise. Dispose the
controller before replacing a connection; disposal does not close the connection.

## Commands and acknowledgements

| Method | Completion |
| --- | --- |
| `configure(configuration, options?)` | Matching `session.updated` acknowledgement |
| `createItem(item, options?)` | Matching `decision.item.created` acknowledgement |
| `deleteItem(itemId, options?)` | Matching `decision.item.deleted` acknowledgement |
| `requestDecision(options?)` | Submission receipt, not an inference-result promise |
| `appendCommentary(content, { delegationId, ...options }?)` | Submission receipt, not a speech-completion promise |
| `subscribe(observer)` | Returns an unsubscribe function |
| `dispose()` | Cancels pending waits and detaches owned listeners |

Configuration accepts Decisions `delegation` and transcript `triggers`. Each
trigger specifies `type: 'decisions'`, `event_type` as input or output transcript
delta, and `decisions: { questions }`. Trigger arrays replace the trigger list;
an empty list disables them. Omitted fields preserve server configuration.
Questions use the native predicate/choice/score representation.

Decision items are user messages containing text, images, or `input_json` parts.
Images use embedded data URLs or publicly accessible HTTP(S) URLs. JSON
`data` accepts an object or array of objects. Questions also accept ordered
`input_text`, `input_image` and `input_json` instruction parts, using the
[native content contract](OPENAI_DECISIONS.md#json-and-question-content).
These forms are validated in commands, acknowledgements and session snapshots.
Live items remain user messages and accept no cache controls.
Item creation appends evidence for later evaluations; it does
not itself request evaluation. IDs are generated uniquely for commands.

An application can execute a selected action, append its confirmed outcome with
`createItem`, wait for acknowledgement, then submit commentary. The controller
does not execute application actions. Commentary is forwarded with the explicit
delegation ID or null; any service rejection is reported as an error event.

## Results and correlation

Completed native decisions arrive as `type: 'decision'` notifications containing
the full model, ordered answers and usage. Native refusal answers are preserved.

`correlation` contains `matched`, `stale`, source event ID/type, delegation ID, trigger
ID and a configuration generation when known. Match quality describes how well a result
can be linked to its source, not how accurate the model's answer is.

- Transcript fragments are tracked in delivery order separately for input and
  output. Results can arrive out of order; older/equal source results are stale.
  A newer result from an observed source makes older results stale even when its
  configuration cannot be matched. An unknown source or conflicting direction
  cannot advance the observed order.
- Configuration becomes active after acknowledgement. Sources observed during
  an in-flight or unresolved update remain unmatched.
- A rejected update preserves the last acknowledged configuration. If unresolved
  update IDs are evicted from history, future sources stay unmatched for this
  controller's lifetime. Attach a new controller with a known accepted snapshot
  to restore correlation after losing that history.
- A known delegation or transcript source carries its question snapshot. Missing
  or evicted source/configuration history remains observable and unmatched.
- Duplicate server event IDs produce `duplicate` notifications within retained
  history. Delegation results consume their source snapshot; repeated results
  cannot become newly matched work.
- Completion events may omit manual request IDs, so a submission receipt alone
  cannot associate a later result with that request.
- Unrelated events do not enter the Decisions state machine.

Only apply application actions when your own policy accepts the result and its
correlation. A supplied starting `configuration` asserts that the application
already knows the connection's accepted Decisions configuration.

## Resources and failures

By default, commands have a 30-second deadline. The controller allows 128 pending
operations, keeps 4096 history entries per correlation map, and limits each command or
event to 8 MiB (configurable through 64 MiB). These limits control local resource use;
the service applies its own quotas. History eviction can make late results unmatched.
The application manages request rates, command retries and reconnection.

Call options accept `signal` and `timeoutMs`. Disconnect and disposal settle
pending operations. Invalid signal values fail with `CONFIGURATION_ERROR` before
dispatch. Application cleanup exceptions are isolated, including when the
connection closes synchronously during attachment.
A timed-out update may still be accepted upstream; a later
acknowledgement updates observed state without resolving an unrelated call.
Cancellation before dispatch preserves the accepted configuration. A correlated
item acknowledgement with the wrong item ID rejects that operation with
`INVALID_RESPONSE` immediately.
Observer failures emit safe `observer_error` notifications and do not repeat work.
Subscription changes during delivery apply to subsequent notifications; a
recipient is called at most once for the current notification.
Server errors are normalized without exposing their raw messages.
Malformed server events, including nested items and configuration snapshots,
report `INVALID_RESPONSE`. Unknown validation exceptions use a generic message.

## Offline protocol tools

```shell
decision live validate configuration.json --kind config
decision live validate command.json --kind command
decision live validate event.json --kind event
decision live replay session.jsonl
```

Replay records are `{ "direction": "client" | "server", "event": ... }`.
The same correlation reducer processes them and emits ordered JSONL records.
No connection, audio device or credential is used. Malformed rows are reported
individually and make the final exit status nonzero.
Offline `live validate` treats malformed event files as caller input: it reports
`VALIDATION_ERROR` and exits 2. Replay retains `INVALID_RESPONSE` for malformed
server records, continues processing later records, and exits 1 if any row fails.
A replay represents one connection lifecycle. `session.closed` releases its
history; subsequent records report `CONNECTION_CLOSED` and make the exit status
nonzero. Use a separate replay for a replacement connection. Configuration
updates without event IDs are valid wire commands, but prevent trustworthy
configuration correlation for the rest of that replay. Controller-generated
commands always include unique IDs.

See the [connection adapter example](../../examples/live-decisions.mjs),
[OpenAI guide](https://developers.openai.com/api/docs/guides/decisions-voice) and
[Live protocol reference](https://developers.openai.com/api/reference/resources/live/primary-websocket).
