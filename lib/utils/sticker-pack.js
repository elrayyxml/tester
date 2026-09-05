/**
 * Sticker and sticker-pack preparation utilities.
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
        const sharp = (await import('sharp').catch(() => null))?.default;
        if (!sharp) {
            throw new globalThis.Error('sharp is required to convert non-WebP stickers');
        }
        webp = await sharp(buffer)
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

async function readMediaBuffer(input, caps) {
    const source = toMediaSource(input);
    if (Buffer.isBuffer(source)) return source;

    if (source?.url) {
        const url = String(source.url);
        if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
            const response = await fetch(url);
            if (!response.ok) throw new globalThis.Error(`Failed to download media (${response.status})`);
            return Buffer.from(await response.arrayBuffer());
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

    throw new globalThis.Error('Unable to resolve media input');
}

async function toWebpSticker(buffer) {
    if (isWebP(buffer)) {
        return { buffer, isAnimated: isAnimatedWebP(buffer) };
    }
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp is required to convert stickers to WebP');
    const webp = await sharp(buffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    return { buffer: webp, isAnimated: false };
}

/** Tray icon: static 96–512 webp, cover-fit (matches Baileys / pastebin). */
async function createTrayIcon(coverBuffer) {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp is required for sticker pack tray icon');
    return sharp(coverBuffer, { animated: false })
        .resize(512, 512, { fit: 'cover' })
        .webp({ quality: 90 })
        .toBuffer();
}

/** Pack list thumbnail: JPEG 252×252 (messages.md). */
async function createPackThumbnail(trayBuffer) {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp is required for sticker pack thumbnail');
    return sharp(trayBuffer, { animated: false })
        .resize(252, 252, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
}

async function createArchive(entries) {
    try {
        const { zip } = await import('fflate');
        const data = {};
        for (const [name, buffer] of Object.entries(entries)) {
            data[name] = [new Uint8Array(buffer), { level: 0 }];
        }
        return await new Promise((resolve, reject) => {
            zip(data, (error, output) => (error ? reject(error) : resolve(Buffer.from(output))));
        });
    } catch {
        const JSZip = (await import('jszip')).default;
        const archive = new JSZip();
        for (const [name, buffer] of Object.entries(entries)) {
            archive.file(name, buffer);
        }
        return archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    }
}

async function encryptAndUpload(buffer, mediaType, { encryptedStream, upload, logger, options, mediaKey, timeoutMs }) {
    const encrypted = await encryptedStream(buffer, mediaType, { logger, opts: options, mediaKey });
    try {
        const result = await upload(encrypted.encFilePath, {
            fileEncSha256B64: encrypted.fileEncSha256.toString('base64'),
            mediaType,
            timeoutMs
        });
        const directPath = result?.directPath || result?.direct_path;
        if (!directPath) {
            throw new globalThis.Error(`Upload returned no directPath for ${mediaType}`);
        }
        return {
            mediaKey: encrypted.mediaKey,
            fileSha256: encrypted.fileSha256,
            fileEncSha256: encrypted.fileEncSha256,
            fileLength: encrypted.fileLength,
            directPath
        };
    } finally {
        await fs.unlink(encrypted.encFilePath).catch(() => {});
    }
}

/**
 * Build a stickerPackMessage compatible with Baileys prepareStickerPackMessage.
 *
 * @param {object} pack
 * @param {{ caps: object, upload: Function, logger?: object, options?: object, mediaUploadTimeoutMs?: number }} context
 */
export async function buildStickerPackMessage(pack, context) {
    const { caps, upload, logger, options } = context;
    const timeoutMs = context.mediaUploadTimeoutMs || 60000;

    if (typeof caps?.encryptedStream !== 'function') {
        throw new globalThis.Error('Engine must expose encryptedStream for sticker packs');
    }
    if (typeof upload !== 'function') {
        throw new globalThis.Error('waUploadToServer is required for sticker packs');
    }

    const stickers = pack.stickers || [];
    if (!stickers.length) throw new globalThis.Error('Sticker pack must contain at least one sticker');
    if (stickers.length > 60) throw new globalThis.Error('Sticker pack exceeds the maximum of 60 stickers');
    if (pack.cover == null) throw new globalThis.Error('Sticker pack must include a cover');

    const archiveEntries = {};
    const stickerEntries = [];
    const defaultEmojis = Array.isArray(pack.emojis) ? pack.emojis : [];

    for (let index = 0; index < stickers.length; index++) {
        const item = stickers[index];
        const raw = await readMediaBuffer(item.sticker ?? item.data ?? item.media ?? item, caps);
        const { buffer, isAnimated } = await toWebpSticker(raw);
        if (buffer.length > 1024 * 1024) {
            throw new globalThis.Error(`Sticker at index ${index} exceeds the 1MB size limit`);
        }

        const fileName = `${createHash('sha256').update(buffer).digest('base64').replace(/\//g, '-')}.webp`;
        archiveEntries[fileName] = buffer;
        stickerEntries.push({
            fileName,
            mimetype: 'image/webp',
            isAnimated,
            emojis: Array.isArray(item.emojis) ? item.emojis : defaultEmojis,
            accessibilityLabel: item.accessibilityLabel || item.accessibilityText || `sticker ${index + 1}`
        });
    }

    const coverBuffer = await readMediaBuffer(pack.cover, caps);
    const trayIcon = await createTrayIcon(coverBuffer);
    const packId =
        (typeof caps.generateMessageIDV2 === 'function' && caps.generateMessageIDV2()) ||
        randomBytes(8).toString('hex').toUpperCase();
    const trayIconFileName = `${packId}.webp`;
    archiveEntries[trayIconFileName] = trayIcon;

    const archive = await createArchive(archiveEntries);
    const packUpload = await encryptAndUpload(archive, 'sticker-pack', {
        encryptedStream: caps.encryptedStream,
        upload,
        logger,
        options,
        timeoutMs
    });

    const thumbnail = await createPackThumbnail(trayIcon);
    const thumbUpload = await encryptAndUpload(thumbnail, 'thumbnail-sticker-pack', {
        encryptedStream: caps.encryptedStream,
        upload,
        logger,
        options,
        mediaKey: packUpload.mediaKey,
        timeoutMs
    });

    const origin = caps.proto?.Message?.StickerPackMessage?.StickerPackOrigin?.USER_CREATED ?? 1;

    return {
        stickerPackId: packId,
        name: pack.name || pack.packname || '',
        publisher: pack.publisher || pack.author || '',
        packDescription: pack.description || pack.desc || '',
        stickerPackOrigin: origin,
        stickerPackSize: archive.length,
        stickers: stickerEntries,
        fileSha256: packUpload.fileSha256,
        fileEncSha256: packUpload.fileEncSha256,
        mediaKey: packUpload.mediaKey,
        directPath: packUpload.directPath,
        fileLength: packUpload.fileLength,
        mediaKeyTimestamp: Math.floor(Date.now() / 1000),
        trayIconFileName,
        thumbnailDirectPath: thumbUpload.directPath,
        thumbnailSha256: thumbUpload.fileSha256,
        thumbnailEncSha256: thumbUpload.fileEncSha256,
        thumbnailHeight: 252,
        thumbnailWidth: 252,
        imageDataHash: createHash('sha256').update(thumbnail).digest('base64')
    };
}
