// Authored container/frame fixtures for preflight tests, not full codec-decoding tests.
const atom = (kind, data) => {
    const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(kind, 4);
    return Buffer.concat([header, data]);
};
export const dataUrl = (format, bytes) => 'data:' + format + ';base64,' + bytes.toString('base64');

export function wav(seconds = 1, sampleRate = 8, extraBytes = 0) {
    const samples = Math.round(seconds * sampleRate), bytes = Buffer.alloc(44 + samples * 2 + extraBytes);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
    bytes.writeUInt32LE(bytes.length - 44, 40);
    return bytes;
}

export function mp3(count = 2, bitrateIndex = 9) {
    const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex];
    const frame = Buffer.alloc(Math.floor(144000 * bitrate / 44100));
    frame.set([255, 251, bitrateIndex << 4, 0]);
    return Buffer.concat(Array.from({ length: count }, () => frame));
}

export function mp4(seconds = 1, extraBytes = 0, unknownDuration = false) {
    const movie = Buffer.alloc(20); movie.writeUInt32BE(1000, 12); movie.writeUInt32BE(unknownDuration ? 0 : seconds * 1000, 16);
    const handler = Buffer.alloc(12); handler.write('vide', 8);
    return Buffer.concat([atom('ftyp', Buffer.from('isom\0\0\0\0')),
        atom('moov', Buffer.concat([atom('mvhd', movie), atom('trak', atom('mdia', atom('hdlr', handler)))])),
        atom('mdat', Buffer.alloc(1 + extraBytes))]);
}

function ebml(id, data) {
    let width = 1;
    while (data.length >= 2 ** (7 * width) - 1) width++;
    const length = Buffer.alloc(width);
    let value = BigInt(data.length) | 1n << BigInt(7 * width);
    for (let i = width - 1; i >= 0; i--) { length[i] = Number(value & 255n); value >>= 8n; }
    return Buffer.concat([Buffer.from(id, 'hex'), length, data]);
}

export function webm(seconds = 1, unknownDuration = false) {
    const duration = Buffer.alloc(8); duration.writeDoubleBE(seconds * 1000);
    const info = ebml('1549a966', Buffer.concat([ebml('2ad7b1', Buffer.from([15, 66, 64])),
        ...(unknownDuration ? [] : [ebml('4489', duration)])]));
    return Buffer.concat([ebml('1a45dfa3', ebml('4282', Buffer.from('webm'))),
        ebml('18538067', Buffer.concat([info, ebml('1654ae6b', ebml('ae', ebml('83', Buffer.from([1])))),
            ebml('1f43b675', ebml('e7', Buffer.from([0])))]))]);
}

export const media = { wav: dataUrl('audio/wav', wav()), mp3: dataUrl('audio/mpeg', mp3()),
    mp4: dataUrl('video/mp4', mp4()), webm: dataUrl('video/webm', webm()) };
