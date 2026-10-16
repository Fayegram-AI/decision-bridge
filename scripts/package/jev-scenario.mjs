// Installed-package checks share the synthetic image fixture with protocol tests.
import { image } from '../../test/jev-fixtures.mjs';

export function jevScenario(name) {
    return `import assert from 'node:assert/strict';
import { createBridge, JevProvider, box, noul } from ${JSON.stringify(name)};
const image = ${JSON.stringify(image)};
const question = { target: box('The whole image'), present: noul('Is an image present?') };
const reply = request => ({ model: 'jev-1.14.0', answers: {
    target: { type: 'box', box: { top: 0, bottom: 1, left: 0, right: 1 }, confidence: 0.9 },
    present: { type: 'noul', noul: 0.8 },
}, usage: { input_tokens: null, output_tokens: 0 } });
const response = Response.json(reply());
delete globalThis.process; delete globalThis.Buffer;
const provider = new JevProvider({ apiKey: 'fixture', model: 'jev-preview', dangerZone: { images: true, longContext: true },
    fetchImpl: async (_, init) => {
        const request = JSON.parse(init.body);
        assert.equal(request.model, 'jev-preview');
        assert.equal(init.headers['TypeSafe-Danger-Zone-Images'], 'true');
        assert.equal(init.headers['TypeSafe-Danger-Zone-Long-Context'], 'true');
        assert.equal(Object.keys(request.assets).length, 1);
        return response.clone();
    } });
const result = await createBridge({ provider }).evaluate({ input: [{ type: 'image', dataUrl: image }], questions: question });
assert.equal(result.answers.target.box.right, 1);
assert.equal(result.usage.input_tokens, null);
const native = await provider.createDecision({ state: 'reference-image', questions: question,
    assets: { 'reference-image': { format: 'png', data_base64: image.split(',')[1] } } });
assert.equal(native.decision.answers.target.box.left, 0);
assert.equal(native.meta.requestedModel, 'jev-preview');
console.log('Installed Jev common/native images, boxes and opt-ins passed without Node globals.');
`;
}
