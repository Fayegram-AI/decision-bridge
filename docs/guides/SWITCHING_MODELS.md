# Switching models without rewriting the application

The bridge's request contains `questions`, exactly one of `state`, ordered `input`
or `conversation`, and optionally `model`. Ordered input, conversation/tool history,
remote images, cache controls and richer questions require provider capabilities.
The provider translates it into that service's wire protocol and validates the
response. Select a provider when constructing your SDK bridge.
See [model selectors and provider defaults](../../README.md#model-selectors).

## Native and custom selection

The main package supports native Jev, OpenAI Decisions, and Cloudflare. The
request remains shared when switching providers, subject to capabilities.
General-purpose models use the explicit [custom generative](CUSTOM_GENERATIVE.md)
entry point. A new decision protocol uses [custom decision](CUSTOM_DECISION.md).
The example below demonstrates the opt-in generative path; native alternatives
follow it.

Clairic [extraction](EXTRACTION.md) and [Live Decisions](LIVE_DECISIONS.md) use
dedicated APIs. They cannot replace a provider in an existing `createBridge` call.

## SDK: same request, different provider

Install the package as described in [getting started](GETTING_STARTED.md).
Create or update `.env` in your application directory with the selected backend's
key and an actual model ID available to your account. For OpenRouter:

```dotenv
OPENROUTER_API_KEY=replace_with_your_openrouter_key
DECISION_MODEL=VENDOR/MODEL_ID
```

Keep `.env` out of source control. `VENDOR/MODEL_ID` is a placeholder to replace.
Save this complete example as `use-model.mjs` beside `.env`:

```javascript
import { createBridge, choice, publicError } from '@fayegram-ai/decision-bridge';
import { createGenerativeProvider } from '@fayegram-ai/decision-bridge/custom/generative';

try {
    const provider = createGenerativeProvider({
        type: 'openrouter',
        model: process.env.DECISION_MODEL,
        responseFormat: 'json_schema',
    });
    const bridge = createBridge({ provider });
    const result = await bridge.evaluate({
        state: { message: 'I was charged twice for the same invoice.' },
        questions: {
            route: choice('Which team should inspect this message?', {
                billing: 'Invoices, charges, or payment problems.',
                technical: 'Software defects or connectivity problems.',
                unknown: 'The evidence does not establish a team.',
            }),
        },
    });
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
```

Run it from your application directory:

```bash
node --env-file=.env use-model.mjs
```

This performs a real evaluation and may incur charges. The request is defined in
this script; it does not need files from the bridge's source checkout.

To use another backend, replace the provider configuration in the
example and provide that backend's credential in `.env`:

| Native SDK `createProvider` type | Credential variable | Model selection |
| --- | --- | --- |
| `jev` | `TYPESAFE_API_KEY` | Defaults to `jev-latest`; an explicit model overrides it |
| `openai-decisions` | `OPENAI_API_KEY` | Defaults to `default`; also accepts `luna` and explicit `gpt-6-luna` |
| `cloudflare-decisions` | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for REST | Defaults to `clef`; also supports `clef-flash` and `clef-omni` |

Custom generative presets use `createGenerativeProvider` instead. Their types are
`openai-compatible` (`OPENAI_API_KEY` at the default OpenAI origin), `openrouter`
(`OPENROUTER_API_KEY`), and `anthropic` (`ANTHROPIC_API_KEY`). Each requires a model
available to your account. Import the native `createProvider` from the root when
using the following native alternatives:

```javascript
createProvider({ type: 'jev', model: 'jev-latest' });
createProvider({ type: 'openai-decisions', model: 'luna' });
createProvider({ type: 'cloudflare-decisions', model: 'clef-flash' });
createGenerativeProvider({ type: 'openai-compatible', model: process.env.DECISION_MODEL });
createGenerativeProvider({ type: 'anthropic', model: process.env.DECISION_MODEL });
```

Each line is an alternative configuration. Constructors validate credentials but
make no inference calls. `evaluate()` sends the request. In the SDK, a request's
`model` overrides the provider default; omit it when the provider should choose.
The SDK does not automatically read `DECISION_*` settings: this example passes
`process.env.DECISION_MODEL` explicitly. The SDK factory property is **`type`**;
a command-runner JSON profile uses **`provider`**.

OpenAI's `default` selector chooses the provider default and `luna` chooses the
supported Luna-family model. Both currently resolve to upstream `gpt-6-luna`
through Decision Bridge. Use `model: 'gpt-6-luna'` to select that explicit upstream
ID. Mappings are fixed by the installed package release; results expose the
selection in `meta.requestedModel` and outgoing ID in `meta.resolvedModel`.

For Jev and the generative providers, list models with `await bridge.listModels()`.
OpenAI Decisions and Cloudflare Clef do not implement model discovery and return
`UNSUPPORTED_OPERATION`; their capability profiles do not prove account availability.
A catalog entry does not prove support for a particular response format. Check
that the selected serving endpoint supports the configured output mode. Anthropic
model listing preserves first-page pagination metadata; this client does not
fetch all pages automatically.

## Local or other compatible services

For a loopback server using Chat Completions, replace the provider configuration
in the complete example with:

```javascript
const provider = createGenerativeProvider({
    type: 'openai-compatible',
    baseURL: 'http://127.0.0.1:8000/v1',
    apiKey: null,
    model: process.env.LOCAL_MODEL,
    responseFormat: 'json_schema',
    tokenParameter: 'max_tokens',
});
```

Set `LOCAL_MODEL` in `.env` to your served model ID. `apiKey: null` explicitly
allows no authentication only for loopback compatible endpoints. A remote custom
endpoint requires HTTPS and an explicit `apiKey`, for example
`apiKey: process.env.MY_SERVICE_KEY`. See [credential boundaries](../reference/CONFIGURATION.md#custom-endpoint-credential-boundary).

Select `responseFormat: 'json_object'` or `'text'` only when appropriate for that
service. Validation remains strict, and the client does not silently retry with
a weaker format.

## Optional command runner

From an application with the package installed locally, create a request to edit:

```bash
npm exec -- decision-bridge init ./my-decisions
```

Edit `my-decisions/request.json` for your task. Keep `.env` in the application
root for the commands below, with the selected backend's key. Replace the
uppercase model placeholders with IDs available to your account/server:

```bash
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider jev --model jev-latest --env-file .env
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider openai-decisions --model default --env-file .env
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider cloudflare-decisions --model clef-flash --env-file .env
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider custom-generative --preset openrouter --model VENDOR/MODEL_ID --env-file .env
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider custom-generative --preset openai-compatible --model MODEL_ID --env-file .env
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider custom-generative --preset anthropic --model MODEL_ID --env-file .env
```

List models with `npm exec -- decision-bridge models --provider custom-generative --preset openrouter --env-file .env`.
For a loopback compatible server:

```bash
npm exec -- decision-bridge evaluate ./my-decisions/request.json --provider custom-generative --preset openai-compatible --base-url http://127.0.0.1:8000/v1 --no-auth --model LOCAL_MODEL_ID --token-parameter max_tokens --response-format json_schema
```

For a remote custom endpoint, explicitly select its credential variable with
`--api-key-env MY_SERVICE_KEY` alongside `--base-url`.

### Save a command-runner profile

Create `openrouter.config.json` in your application directory:

```json
{
    "schemaVersion": 1,
    "provider": "custom-generative",
    "preset": "openrouter",
    "model": "VENDOR/MODEL_ID",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "responseFormat": "json_schema",
    "timeoutMs": 30000
}
```

```bash
npm exec -- decision-bridge evaluate ./my-decisions/request.json --config openrouter.config.json --env-file .env
```

Command-runner model precedence is `--model` > `request.model` > resolved
configuration > provider default. Omit `model` from reusable request files when
profiles should choose it. Provider, preset, and module changes reset lower-precedence
provider-specific settings; supply overrides for the new provider explicitly.
See [configuration](../reference/CONFIGURATION.md).

## Boundaries

The opt-in custom generative compatible preset uses Chat Completions, not the OpenAI Responses API.
Anthropic uses one forced output-schema tool, not an agent loop. A different
protocol requires the [custom-provider contract](CUSTOM_PROVIDERS.md).
Jev, OpenAI Decisions, and Cloudflare Clef each have a dedicated native provider;
use those provider types for their decision APIs. Native Decisions providers
reject generative output settings such as `responseFormat` and `maxTokens`.

All shipped evaluations return probability-based decisions. Jev, OpenAI Decisions,
and Cloudflare probabilities are marked `native`; generative estimates are `elicited`, not logprobs or
a calibration guarantee. There is no discrete-only mode in this release. The
bridge standardizes the software interface, not model accuracy or statistical
semantics. See [provider reference](../reference/PROVIDERS.md).
