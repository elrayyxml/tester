/**
 * Sticker buffer preparation and sticker-pack payload builder.
 */

import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { applyStickerMeta, isWebP, isAnimatedWebP } from './exif.js';
import { toMediaSource } from './function.js';

export function normalizeStickerPackOptions(options = {}) {
    return {
        name: options.name || options.packname || options.pack || '',
        publisher: options.publisher || options.author || '',
        description: options.description || options.desc || '',
        stickers: Array.isArray(options.stickers) ? options.stickers : [],
        cover: options.cover || options.tray || null
    };
}

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
            throw new globalThis.Error('sharp is required to convert non-WebP stickers. Install: npm i sharp');
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

async function loadBuffer(input, caps) {
    const source = toMediaSource(input);
    if (Buffer.isBuffer(source)) return source;

    if (source?.url) {
        const url = String(source.url);
        if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
            const res = await fetch(url);
            if (!res.ok) throw new globalThis.Error(`Failed to download media: ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
        }
        return fs.readFile(url);
    }

    if (source?.stream) {
        const chunks = [];
        for await (const chunk of source.stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    }

    if (typeof caps?.getStream === 'function') {
        const { stream } = await caps.getStream(source);
        if (typeof caps.toBuffer === 'function') return caps.toBuffer(stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    }

    throw new globalThis.Error('Unable to resolve sticker media to Buffer');
}

async function ensureWebp(buffer) {
    if (isWebP(buffer)) return { buffer, isAnimated: isAnimatedWebP(buffer) };
    const sharpMod = await import('sharp').catch(() => null);
    if (!sharpMod?.default) {
        throw new globalThis.Error('sharp is required to convert stickers to WebP');
    }
    const webp = await sharpMod
        .default(buffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    return { buffer: webp, isAnimated: false };
}

function fileNameFromHash(buffer) {
    const hash = createHash('sha256').update(buffer).digest('base64').replace(/\//g, '-');
    return `${hash}.webp`;
}

/**
 * Build a stickerPackMessage using JSZip + engine encryptedStream / waUploadToServer.
 * Mirrors prepareStickerPackMessage behavior from messages.md without relying on the
 * generateWAMessageContent `stickers` branch (missing on some Baileys builds).
 *
 * @param {object} pack
 * @param {{ caps: object, upload: Function, logger?: object, mediaCache?: object, options?: object }} ctx
 */
export async function buildStickerPackMessage(pack, ctx) {
    const { caps, upload, logger } = ctx;
    const name = pack.name || pack.packname || '';
    const publisher = pack.publisher || pack.author || '';
    const description = pack.description || pack.desc || '';
    const stickers = pack.stickers || [];
    const cover = pack.cover;

    if (!stickers.length) throw new globalThis.Error('Sticker pack must contain at least one sticker');
    if (stickers.length > 60) throw new globalThis.Error('Sticker pack exceeds the maximum of 60 stickers');
    if (cover == null) throw new globalThis.Error('Sticker pack must include a cover');
    if (typeof upload !== 'function') throw new globalThis.Error('waUploadToServer is required for sticker packs');

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const stickerMetadata = [];

    for (let i = 0; i < stickers.length; i++) {
        const item = stickers[i];
        const raw = await loadBuffer(item.sticker ?? item.data ?? item.media ?? item, caps);
        const { buffer: webp, isAnimated } = await ensureWebp(raw);
        if (webp.length > 1024 * 1024) {
            throw new globalThis.Error(`Sticker at index ${i} exceeds the 1MB size limit`);
        }
        const fileName = fileNameFromHash(webp);
        zip.file(fileName, webp);
        stickerMetadata.push({
            fileName,
            mimetype: 'image/webp',
            isAnimated,
            emojis: Array.isArray(item.emojis) ? item.emojis : Array.isArray(pack.emojis) ? pack.emojis : [],
            accessibilityLabel: item.accessibilityLabel || item.accessibilityText || `sticker ${i + 1}`
        });
    }

    const coverRaw = await loadBuffer(cover, caps);
    const { buffer: coverWebp } = await ensureWebp(coverRaw);
    const stickerPackId =
        (typeof caps.generateMessageIDV2 === 'function' ? caps.generateMessageIDV2() : null) ||
        randomBytes(8).toString('hex').toUpperCase();
    const trayIconFileName = `${stickerPackId}.webp`;
    zip.file(trayIconFileName, coverWebp);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

    let packUpload;
    let thumbUpload;
    let thumbnailBuffer;

    if (typeof caps.encryptedStream === 'function') {
        const packEnc = await caps.encryptedStream(zipBuffer, 'sticker-pack', {
            logger,
            opts: ctx.options
        });
        try {
            const packResult = await upload(packEnc.encFilePath, {
                fileEncSha256B64: packEnc.fileEncSha256.toString('base64'),
                mediaType: 'sticker-pack',
                timeoutMs: ctx.mediaUploadTimeoutMs
            });
            packUpload = {
                mediaKey: packEnc.mediaKey,
                fileSha256: packEnc.fileSha256,
                fileEncSha256: packEnc.fileEncSha256,
                fileLength: packEnc.fileLength,
                directPath: packResult.directPath
            };
        } finally {
            await fs.unlink(packEnc.encFilePath).catch(() => {});
        }

        try {
            const sharpMod = await import('sharp').catch(() => null);
            if (sharpMod?.default) {
                thumbnailBuffer = await sharpMod.default(coverWebp).resize(252, 252).jpeg().toBuffer();
            }
        } catch {
            thumbnailBuffer = null;
        }

        if (thumbnailBuffer?.length) {
            const thumbEnc = await caps.encryptedStream(thumbnailBuffer, 'thumbnail-sticker-pack', {
                logger,
                opts: ctx.options,
                mediaKey: packUpload.mediaKey
            });
            try {
                const thumbResult = await upload(thumbEnc.encFilePath, {
                    fileEncSha256B64: thumbEnc.fileEncSha256.toString('base64'),
                    mediaType: 'thumbnail-sticker-pack',
                    timeoutMs: ctx.mediaUploadTimeoutMs
                });
                thumbUpload = {
                    directPath: thumbResult.directPath,
                    fileSha256: thumbEnc.fileSha256,
                    fileEncSha256: thumbEnc.fileEncSha256
                };
            } finally {
                await fs.unlink(thumbEnc.encFilePath).catch(() => {});
            }
        }
    } else {
        throw new globalThis.Error(
            'Engine is missing encryptedStream. Use a Baileys build that exports Utils.encryptedStream for sticker packs.'
        );
    }

    const origin =
        caps.proto?.Message?.StickerPackMessage?.StickerPackOrigin?.USER_CREATED ?? 1;

    const stickerPackMessage = {
        stickerPackId,
        name,
        publisher,
        packDescription: description,
        stickerPackOrigin: origin,
        stickerPackSize: zipBuffer.length,
        stickers: stickerMetadata,
        fileSha256: packUpload.fileSha256,
        fileEncSha256: packUpload.fileEncSha256,
        mediaKey: packUpload.mediaKey,
        directPath: packUpload.directPath,
        fileLength: packUpload.fileLength,
        mediaKeyTimestamp: Math.floor(Date.now() / 1000),
        trayIconFileName
    };

    if (thumbUpload) {
        Object.assign(stickerPackMessage, {
            thumbnailDirectPath: thumbUpload.directPath,
            thumbnailSha256: thumbUpload.fileSha256,
            thumbnailEncSha256: thumbUpload.fileEncSha256,
            thumbnailHeight: 252,
            thumbnailWidth: 252,
            imageDataHash: createHash('sha256').update(thumbnailBuffer).digest('base64')
        });
    }

    return stickerPackMessage;
}
