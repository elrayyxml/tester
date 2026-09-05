/**
 * Sticker buffer preparation and sticker-pack payload builder.
 */

import { createHash, randomBytes } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { request as httpsRequest } from 'https';
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

function toUploadToken(fileEncSha256) {
    return fileEncSha256
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

/**
 * Create zip archive — prefer fflate (Baileys format), fallback JSZip STORE.
 */
async function createPackZip(files) {
    try {
        const { zip } = await import('fflate');
        const data = {};
        for (const [name, buf] of Object.entries(files)) {
            data[name] = [new Uint8Array(buf), { level: 0 }];
        }
        return await new Promise((resolve, reject) => {
            zip(data, (err, out) => (err ? reject(err) : resolve(Buffer.from(out))));
        });
    } catch {
        const JSZip = (await import('jszip')).default;
        const archive = new JSZip();
        for (const [name, buf] of Object.entries(files)) {
            archive.file(name, buf);
        }
        return archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    }
}

function uploadFileHttp(url, filePath, headers, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const req = httpsRequest(
            url,
            { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, timeout: timeoutMs },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new globalThis.Error(`Upload HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new globalThis.Error(`Upload response is not JSON: ${body.slice(0, 200)}`));
                    }
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new globalThis.Error('Upload timeout'));
        });
        createReadStream(filePath).pipe(req);
    });
}

/**
 * Upload encrypted pack using waUploadToServer, with hard path fallback via refreshMediaConn.
 */
async function uploadPackMedia(sock, upload, encFilePath, fileEncSha256, mediaType, mediaPath, timeoutMs) {
    const fileEncSha256B64 = fileEncSha256.toString('base64');

    if (typeof upload === 'function') {
        try {
            const result = await upload(encFilePath, {
                fileEncSha256B64,
                mediaType,
                timeoutMs
            });
            if (result?.directPath || result?.direct_path || result?.mediaUrl) {
                return {
                    directPath: result.directPath || result.direct_path,
                    mediaUrl: result.mediaUrl || result.url
                };
            }
        } catch {
            /* fall through to manual path */
        }
    }

    if (typeof sock?.refreshMediaConn !== 'function') {
        throw new globalThis.Error(
            'Media upload failed on all hosts (and refreshMediaConn is unavailable for fallback)'
        );
    }

    const info = await sock.refreshMediaConn(true);
    const token = toUploadToken(fileEncSha256);
    const auth = encodeURIComponent(info.auth);
    const hosts = info.hosts || [];
    let lastError;

    for (const host of hosts) {
        const hostname = host.hostname || host;
        const url = `https://${hostname}${mediaPath}/${encodeURIComponent(token)}?auth=${auth}&token=${encodeURIComponent(token)}`;
        try {
            const json = await uploadFileHttp(url, encFilePath, { Origin: 'https://web.whatsapp.com' }, timeoutMs);
            const directPath = json.direct_path || json.directPath || json.url || json.path;
            if (directPath) {
                return { directPath, mediaUrl: json.url };
            }
            lastError = new globalThis.Error('Upload response missing directPath');
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new globalThis.Error('Media upload failed on all hosts');
}

/**
 * Build stickerPackMessage (messages.md prepareStickerPackMessage shape).
 *
 * @param {object} pack
 * @param {{ caps: object, upload: Function, sock?: object, logger?: object, options?: object, mediaUploadTimeoutMs?: number }} ctx
 */
export async function buildStickerPackMessage(pack, ctx) {
    const { caps, upload, sock, logger } = ctx;
    const name = pack.name || pack.packname || '';
    const publisher = pack.publisher || pack.author || '';
    const description = pack.description || pack.desc || '';
    const stickers = pack.stickers || [];
    const cover = pack.cover;
    const timeoutMs = ctx.mediaUploadTimeoutMs || 60000;

    if (!stickers.length) throw new globalThis.Error('Sticker pack must contain at least one sticker');
    if (stickers.length > 60) throw new globalThis.Error('Sticker pack exceeds the maximum of 60 stickers');
    if (cover == null) throw new globalThis.Error('Sticker pack must include a cover');
    if (typeof caps.encryptedStream !== 'function') {
        throw new globalThis.Error(
            'Engine is missing encryptedStream. Use a Baileys build that exports Utils.encryptedStream.'
        );
    }

    const files = {};
    const stickerMetadata = [];

    for (let i = 0; i < stickers.length; i++) {
        const item = stickers[i];
        const raw = await loadBuffer(item.sticker ?? item.data ?? item.media ?? item, caps);
        const { buffer: webp, isAnimated } = await ensureWebp(raw);
        if (webp.length > 1024 * 1024) {
            throw new globalThis.Error(`Sticker at index ${i} exceeds the 1MB size limit`);
        }
        const fileName = fileNameFromHash(webp);
        files[fileName] = webp;
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
    files[trayIconFileName] = coverWebp;

    const zipBuffer = await createPackZip(files);

    const packEnc = await caps.encryptedStream(zipBuffer, 'sticker-pack', {
        logger,
        opts: ctx.options
    });

    let packUpload;
    try {
        const uploaded = await uploadPackMedia(
            sock,
            upload,
            packEnc.encFilePath,
            packEnc.fileEncSha256,
            'sticker-pack',
            '/mms/sticker-pack',
            timeoutMs
        );
        packUpload = {
            mediaKey: packEnc.mediaKey,
            fileSha256: packEnc.fileSha256,
            fileEncSha256: packEnc.fileEncSha256,
            fileLength: packEnc.fileLength,
            directPath: uploaded.directPath
        };
    } finally {
        await fs.unlink(packEnc.encFilePath).catch(() => {});
    }

    let thumbMeta = null;
    try {
        const sharpMod = await import('sharp').catch(() => null);
        if (sharpMod?.default) {
            const thumbnailBuffer = await sharpMod.default(coverWebp).resize(252, 252).jpeg().toBuffer();
            const thumbEnc = await caps.encryptedStream(thumbnailBuffer, 'thumbnail-sticker-pack', {
                logger,
                opts: ctx.options,
                mediaKey: packUpload.mediaKey
            });
            try {
                const thumbUploaded = await uploadPackMedia(
                    sock,
                    upload,
                    thumbEnc.encFilePath,
                    thumbEnc.fileEncSha256,
                    'thumbnail-sticker-pack',
                    '/mms/thumbnail-sticker-pack',
                    timeoutMs
                );
                thumbMeta = {
                    thumbnailDirectPath: thumbUploaded.directPath,
                    thumbnailSha256: thumbEnc.fileSha256,
                    thumbnailEncSha256: thumbEnc.fileEncSha256,
                    thumbnailHeight: 252,
                    thumbnailWidth: 252,
                    imageDataHash: createHash('sha256').update(thumbnailBuffer).digest('base64')
                };
            } finally {
                await fs.unlink(thumbEnc.encFilePath).catch(() => {});
            }
        }
    } catch {
        /* thumbnail optional */
    }

    const origin = caps.proto?.Message?.StickerPackMessage?.StickerPackOrigin?.USER_CREATED ?? 1;

    return {
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
        trayIconFileName,
        ...(thumbMeta || {})
    };
}
