# Getting started

Use the SDK from your JavaScript or TypeScript application to submit `state` and
`questions` and receive structured answers. The optional command runner can also
evaluate request files.

## Prerequisites

The example uses Node.js **22.16 or newer**, npm, and a TypeSafe API key for Jev. The
SDK also runs in modern browsers, where direct requests need a provider that allows your
web origin through CORS and a credential suitable for browser use. See
[browser integration](BROWSER.md). Other backends use their own keys; see
[switching models](SWITCHING_MODELS.md).

## Install into your application

In your application's directory, install the package from npm:

```bash
npm install @fayegram-ai/decision-bridge
```

You can also install a verified package archive. Replace the example archive
path with your own; see [packaging and release](../development/RELEASING.md) to
build and verify one from a source checkout:

```bash
npm install /path/to/fayegram-ai-decision-bridge-0.1.4.tgz
```

The installed package contains the SDK, declarations, command runner, examples,
and docs. It runs without compilation; source development scripts and tests are
excluded.

Check the installed version with `npm exec -- decision-bridge --version`.
Use the documentation bundled with your installed package, or select the
matching [versioned documentation](../README.md#version-availability).

## Configure credentials

Create `.env` in your application's directory and edit it locally:

```dotenv
TYPESAFE_API_KEY=your_real_key_here
```

Add `.env` to your application's `.gitignore`. The SDK reads `TYPESAFE_API_KEY`
from the process environment when constructing the selected Jev provider. It does not load
`.env` itself; the Node startup command below loads it explicitly. In a deployed
application, you can supply the same variable through your runtime's environment.

## Make your first SDK call

Save this as `app.mjs` beside `.env`. The `.mjs` extension enables ESM regardless
of your application's `package.json` settings:

```javascript
import { createBridge, choice, noul, publicError } from '@fayegram-ai/decision-bridge';

try {
    const bridge = createBridge({ jev: {} }); // Jev; defaults to model jev-latest.
    const result = await bridge.evaluate({
        state: { message: 'I was charged twice for the same invoice.' },
        questions: {
            route: choice('Which team should inspect this message?', {
                billing: 'Invoices, charges, or payment problems.',
                technical: 'Software defects or connectivity problems.',
                unknown: 'The evidence does not establish a team.',
            }),
            duplicate_charge: noul('Does the message report a duplicate charge?'),
        },
    });
    console.log(result.answers.route.choice);
    console.log(result.answers.duplicate_charge.noul);
    console.log(result.model, result.meta.probabilitySource);
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
```

Run it from your application directory:

```bash
node --env-file=.env app.mjs
```

This sends one real evaluation and may incur charges. `route.choice` is one of
`billing`, `technical`, or `unknown`; `duplicate_charge.noul` is a probability
between 0 and 1. `result.model` identifies the returned model, and Jev marks its
probability source as `native`. Predictions depend on the model. Your application
decides how to use them; the SDK does not route messages or execute actions.

Change `state` and the question instructions/criteria on each call. No prompt
registration is required. Reuse the bridge for subsequent requests. To choose
a Jev model explicitly, construct it with `createBridge({ jev: { model: 'YOUR_MODEL' } })`,
using an ID available to your account. An individual request's `model` overrides
that default. See the [SDK reference](../reference/SDK.md) for scores, result
metadata, cancellation, batching, and extensions.

Creating a bridge can fail if configuration is invalid or credentials are missing.
Evaluating a request can fail if its input is invalid or the provider returns an error,
so the example keeps both steps inside `try`. `publicError(error)` returns a safe `code`
and `message`, plus HTTP status, request ID, and attempt count when available. See
[errors and recovery](../reference/ERRORS.md).

Select a provider with `createBridge({ provider })`, or use
`createBridge({ jev: options })` for Jev. Calling `createBridge()` or `createBridge({})`
without either selection is an error. `createProvider` requires a `type`. The CLI
defaults to Jev; SDK applications choose their provider in code.

## TypeScript

Declarations ship with the package. For a standalone Node TypeScript example,
install these development tools in the consuming application (TypeScript 5.8.3
is the compiler used by this repository's CI):

```bash
npm install --save-dev typescript@5.8.3 @types/node@22
```

Create `tsconfig.json`, or incorporate these settings into your existing config:

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "strict": true,
        "outDir": "dist",
        "types": ["node"]
    },
    "include": ["app.mts"]
}
```

Save this as `app.mts`. The `.mts` extension makes it an ESM module and produces
`dist/app.mjs`; no `"type": "module"` setting is needed for this example:

```typescript
import { createBridge, choice, publicError } from '@fayegram-ai/decision-bridge';

try {
    const bridge = createBridge({ jev: {} });
    const result = await bridge.evaluate({
        state: 'An invoice appears twice.',
        questions: {
            route: choice('Which team should inspect this?', {
                billing: 'An invoice or payment issue.',
                unknown: 'Insufficient evidence.',
            }),
        },
    });
    // The builder preserves the allowed labels in the answer type.
    const route: 'billing' | 'unknown' = result.answers.route.choice;
    const probability: number = result.answers.route.probabilities[route];
    console.log(route, probability);
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
```

Compile, then run with the same environment file:

```bash
npm exec -- tsc --project tsconfig.json
node --env-file=.env dist/app.mjs
```

## Existing CommonJS applications

Use dynamic import from an async function in a `.cjs` module:

```javascript
async function main() {
    const { createBridge, noul } = await import('@fayegram-ai/decision-bridge');
    const bridge = createBridge({ jev: {} });
    const result = await bridge.evaluate({
        state: 'The test log reports a failure.',
        questions: { failed: noul('Does the log report a failed test?') },
    });
    console.log(result.answers.failed.noul);
}

main().catch(() => {
    console.error('Evaluation failed. Check credentials and request configuration.');
    process.exitCode = 1;
});
```

Save it as `app.cjs` and run `node --env-file=.env app.cjs`. The package exposes an
ESM import entry; it does not provide a native `require()` entry.

## Optional command runner

After a local package installation, use `npm exec` from the consuming project:

```bash
npm exec -- decision-bridge init ./my-decisions
npm exec -- decision-bridge validate ./my-decisions/request.json
```

`init` creates `decision.config.json`, `decision.config.schema.json`, `request.json`,
`.env.example`, and `.gitignore`; existing files are never overwritten. The config's
`$schema` points to the copied schema for editor completion. `validate` checks the request offline.
Copy the generated `.env.example` to `.env` inside `my-decisions`, then edit its key.
Evaluate the generated request with explicit paths:

```bash
npm exec -- decision-bridge evaluate ./my-decisions/request.json --config ./my-decisions/decision.config.json --env-file ./my-decisions/.env
```

The command runner does not discover `.env` or configuration files automatically.
Paths are relative to the working directory, except custom provider module paths
inside a config file, which are relative to that file. The [command reference](../reference/CLI.md)
covers commands, flags, streams, and exit codes.

Global installation is optional:

```bash
npm install --global @fayegram-ai/decision-bridge
decision-bridge --version
```

The package also installs `decision` and `faye-decision` as equivalent CLI aliases.
For example, `npm exec -- faye-decision --version` runs the same command runner.
The shorter `decision` alias may collide with an existing executable; prefer
`decision-bridge` or `faye-decision` in automation.

## Run from a source checkout

For repository development, open a terminal at the source root. Copy `.env.example`
to `.env` (`cp .env.example .env` on macOS/Linux or `Copy-Item .env.example .env`
in PowerShell), then edit the key locally. Run:

```bash
npm ci --ignore-scripts
npm test
npm run validate
npm run models
npm run ask
npm run example
```

`npm ci --ignore-scripts` installs the pinned development dependencies from the
lockfile; it can access the npm registry and requires no model credentials.
`npm test` and `npm run validate` are offline. `models` lists account models; `ask` evaluates
`examples/request.json`; `example` runs the source SDK example. The last three
explicitly load `.env` when present and access the provider. A model listing does
not prove inference access; evaluation verifies that path.

Source examples import `../src/index.mjs` and run directly without installing the
package. Application code should use `@fayegram-ai/decision-bridge` as shown above.
See [platform setup](PLATFORMS.md) for operating-system details and
[contributor documentation](../development/README.md) for development checks.
