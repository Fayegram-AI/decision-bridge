# Primary protocol sources

These official protocol and platform references inform the implementation. Recheck them
when updating versions or adding compatibility. A reference link records the
specification used; it does not mean authenticated service calls were tested.

| Subject | Official source |
| --- | --- |
| Node 22.16 JSON modules | https://nodejs.org/download/release/v22.16.0/docs/api/esm.html#json-modules |
| Node filesystem identities and atomic operations | https://nodejs.org/docs/latest-v22.x/api/fs.html |
| TypeSafe request/response API | https://docs.typesafe.ai/api |
| TypeSafe JavaScript examples | https://docs.typesafe.ai/sdk/javascript |
| Native model listing and aliases | https://docs.typesafe.ai/models |
| Jev image assets and experimental opt-in | https://docs.typesafe.ai/images |
| Jev bounding boxes | https://docs.typesafe.ai/primitives/box |
| Jev 1.14 release | https://typesafe.ai/blog/jev-1-14 |
| Jev nullable usage compatibility | https://docs.typesafe.ai/sdk/javascript/changelog |
| Choice decisions | https://docs.typesafe.ai/primitives/choice |
| Noul probabilities | https://docs.typesafe.ai/primitives/noul |
| Score rubric and weighted expectation | https://docs.typesafe.ai/primitives/score |
| Native confidence interpretation | https://docs.typesafe.ai/confidence |
| OpenAI structured output modes | https://platform.openai.com/docs/guides/structured-outputs |
| OpenAI native Decisions guide | https://developers.openai.com/api/docs/guides/decisions |
| OpenAI Decisions request/response contract | https://developers.openai.com/api/reference/resources/decisions/methods/create |
| OpenAI Live Decisions guide | https://developers.openai.com/api/docs/guides/decisions-voice |
| OpenAI Live protocol | https://developers.openai.com/api/reference/resources/live/primary-websocket |
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

## Cloudflare extraction

- [Extraction concepts](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/)
- [Clairic schema snapshot](https://github.com/cloudflare/cloudflare-docs/blob/a5cc2cba1a31b8bd95eda69dad151e6cd307ac7b/src/content/workers-ai-models/clairic.json), the pinned basis for established native fields; underspecified predictive JSON remains preserved

## Package and repository release

- [Scoped public npm packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/) and [stage commands](https://docs.npmjs.com/cli/v12/commands/npm-stage/)
- [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
