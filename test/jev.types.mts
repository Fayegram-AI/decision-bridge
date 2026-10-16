import { createBridge, createProvider, JevProvider, box, noul, type BoxCoordinates, type JevDecisionRequest } from '../src/index.mjs';

const provider = new JevProvider({ model: 'jev-preview', dangerZone: { images: true, longContext: true } });
const questions = { target: box('The target in photo'), present: noul('Is it present?') };
const native: JevDecisionRequest<typeof questions> = { state: { photo: 'photo-reference' }, questions,
    assets: { 'photo-reference': { format: 'png', data_base64: 'fixture' } } };
const result = await provider.createDecision(native);
const factoryResult = await createProvider({ type: 'jev', dangerZone: { images: true } }).createDecision(native);
const factoryLeft: number = factoryResult.decision.answers.target.box.left;
const coordinates: BoxCoordinates = result.decision.answers.target.box;
const present: number = result.decision.answers.present.noul;
const common = await createBridge({ provider }).evaluate({ input: [{ type: 'image', dataUrl: 'fixture' }], questions });
const left: number = common.answers.target.box.left;
void [coordinates, present, left, factoryLeft];
// @ts-expect-error A box answer has no probability distribution.
common.answers.target.probabilities;
// @ts-expect-error Jev image formats are explicit.
const invalid: JevDecisionRequest = { state: '', questions, assets: { photo: { format: 'webp', data_base64: '' } } };
void invalid;
// @ts-expect-error Experimental options require booleans.
new JevProvider({ dangerZone: { images: 'true' } });
