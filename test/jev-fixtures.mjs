// Real PNG encoding with synthetic pixels; these are not measured Jev outputs.
import { deflateSync } from 'node:zlib';

function chunk(type, data) {
    const name = Buffer.from(type);
    const contents = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of contents) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); contents.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
}

export function png(width = 280, height = 280, animated = false) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
        chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 3)))), chunk('IEND', Buffer.alloc(0))]);
}

export const asset = { type: 'image', format: 'png', data_base64: png().toString('base64') };
export const image = 'data:image/png;base64,' + asset.data_base64;
export const native = { model: 'jev-1.14.0', state: { photo: 'test-photo-reference' }, assets: { 'test-photo-reference': asset },
    questions: { present: { type: 'noul', instructions: 'Is there a target in photo?' },
        target: { type: 'box', instructions: 'The target in photo' } } };
export function jevResponse(request) {
    return { model: 'jev-1.14.0', answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) =>
        [id, question.type === 'box' ? { type: 'box', box: { top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 }, confidence: 0.7 }
            : { type: 'noul', noul: 0.8 }])), usage: { input_tokens: null, output_tokens: 0 } };
}
