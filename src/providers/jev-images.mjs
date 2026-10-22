// Jev JSON assets use reference substitution in string values, never object keys.
import { requireCondition as check } from '../errors.mjs';
import { base64ByteLength } from '../embedded.mjs';
import { isRecord } from '../validation.mjs';
import { imageDimensions } from './image-header.mjs';

const encoder = new TextEncoder();

function inspectImage(asset) {
    check(isRecord(asset) && Object.keys(asset).every(key => ['type', 'format', 'data_base64'].includes(key)) &&
        (asset.type === undefined || asset.type === 'image') && ['png', 'jpg', 'jpeg'].includes(asset.format),
    'Jev JSON image assets require PNG/JPEG format and data_base64.');
    const size = base64ByteLength(asset.data_base64);
    const decoded = atob(asset.data_base64);
    // A string iterator makes Uint8Array.from allocate an intermediate element
    // list. Copy directly into one bounded byte buffer for multi-MiB images.
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    const [width, height] = imageDimensions(bytes, asset.format === 'png' ? 'image/png' : 'image/jpeg');
    check(width > 0 && height > 0, 'Images require positive dimensions.');
    if (asset.format === 'png') {
        const view = new DataView(bytes.buffer);
        for (let offset = 8; offset < bytes.length;) {
            check(offset + 12 <= bytes.length, 'Invalid PNG chunk.');
            const length = view.getUint32(offset);
            check(offset + length + 12 <= bytes.length, 'Invalid PNG chunk length.');
            check(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) !== 'acTL',
                'Jev does not accept animated PNG images.');
            offset += length + 12;
        }
    }
    return size;
}

/** Apply TypeSafe's JSON nesting boundary and collect only replaceable values. */
function stringValues(value, output, depth = 0) {
    if (typeof value === 'string') output.push(value);
    else if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) stringValues(child, output, depth + 1);
    }
}

/** Whole values win first; other matches are consumed left to right. Alternatives
 * at the same position retain asset-map order, as on the native TypeSafe API.
 */
function usedReferences(strings, references) {
    const known = new Set(references);
    const used = new Set();
    if (!references.length) return used;
    const pattern = new RegExp(references.map(reference => reference.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')).join('|'), 'g');
    for (const value of strings) {
        if (known.has(value)) used.add(value);
        else for (const match of value.matchAll(pattern)) used.add(match[0]);
    }
    return used;
}

export function validateJevAssets(request) {
    const strings = [];
    stringValues(request.state, strings);
    for (const question of Object.values(request.questions)) {
        stringValues(question.instructions, strings);
        if (question.criteria !== undefined) stringValues(question.criteria, strings);
    }
    const assets = request.assets === undefined ? {} : request.assets;
    check(isRecord(assets), 'Jev assets must be an object.');
    const references = Object.keys(assets);
    let referenceBytes = 0;
    // Bound the literal pattern before compiling it or decoding any images.
    for (const reference of references) {
        const size = encoder.encode(reference).length;
        check(reference.trim() && size <= 1024, 'Jev asset references must be nonempty and within 1024 UTF-8 bytes.');
        referenceBytes += size;
        check(referenceBytes <= 65536, 'Jev asset references exceed 65536 UTF-8 bytes.', 'REQUEST_TOO_LARGE');
    }
    const used = usedReferences(strings, references);
    for (const reference of references) {
        check(used.has(reference), 'Every Jev asset must be used by reference substitution in a string value.');
        inspectImage(assets[reference]);
    }
    // Server re-encoding, expanded references, full image decoding and token limits
    // remain authoritative; original file sizes cannot predict those exactly.
    return references.length;
}
