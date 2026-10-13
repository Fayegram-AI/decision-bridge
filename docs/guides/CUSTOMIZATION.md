# Customizing decisions and extending the bridge

Customization is **per request**. You supply context in `state`, the judgment in
`instructions`, and the allowed categories/rubric in `criteria`. The same bridge
instance can evaluate unrelated tasks on successive calls. This changes the
question sent to the existing model, not its weights or account configuration.

## Runtime templates

In your application, save reusable question definitions as `questions.mjs`:

```javascript
import { choice } from '@fayegram-ai/decision-bridge';

export function failureQuestion(includeNetwork = true) {
    return choice('Classify the failure. Use unknown when evidence is insufficient.', {
        dependency: 'An installed package is absent or incompatible.',
        assertion: 'A test ran and an assertion failed.',
        ...(includeNetwork ? { network: 'A connection or network request failed.' } : {}),
        unknown: 'No supplied category is established.',
    });
}
```

Save this as `customize.mjs` beside it. Configure `.env` as described in
[getting started](GETTING_STARTED.md) and run `node --env-file=.env customize.mjs`:

```javascript
import { createBridge, publicError } from '@fayegram-ai/decision-bridge';
import { failureQuestion } from './questions.mjs';

try {
    const bridge = createBridge({ jev: {} });
    const result = await bridge.evaluate({
        state: { log: "ModuleNotFoundError: No module named 'pytest'" },
        questions: { category: failureQuestion(true) },
    });
    console.log(result.answers.category.choice);
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
```

The remaining snippets show individual changes to this SDK flow. The source
checkout also has [examples/customize.mjs](../../examples/customize.mjs). A rule stored only
in an unrelated repository file is not automatically known to the provider. Read
and include the relevant content explicitly, with appropriate size/redaction checks.

## Separate specification from evidence

Question definitions are your trusted decision specification. State can contain
untrusted logs, documents, or user content. The generative providers separate these
in their prompts, but this is not proof of prompt-injection resistance. Do not let
untrusted input choose unrestricted instructions, URLs, credentials, or actions.
Validation guarantees structure, not semantic correctness or authorization.

Use bounded questions and well-defined categories. Add an explicit `unknown` or
`needs_review` option when abstention is useful. Examples and domain definitions
belong in relevant instructions/context. Store a template revision alongside your
request/result externally; adding arbitrary top-level request fields is rejected.

## Add context preparation

```javascript
import { createBridge } from '@fayegram-ai/decision-bridge';

const bridge = createBridge({
    jev: {},
    extensions: [{
        name: 'project-context',
        prepareState(state) {
            return { evidence: state, policy: 'Do not infer test success from missing logs.' };
        },
    }],
});
```

Extensions run in registration order. They receive immutable snapshots and must
return replacements rather than mutate input. Async retrieval can use the supplied
context signal. No content is persisted unless your extension explicitly saves it.

## Observe without changing decisions

```javascript
import { createBridge } from '@fayegram-ai/decision-bridge';

const bridge = createBridge({
    jev: {},
    extensions: [{
        name: 'metrics',
        onResult(result) {
            // This example logs metadata only, not state, keys, or answer content.
            console.error(JSON.stringify({
                event: 'decision_completed',
                provider: result.meta.provider,
                model: result.model,
                durationMs: result.meta.durationMs,
            }));
        },
    }],
});
```

Observer failure is isolated and recorded in the returned metadata. It is not a
reason to retry inference. Observers cannot rewrite outputs. The CLI does not load
SDK extensions from ordinary JSON configuration; add them in the application or
an explicitly trusted provider module instead of executable auto-discovery.

## Application policy is a separate stage

```javascript
import { decideChoice } from '@fayegram-ai/decision-bridge';

const policy = decideChoice(result.answers.category, {
    minProbability: 0.90,
    minMargin: 0.20,
    abstainOptions: ['unknown'],
});
```

These are illustrative thresholds, not validated recommendations. `policy.status`
indicates `selected` or `review`. The original model answer remains unchanged.
Your code decides whether any downstream action is allowed. A high probability
cannot replace tests, permission checks, or human approval for consequential work.

When a provider declares `probabilityDecimalPlaces` through
`getResultValidationOptions(model)`, pass that precision to `decideChoice` for
rounded distributions. Cloudflare declares four-decimal precision; the helper
otherwise keeps the baseline 0.001 tolerance. See the
[Cloudflare policy example](CLOUDFLARE_DECISIONS.md#embedded-images-and-limits)
and [SDK validation contract](../reference/SDK.md#additional-exports).

## Develop additions without changing the public call

Add retrieval/redaction through `prepareState` or `prepareInput`, metrics through
`onResult`, and another protocol through the explicit [custom decision](CUSTOM_DECISION.md)
or [custom generative](CUSTOM_GENERATIVE.md) contract. Keep routing/threshold policies
outside the provider and cover additions with relevant regression tests. Persisted templates,
caching, and routing can be built around the same `evaluate({ state, questions })`
contract rather than hardcoded into every backend.
