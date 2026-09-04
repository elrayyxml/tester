/**
 * Shared helpers + message ID generation.
 */

import { createHash, randomBytes, randomFillSync } from 'crypto';

export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

export function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function asString(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    return null;
}

export function mergeObjects(target, source) {
    const out = { ...target };
    if (!source || typeof source !== 'object') return out;
    for (const [k, v] of Object.entries(source)) {
        if (isPlainObject(v) && isPlainObject(out[k])) out[k] = { ...out[k], ...v };
        else if (v !== undefined) out[k] = v;
    }
    return out;
}

export async function toBuffer(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

/** NEXRAY message id */
export function generateNexrayId(userId) {
    const data = Buffer.allocUnsafe(44);
    data.writeBigUInt64BE(BigInt((Date.now() / 1000) | 0), 0);
    if (userId) {
        const userStr = String(userId).split('@')[0].split(':')[0];
        if (userStr) {
            const len = data.write(userStr, 8);
            data.write('@c.us', 8 + len);
        }
    }
    randomFillSync(data, 28, 16);
    const hash = createHash('sha256').update(data).digest();
    const hex = hash.toString('hex', 0, 9).toUpperCase();
    const baseId = 'NEXRAY' + hex;
    const pos = 4 + (hash[0] & 15);
    return baseId.slice(0, pos) + 'NEXRAY' + baseId.slice(pos);
}

export function generateStealthId(stealth) {
    const hex = (n) => randomBytes(n).toString('hex').toUpperCase();
    switch ((stealth || '').toLowerCase()) {
        case 'ios':
            return '3A' + hex(9);
        case 'web':
            return '3E' + hex(10);
        case 'desktop':
            return '3F' + hex(9);
        case 'android':
            return hex(16);
        default:
            return generateNexrayId();
    }
}

/**
 * explicitId > stealth > NEXRAY (+ optional customId)
 */
export function generateMessageId({ explicitId, stealth, customId, meId } = {}) {
    if (explicitId) return String(explicitId);
    if (stealth) return generateStealthId(stealth);
    let id = generateNexrayId(meId);
    if (customId && customId !== 'NEXRAY' && !id.startsWith(customId)) id = customId + id;
    return id;
}

export function isBotMessageId(id, detector) {
    if (detector == null || detector === false) return false;
    const s = asString(id);
    if (s == null) return false;
    if (detector === true) return true;
    if (typeof detector !== 'function') return false;
    try {
        return Boolean(detector(s));
    } catch {
        return false;
    }
}

export function extractMessageId(key) {
    return key && typeof key === 'object' ? asString(key.id) : null;
}

/**
 * Normalize media input to something Baileys getStream / prepareWAMessageMedia accepts.
 * Accepts: Buffer | path | URL | { url } | { stream } | { image|video|audio|sticker|document: ... }
 */
export function normalizeMediaInput(input) {
    if (input == null) return null;
    if (Buffer.isBuffer(input) || typeof input === 'string') return input;
    if (!isPlainObject(input)) return null;

    if (input.url || input.stream) return input;

    // { video: '...' } | { image: Buffer } etc.
    for (const k of ['image', 'video', 'audio', 'sticker', 'document', 'media']) {
        if (input[k] != null) return normalizeMediaInput(input[k]);
    }
    return null;
}
