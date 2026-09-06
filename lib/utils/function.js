/**
 * Message identifier helpers and media source normalization.
 */

import { createHash, randomBytes, randomFillSync } from 'crypto';

export function asString(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    return null;
}

/**
 * Normalize media input for Baileys getStream / prepareWAMessageMedia.
 * Accepts Buffer, path/URL string, { url }, { stream }, or { image|video|...: source }.
 * Local paths stay as `{ url }` (Baileys reads via fs); remote URLs the same.
 * @param {*} input
 * @returns {*}
 */
export function toMediaSource(input) {
    if (input == null) return input;
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) return Buffer.from(input);
    if (typeof input === 'string') return { url: input };
    if (typeof input !== 'object') return input;
    if (input.url != null || input.stream != null) return input;
    for (const key of ['image', 'video', 'audio', 'sticker', 'document', 'media']) {
        if (input[key] != null) return toMediaSource(input[key]);
    }
    return input;
}

/**
 * Resolve media to Buffer when possible (local path / url string / buffer).
 * Avoids crypto "Received an instance of Object" when libs expect string|Buffer.
 * @param {*} input
 * @returns {Promise<Buffer|object>}
 */
export async function resolveMediaBuffer(input) {
    const src = toMediaSource(input);
    if (src == null) return src;
    if (Buffer.isBuffer(src)) return src;
    if (typeof src === 'object' && src.stream) return src;
    const url = typeof src === 'object' ? src.url : null;
    if (typeof url !== 'string') return src;
    if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return { url };
    try {
        const { readFile } = await import('fs/promises');
        return await readFile(url);
    } catch {
        return { url };
    }
}

/** @deprecated use toMediaSource */
export const asMedia = toMediaSource;

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

export function generateMessageId({ explicitId, stealth, customId, meId } = {}) {
    if (explicitId) return String(explicitId);
    if (stealth) return generateStealthId(stealth);
    let id = generateNexrayId(meId);
    if (customId && customId !== 'NEXRAY' && !id.startsWith(customId)) id = customId + id;
    return id;
}

export function isBotMessageId(id, detector) {
    if (detector == null || detector === false) return false;
    const value = asString(id);
    if (value == null) return false;
    if (detector === true) return true;
    if (typeof detector !== 'function') return false;
    try {
        return Boolean(detector(value));
    } catch {
        return false;
    }
}

export function extractMessageId(key) {
    return key && typeof key === 'object' ? asString(key.id) : null;
}

/* ── generic content predicates (messages.md utils/generics.js) ───────── */

/**
 * True if `key` exists on `message` and its value is neither null nor undefined.
 * The core predicate the messages.md if-else content-router is built on.
 */
export function hasNonNullishProperty(message, key) {
    return message != null &&
        typeof message === 'object' &&
        key in message &&
        message[key] != null;
}

/** @deprecated alias kept for messages.md naming parity — same behavior as hasNonNullishProperty */
export function hasOptionalProperty(obj, key) {
    return obj != null &&
        typeof obj === 'object' &&
        key in obj &&
        obj[key] != null;
}

/** Validate album message media (messages.md hasValidAlbumMedia). */
export function hasValidAlbumMedia(message) {
    return !!(message?.imageMessage || message?.videoMessage);
}

/** Validate interactive message header media (messages.md hasValidInteractiveHeader). */
export function hasValidInteractiveHeader(message) {
    return !!(message?.imageMessage ||
        message?.videoMessage ||
        message?.documentMessage ||
        message?.productMessage ||
        message?.locationMessage);
}

/** Validate carousel card header media (messages.md hasValidCarouselHeader). */
export function hasValidCarouselHeader(message) {
    return !!(message?.imageMessage ||
        message?.videoMessage ||
        message?.productMessage);
}
