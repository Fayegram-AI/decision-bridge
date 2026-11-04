# Anthropic cumulative decision threads

`AnthropicProvider.createThread()` explicitly retains a sequence of accepted
states for cumulative evaluation against fixed questions. Ordinary `evaluate()`
and batches remain independent calls. Thread evaluations use the same elicited
probability and output-validation contract as the Anthropic preset.

```javascript
import { AnthropicProvider } from '@fayegram-ai/decision-bridge/custom/generative';
import { noul } from '@fayegram-ai/decision-bridge';

const provider = new AnthropicProvider({
    model: 'claude-sonnet-5-5',
    responseFormat: 'json_schema',
    workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
});
const thread = provider.createThread({
    questions: { ready: noul('Does the accumulated evidence establish readiness?') },
    maxTurns: 128,
    maxHistoryBytes: 8 * 1024 * 1024,
});
try {
    await thread.evaluate('The build passed.');
    const result = await thread.evaluate('The deployment health check also passed.');
    console.log(result.answers.ready.noul);
} finally {
    thread.dispose();
}
```

Questions and model are fixed at creation. Each `evaluate(state, { signal }?)`
accepts one shared JSON/text state and combines it with previously accepted
turns. Concurrent evaluations on the same thread reject with `THREAD_BUSY`.
`reset()` clears idle local history and the continuation cursor. `dispose()`
aborts outstanding work and clears retained state; it does not delete server
storage. Neither operation can change the questions or model.

The SDK sends the beta header `message-threads-2026-08-12`. The first request
creates a thread with the complete prompt, tools/schema and history. A
continuation sends the next turn and the preceding response's message ID.
Tool-output mode acknowledges its synthetic output tool on the next turn; it
does not execute application tools. JSON-schema mode retains ordered text and
thinking/signature blocks needed for replay. No prompt-cache controls are added.

The SDK retains bounded in-memory history. Defaults are 128 accepted turns and
8 MiB of history, reduced to the configured request budget when smaller. Explicit
history bytes must fit the provider request budget; complete serialized requests
must also fit that budget. Exceeding either history bound raises `HISTORY_LIMIT`.
Failed, refused, truncated or invalid turns never enter accepted history.

For a documented `thread_not_found` (404), `thread_already_continued` (400), or
`thread_continue_in_flight` (400), a continuation can recreate once from accepted
history plus the new state. Other HTTP errors do not trigger this replay. Thread
transport retries are disabled; both attempts share the caller's cancellation and
overall provider deadline. An uncertain dispatched failure clears the cursor so
the next evaluation starts from known accepted history. Reported fallback messages
also clear the continuation cursor.

Anthropic retains thread data server-side: continuation state expires after five
minutes of inactivity and stored data is deleted within one hour of its last use. Threads are not
compatible with Zero Data Retention or HIPAA workloads. Choose this explicit API
only when cumulative semantics and that retention policy suit the application.
See the official [message threads documentation](https://platform.claude.com/docs/en/build-with-claude/message-threads).

The CLI does not create persistent thread sessions. Configure workspace headers,
output modes and request budgets using the [Anthropic preset guide](CUSTOM_GENERATIVE.md#anthropic).
