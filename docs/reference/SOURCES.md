# Primary protocol sources

These are the upstream protocol and platform references used by the bridge.
Recheck them before updating versions or claiming new compatibility. Listing a
reference does not imply that authenticated inference was run against its service.

| Subject | Official source |
| --- | --- |
| Node 22.16 JSON modules | https://nodejs.org/download/release/v22.16.0/docs/api/esm.html#json-modules |
| Node filesystem identities and atomic operations | https://nodejs.org/docs/latest-v22.x/api/fs.html |
| TypeSafe request/response API | https://docs.typesafe.ai/api |
| TypeSafe JavaScript examples | https://docs.typesafe.ai/sdk/javascript |
| Native model listing and aliases | https://docs.typesafe.ai/models |
| Choice decisions | https://docs.typesafe.ai/primitives/choice |
| Noul probabilities | https://docs.typesafe.ai/primitives/noul |
| Score rubric and weighted expectation | https://docs.typesafe.ai/primitives/score |
| Native confidence interpretation | https://docs.typesafe.ai/confidence |
| OpenAI structured output modes | https://platform.openai.com/docs/guides/structured-outputs |
| OpenAI native Decisions guide | https://developers.openai.com/api/docs/guides/decisions |
| OpenAI Decisions request/response contract | https://developers.openai.com/api/reference/resources/decisions/methods/create |
| OpenRouter structured output and routing | https://openrouter.ai/docs/guides/features/structured-outputs |
| Anthropic Messages, tools, usage, and stop reasons | https://platform.claude.com/docs/en/api/messages/create |
| GitHub checkout action | https://github.com/actions/checkout |
| GitHub Node setup action | https://github.com/actions/setup-node |

No model pricing, benchmark score, latency promise, or calibration guarantee is
baked into this implementation. The repository tests verify its own protocol and
software invariants using explicitly labeled fixtures. Live model behavior is a
separate operational check.

## Cloudflare decision inference

- [Clef](https://developers.cloudflare.com/workers-ai/models/clef/) and [Clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)
- [Clef-omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/) and its [input](https://developers.cloudflare.com/workers-ai/models/clef-omni/schema-input.json) / [output](https://developers.cloudflare.com/workers-ai/models/clef-omni/schema-output.json) schemas
- [Clef serving, pricing, and multimodal announcement](https://blog.cloudflare.com/clef-faster-cheaper-multimodal/)
- [Hosted input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json) and [output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)
- [REST and permissions](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [Binding implementation and cancellation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts)
- [Gateway binding methods and options](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)
- [Capacity rejection](https://developers.cloudflare.com/workers-ai/features/reject-if-busy/)
- [Gateway request handling](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/)
- [Gateway limits](https://developers.cloudflare.com/ai-gateway/reference/limits/), including cacheable request size
- [Workers AI errors](https://developers.cloudflare.com/workers-ai/platform/errors/)
- [Cloudflare-owned model implementation](https://huggingface.co/Cloudflare/clef-flash/blob/main/joint_schema_model.py), including output precision
- [Cloudflare-owned Omni implementation](https://huggingface.co/Cloudflare/clef-omni/blob/main/joint_schema_model.py), including grouped media and output precision

## Package and repository release

- [Scoped public npm packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/) and [stage commands](https://docs.npmjs.com/cli/v12/commands/npm-stage/)
- [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
