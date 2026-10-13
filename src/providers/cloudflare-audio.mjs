import { mediaCheck as check } from './media-binary.mjs';

/** Inspect RIFF/WAVE chunks; PCM and IEEE-float sample counts give reliable duration. */
export function inspectWav(bytes) {
    check(bytes.length >= 44 && bytes.ascii(0, 4) === 'RIFF' && bytes.ascii(8, 4) === 'WAVE' &&
        bytes.integer(4, 4, true) + 8 === bytes.length);
    let format, sampleRate, alignment, dataSize = 0, chunks = 0;
    for (let offset = 12; offset < bytes.length;) {
        check(++chunks <= 65536 && offset + 8 <= bytes.length);
        const kind = bytes.ascii(offset, 4), size = bytes.integer(offset + 4, 4, true), start = offset + 8;
        check(start + size + size % 2 <= bytes.length);
        if (kind === 'fmt ') {
            check(format === undefined && size >= 16);
            format = bytes.integer(start, 2, true);
            const channels = bytes.integer(start + 2, 2, true);
            sampleRate = bytes.integer(start + 4, 4, true);
            alignment = bytes.integer(start + 12, 2, true);
            const bits = bytes.integer(start + 14, 2, true);
            check(channels > 0 && sampleRate > 0 && alignment > 0);
            if (format === 65534) {
                check(size >= 40 && bytes.integer(start + 16, 2, true) >= 22);
                // WAVEFORMATEXTENSIBLE embeds the PCM/float sub-format GUID.
                const pcmGuidTail = [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
                format = pcmGuidTail.every((value, i) => bytes.byte(start + 26 + i) === value)
                    ? bytes.integer(start + 24, 2, true) : 0;
            }
            if ([1, 3].includes(format)) check(bits > 0 && bits % 8 === 0 && alignment === channels * bits / 8);
        }
        if (kind === 'data') dataSize += size;
        offset = start + size + size % 2;
    }
    check(format !== undefined && dataSize > 0);
    if ([1, 3].includes(format)) {
        check(dataSize % alignment === 0);
        return dataSize / alignment / sampleRate;
    }
    // Compressed WAV formats require a decoder to establish actual duration.
    return undefined;
}

const V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** MPEG Layer III frame walking handles varying bitrates without trusting Xing estimates. */
export function inspectMp3(bytes) {
    check(bytes.length >= 4);
    let offset = 0, end = bytes.length;
    if (bytes.length >= 10 && bytes.ascii(0, 3) === 'ID3') {
        const version = bytes.byte(3);
        check([2, 3, 4].includes(version));
        let size = 0;
        for (let i = 6; i < 10; i++) { check(bytes.byte(i) < 128); size = size * 128 + bytes.byte(i); }
        offset = 10 + size + (version === 4 && (bytes.byte(5) & 16) ? 10 : 0);
        check(offset + 4 <= end);
    }
    if (end - offset >= 128 && bytes.ascii(end - 128, 3) === 'TAG') end -= 128;
    if (end - offset >= 32 && bytes.ascii(end - 32, 8) === 'APETAGEX') {
        const size = bytes.integer(end - 20, 4, true);
        check(size >= 32 && size <= end - offset); end -= size;
        if (end - offset >= 32 && bytes.ascii(end - 32, 8) === 'APETAGEX') end -= 32;
    }
    let duration = 0, frames = 0;
    while (offset < end) {
        // Some encoders pad the end of a stream with zero bytes.
        if (frames && bytes.byte(offset) === 0) {
            for (; offset < end; offset++) check(bytes.byte(offset) === 0);
            break;
        }
        check(++frames <= 100000 && offset + 4 <= end && bytes.byte(offset) === 255 && (bytes.byte(offset + 1) & 224) === 224);
        const version = bytes.byte(offset + 1) >> 3 & 3, layer = bytes.byte(offset + 1) >> 1 & 3;
        const rateIndex = bytes.byte(offset + 2) >> 2 & 3, bitrateIndex = bytes.byte(offset + 2) >> 4;
        check(version !== 1 && layer === 1 && rateIndex !== 3 && bitrateIndex !== 15);
        if (bitrateIndex === 0) return undefined; // Free-format MP3 needs decoder-assisted frame sizing.
        const sampleRate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
        const bitrate = (version === 3 ? V1 : V2)[bitrateIndex];
        const size = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + (bytes.byte(offset + 2) >> 1 & 1);
        check(size >= 4 && offset + size <= end);
        duration += (version === 3 ? 1152 : 576) / sampleRate;
        offset += size;
    }
    check(frames > 0);
    return duration;
}
