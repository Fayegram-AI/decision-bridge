import { mediaCheck as check } from './media-binary.mjs';

/** Inspect ISO BMFF boxes without decoding frame/audio payloads or following external references. */
export function inspectMp4(bytes) {
    let boxes = 0, ftyp = false, movie = false, data = false, video = false, duration;
    function walk(start, end, depth) {
        check(depth <= 8);
        for (let offset = start; offset < end;) {
            check(++boxes <= 65536 && offset + 8 <= end);
            let size = bytes.integer(offset, 4), header = 8;
            const kind = bytes.ascii(offset + 4, 4);
            if (size === 1) {
                check(offset + 16 <= end);
                const wide = bytes.wide(offset + 8); check(wide <= BigInt(Number.MAX_SAFE_INTEGER));
                size = Number(wide); header = 16;
            }
            if (size === 0) size = end - offset;
            check(size >= header && offset + size <= end);
            const payload = offset + header, length = size - header;
            if (depth === 0 && kind === 'ftyp') {
                check(!ftyp && length >= 8 && length % 4 === 0); ftyp = true;
            }
            if (depth === 0 && kind === 'mdat') { check(length > 0); data = true; }
            if (kind === 'moov' && depth === 0) { check(!movie); movie = true; walk(payload, offset + size, depth + 1); }
            else if (['trak', 'mdia'].includes(kind)) walk(payload, offset + size, depth + 1);
            else if (kind === 'hdlr') { check(length >= 12); if (bytes.ascii(payload + 8, 4) === 'vide') video = true; }
            else if (kind === 'mvhd' && depth === 1) {
                const version = bytes.byte(payload); check(version === 0 || version === 1);
                check(length >= (version === 1 ? 32 : 20));
                const scale = bytes.integer(payload + (version === 1 ? 20 : 12), 4); check(scale > 0);
                const ticks = version === 1 ? bytes.wide(payload + 24) : BigInt(bytes.integer(payload + 16, 4));
                if (ticks !== 0n && ticks !== (version === 1 ? 0xffffffffffffffffn : 0xffffffffn)) {
                    check(ticks <= BigInt(Number.MAX_SAFE_INTEGER)); duration = Number(ticks) / scale;
                }
            }
            offset += size;
        }
    }
    walk(0, bytes.length, 0);
    check(ftyp && movie && data && video);
    return duration; // Fragmented MP4 may omit a meaningful movie duration.
}

/** Read EBML metadata; clusters stay opaque and unknown-size segments are bounded by input bytes. */
export function inspectWebm(bytes) {
    let elements = 0, docType, scale = 1000000, ticks, video = false, cluster = false, segment = false;
    function variable(offset, id = false) {
        check(offset < bytes.length);
        const first = bytes.byte(offset); check(first > 0);
        let length = 1, marker = 128;
        while (!(first & marker)) { marker >>= 1; length++; }
        check(length <= (id ? 4 : 8) && offset + length <= bytes.length);
        let value = BigInt(id ? first : first & (marker - 1));
        for (let i = 1; i < length; i++) value = value * 256n + BigInt(bytes.byte(offset + i));
        const unknown = !id && value === (1n << BigInt(7 * length)) - 1n;
        check(unknown || value <= BigInt(Number.MAX_SAFE_INTEGER));
        return { length, value: unknown ? undefined : Number(value) };
    }
    function walk(start, end, depth, parent) {
        check(depth <= 8);
        for (let offset = start; offset < end;) {
            check(++elements <= 65536);
            const id = variable(offset, true), size = variable(offset + id.length);
            const payload = offset + id.length + size.length;
            check(size.value !== undefined || [0x18538067, 0x1f43b675].includes(id.value));
            const next = size.value === undefined ? end : payload + size.value;
            check(next <= end && next >= payload);
            const length = next - payload;
            if (depth === 0 && id.value === 0x1a45dfa3) walk(payload, next, depth + 1, id.value);
            else if (depth === 0 && id.value === 0x18538067) { check(!segment); segment = true; walk(payload, next, depth + 1, id.value); }
            else if ([0x1549a966, 0x1654ae6b, 0xae].includes(id.value)) walk(payload, next, depth + 1, id.value);
            else if (parent === 0x1a45dfa3 && id.value === 0x4282) { check(length > 0 && length <= 16); docType = bytes.ascii(payload, length); }
            else if (parent === 0x1549a966 && id.value === 0x2ad7b1) { check(length > 0 && length <= 8); scale = bytes.integer(payload, length); check(scale > 0); }
            else if (parent === 0x1549a966 && id.value === 0x4489) ticks = bytes.float(payload, length);
            else if (parent === 0xae && id.value === 0x83) { check(length > 0 && length <= 8); if (bytes.integer(payload, length) === 1) video = true; }
            else if (parent === 0x18538067 && id.value === 0x1f43b675) { check(length > 0); cluster = true; }
            offset = next;
        }
    }
    check(bytes.length >= 4 && bytes.integer(0, 4) === 0x1a45dfa3);
    walk(0, bytes.length, 0);
    check(docType === 'webm' && segment && video && cluster);
    return ticks === undefined ? undefined : ticks * scale / 1e9;
}
