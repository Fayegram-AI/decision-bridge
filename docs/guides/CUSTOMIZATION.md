# Customizing decisions and extending the bridge

Customize each request by choosing the information, questions and allowed answers. Put
context in `state`, ordered `input` or `conversation`, using a form your provider
supports. Describe what to assess in `instructions` and define categories or a scoring
rubric in `criteria`. You can reuse one bridge for unrelated tasks; each call supplies
its own questions without changing the model or account settings.

For OpenAI's [question content](OPENAI_DECISIONS.md#json-and-question-content),
use `instructionParts` and the companion builders to include ordered text, images,
or JSON in a question. Existing instruction objects and arrays remain JSON-text
values; they are never inferred to be content parts.

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
checkout also has [examples/customize.mjs](../../examples/customize.mjs). Load any
external policies or reference material in your application and include the relevant
content in the request, after checking its size and removing sensitive data.

## Separate specification from evidence

Question definitions are trusted configuration; state can contain untrusted logs,
documents or user content. Generative providers separate these in their prompts,
but prompt injection remains possible. Keep control of instructions, endpoints,
credentials and actions in your application. Request validation checks structure;
the application must enforce permissions and assess the result.

Ask focused questions and define the categories clearly. Add an `unknown` or
`needs_review` option when the model should be able to decline a choice. Include
examples and domain definitions in the relevant instructions or context. Store a
template revision with your request and result in your application; arbitrary extra
fields at the top of a request are rejected.

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

Extensions run in registration order. They receive copies that cannot be changed, so
return a replacement to modify the input. Use the context's signal to cancel
asynchronous retrieval. Content is saved only if your extension saves it. Use
`prepareInput(parts, context)` for ordered input and
`prepareConversation(items, context)` for conversation history. A preparation extension
must implement the selected form's hook; transformed content is revalidated before
dispatch. Observer-only extensions work with every form.

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

If an observer fails, the result still succeeds and its metadata records the failure.
The bridge never retries inference because an observer fails, and observers receive
read-only results. The CLI does not load SDK extensions from ordinary JSON
configuration; add them in the application or an explicitly trusted provider module
instead of executable auto-discovery.

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

Add retrieval/redaction through `prepareState`, `prepareInput` or
`prepareConversation`, metrics through
`onResult`, and another protocol through the explicit [custom decision](CUSTOM_DECISION.md)
or [custom generative](CUSTOM_GENERATIVE.md) contract. Keep routing/threshold policies
outside the provider and cover additions with relevant regression tests. Persisted templates,
caching, and application policies can be built around the same
`evaluate({ state, questions })` contract.

For provider selection, use the separate [routing API](ROUTING.md). Its
`prepare(request, context)` hook receives the complete request and may replace
questions or extraction fields before eligibility is finalized. Bridge preparation
extensions above change only the selected input form. Routing supplies its own
clarification and observation callbacks; provider implementations remain focused
on their protocol and capabilities.
