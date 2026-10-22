# Browser integration

The SDK exports browser-compatible ESM. Follow the
[installation guide](GETTING_STARTED.md#install-into-your-application), then import
`@fayegram-ai/decision-bridge` through your browser application's module bundler. The
optional `decision-bridge` command still requires Node.js.
Omni's embedded audio/video validation is browser-safe and adds no runtime media
library. Build data URLs in the application; the SDK does not fetch remote media.
The dedicated [extraction](EXTRACTION.md) and [Live](LIVE_DECISIONS.md) exports
also use browser-compatible APIs. Clairic REST still requires provider CORS and
explicit credentials. Live attaches to an already established application-owned
connection; it does not create or authenticate one. OpenAI remote-image URLs are
forwarded to the provider without a browser-side SDK fetch.

Built-in REST providers need explicitly supplied credentials in browser code;
Node environment-variable defaults and `.env` files are not available. Cloudflare
REST also needs `accountId`; its Workers AI binding is configured inside a Worker,
as described in the [Cloudflare guide](CLOUDFLARE_DECISIONS.md#workers-ai-binding).
A compatible loopback endpoint can explicitly use `apiKey: null`.
The following example requires TypeSafe to permit your application's origin and
provide a credential suitable for client exposure. `browserCredential` is supplied
by your application's credential flow:

```javascript
import { createBridge, JevProvider, noul } from '@fayegram-ai/decision-bridge';

const bridge = createBridge({
    provider: new JevProvider({ apiKey: browserCredential }),
});
const result = await bridge.evaluate({
    state: 'A user-supplied statement',
    questions: { relevant: noul('Is this relevant?') },
});
console.log(result.answers.relevant.noul);
```

This sends the request **directly from the browser**. The provider's server must
accept the page's origin in its CORS preflight response and allow the method and
headers used by the SDK. For Jev evaluation those include `POST`, `Authorization`,
and `Content-Type`. If the preflight is rejected, the browser sends no evaluation
request; neither the SDK nor a browser setting can override that server policy.
Check your intended origin with TypeSafe before relying on direct Jev calls.
When Jev experimental features are enabled, CORS must also permit the selected
`TypeSafe-Danger-Zone-Images` and `TypeSafe-Danger-Zone-Long-Context` headers.
The [Jev guide](JEV.md) covers browser-safe embedded assets and boxes.

Any key delivered to browser JavaScript can be read by the app's users. Only use
a credential that the provider explicitly permits for browser exposure. If an
account key must remain private, keep the provider call in your own backend and
invoke that backend from the browser. This is a credential boundary, separate
from whether the SDK's modules can run in a browser.
