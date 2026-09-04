/**
 * Sticker pack metadata + WebP preparation.
 */

import { applyStickerMeta, isWebP, isAnimatedWebP } from './exif.js';

/**
 * Normalize sticker-pack options into a stable internal contract.
 * @param {object} options
 */
export function normalizeStickerPackOptions(options = {}) {
    return {
        name: options.name || options.packname || options.pack || '',
        publisher: options.publisher || options.author || '',
        description: options.description || options.desc || '',
        stickers: Array.isArray(options.stickers) ? options.stickers : [],
        cover: options.cover || options.tray || null
    };
}

/**
 * Ensure buffer is WebP (convert via sharp if needed), optionally apply pack metadata.
 *
 * @param {Buffer} buffer
 * @param {object} [opts]
 * @returns {Promise<{ buffer: Buffer, isAnimated: boolean, isAiSticker?: boolean, premium?: * }>}
 */
export async function prepareStickerBuffer(buffer, opts = {}) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('Sticker input must be a Buffer at this stage');
    }

    let webp = buffer;
    let isAnimated = false;

    if (isWebP(buffer)) {
        isAnimated = isAnimatedWebP(buffer);
    } else {
        const sharpMod = await import('sharp').catch(() => null);
        if (!sharpMod?.default) {
            throw new Error('sharp is required to convert non-WebP stickers. Install: npm i sharp');
        }
        webp = await sharpMod
            .default(buffer)
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
    }

    if (
        opts.packname ||
        opts.author ||
        opts.categories ||
        opts.emojis ||
        opts.looked ||
        opts.isAvatar ||
        opts.isAiSticker ||
        opts.premium != null
    ) {
        webp = applyStickerMeta(webp, opts);
    }

    return {
        buffer: webp,
        isAnimated,
        isAiSticker: !!(opts.isAiSticker || opts.looked),
        isAvatar: !!(opts.isAvatar || opts.looked),
        premium: opts.premium
    };
}
