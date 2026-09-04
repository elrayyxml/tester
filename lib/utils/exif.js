/**
 * WebP EXIF helpers for WhatsApp stickers.
 * Based on payload analysis of anti-colong / premium sticker references
 * (TIFF-style EXIF with AW tag + JSON metadata).
 */

/**
 * Build WhatsApp sticker EXIF payload from metadata JSON.
 * @param {object} metadata
 * @returns {Buffer}
 */
export function buildStickerExif(metadata) {
    const json = Buffer.from(JSON.stringify(metadata), 'utf-8');
    const exif = Buffer.concat([
        Buffer.from([
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
            0x07, 0x00
        ]),
        Buffer.alloc(4),
        Buffer.from([0x16, 0x00, 0x00, 0x00]),
        json
    ]);
    exif.writeUInt32LE(json.length, 14);
    return exif;
}

/**
 * Create a RIFF chunk.
 * @param {string} type - 4-char FourCC
 * @param {Buffer} data
 * @returns {Buffer}
 */
function makeChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const sizeBuffer = Buffer.alloc(4);
    sizeBuffer.writeUInt32LE(data.length, 0);
    const padding = data.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
    return Buffer.concat([typeBuffer, sizeBuffer, data, padding]);
}

/**
 * Inject / replace EXIF chunk on a WebP buffer.
 * @param {Buffer} webpBuffer
 * @param {object} metadata - sticker-pack-id, sticker-pack-name, sticker-pack-publisher, emojis, ...
 * @returns {Buffer}
 */
export function setWebpExif(webpBuffer, metadata) {
    if (
        !Buffer.isBuffer(webpBuffer) ||
        webpBuffer.length < 12 ||
        webpBuffer.slice(0, 4).toString() !== 'RIFF' ||
        webpBuffer.slice(8, 12).toString() !== 'WEBP'
    ) {
        throw new Error('Invalid WebP buffer');
    }

    const chunks = [];
    let offset = 12;

    while (offset + 8 <= webpBuffer.length) {
        const type = webpBuffer.slice(offset, offset + 4).toString();
        const size = webpBuffer.readUInt32LE(offset + 4);
        const chunkEnd = offset + 8 + size + (size % 2);
        if (chunkEnd > webpBuffer.length) break;
        if (type !== 'EXIF') {
            chunks.push(webpBuffer.slice(offset, chunkEnd));
        }
        offset = chunkEnd;
    }

    const exifChunk = makeChunk('EXIF', buildStickerExif(metadata));
    const body = Buffer.concat([...chunks, exifChunk]);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0);
    header.writeUInt32LE(body.length + 4, 4);
    header.write('WEBP', 8);
    return Buffer.concat([header, body]);
}

/**
 * Convenience: packname + author → EXIF-injected WebP.
 * @param {Buffer} webpBuffer
 * @param {{ packname?: string, author?: string, categories?: string[], id?: string }} opts
 * @returns {Buffer}
 */
export function applyStickerMeta(webpBuffer, opts = {}) {
    const metadata = {
        'sticker-pack-id': opts.id || 'nexray.sticker',
        'sticker-pack-name': opts.packname || opts.pack || opts.name || '',
        'sticker-pack-publisher': opts.author || opts.publisher || '',
        emojis: Array.isArray(opts.categories) ? opts.categories : opts.emojis || []
    };
    if (opts.accessibilityLabel || opts['accessibility-text']) {
        metadata['accessibility-text'] = opts.accessibilityLabel || opts['accessibility-text'];
    }
    // anti-colong (looked)
    if (opts.looked || opts.isAvatar || opts.isAiSticker) {
        metadata['is-avatar-sticker'] = 1;
        metadata['is-ai-sticker'] = 1;
        metadata['is-from-sticker-maker'] = 0;
        metadata['avatar-sticker-template-id'] = opts.avatarTemplateId || 'whatsapp';
        metadata['is-avatar-country-sticker'] = 1;
        metadata['is-avatar-instant-sticker'] = 1;
        metadata['sticker-maker-source-type'] = 4;
        metadata['is-avatar-social-sticker'] = 1;
        metadata['avatar-sticker-style'] = 'whatsapp';
        metadata['is-from-user-created-pack'] = 1;
    }
    // premium sticker
    if (opts.premium != null && opts.premium !== false) {
        metadata.premium = opts.premium === true ? 1 : opts.premium;
        metadata['is-avatar-sticker'] = metadata['is-avatar-sticker'] ?? 1;
        metadata['is-ai-sticker'] = metadata['is-ai-sticker'] ?? 1;
    }
    if (opts.metadata && typeof opts.metadata === 'object') {
        Object.assign(metadata, opts.metadata);
    }
    return setWebpExif(webpBuffer, metadata);
}

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isWebP(buffer) {
    return (
        Buffer.isBuffer(buffer) &&
        buffer.length >= 12 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    );
}

/**
 * Detect animated WebP (VP8X animation flag / ANIM / ANMF).
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isAnimatedWebP(buffer) {
    if (!isWebP(buffer)) return false;
    let offset = 12;
    while (offset < buffer.length - 8) {
        const chunk = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        if (chunk === 'VP8X' && offset + 8 < buffer.length && buffer[offset + 8] & 0x02) {
            return true;
        }
        if (chunk === 'ANIM' || chunk === 'ANMF') return true;
        offset += 8 + size + (size % 2);
    }
    return false;
}

/** @deprecated use applyStickerMeta */
export function createStickerExif(meta = {}) {
    return buildStickerExif({
        'sticker-pack-id': meta.id || 'nexray.sticker',
        'sticker-pack-name': meta.packname || meta.pack || '',
        'sticker-pack-publisher': meta.author || meta.publisher || '',
        emojis: meta.categories || []
    });
}
