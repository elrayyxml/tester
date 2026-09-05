/**
 * Sticker buffer prep and sticker-pack builder (/mms upload).
 */

import {
    createCipheriv,
    createHash,
    createHmac,
    hkdfSync,
    randomBytes
} from 'crypto';
import { request as httpsRequest } from 'https';
import { applyStickerMeta, isWebP, isAnimatedWebP } from './exif.js';
import { toMediaSource } from './function.js';

const PACK_HKDF = 'WhatsApp Sticker Pack Keys';
const THUMB_HKDF = 'WhatsApp Sticker Pack Thumbnail Keys';
const PACK_PATH = '/mms/sticker-pack';
const THUMB_PATH = '/mms/thumbnail-sticker-pack';

export function normalizeStickerPackOptions(options = {}) {
    return {
        name: options.name || options.packname || '',
        publisher: options.publisher || options.author || '',
        description: options.description || '',
        stickers: Array.isArray(options.stickers) ? options.stickers : [],
        cover: options.cover || null
    };
}

export async function prepareStickerBuffer(buffer, opts = {}) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('Buffer required');

    let webp = buffer;
    let isAnimated = false;

    if (isWebP(buffer)) {
        isAnimated = isAnimatedWebP(buffer);
    } else {
        const sharp = (await import('sharp').catch(() => null))?.default;
        if (!sharp) throw new globalThis.Error('sharp required');
        webp = await sharp(buffer).resize(512, 512, { fit: 'inside' }).webp({ quality: 80 }).toBuffer();
    }

    if (opts.packname || opts.author || opts.emojis || opts.looked || opts.isAvatar || opts.premium != null) {
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

async function loadBuffer(input) {
    const src = toMediaSource(input);
    if (Buffer.isBuffer(src)) return src;

    if (src?.url) {
        if (/^https?:\/\//i.test(src.url)) {
            const res = await fetch(src.url);
            if (!res.ok) throw new globalThis.Error(`download failed: ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
        }
        const { readFile } = await import('fs/promises');
        return readFile(src.url);
    }

    throw new globalThis.Error('invalid media');
}

async function toWebp(buffer) {
    if (isWebP(buffer)) return { buffer, animated: isAnimatedWebP(buffer) };
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp required');
    return {
        buffer: await sharp(buffer).resize(512, 512, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
        animated: false
    };
}

async function resizeCover(buffer, format) {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp required');
    const image = sharp(buffer, { animated: false }).resize(252, 252, { fit: 'cover' });
    return format === 'webp' ? image.webp().toBuffer() : image.jpeg().toBuffer();
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest();
}

function encryptMedia(buffer, hkdfInfo, mediaKey = randomBytes(32)) {
    const keys = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(hkdfInfo), 112));
    const iv = keys.subarray(0, 16);
    const cipherKey = keys.subarray(16, 48);
    const macKey = keys.subarray(48, 80);

    const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const mac = createHmac('sha256', macKey).update(iv).update(encrypted).digest().subarray(0, 10);
    const encBuffer = Buffer.concat([encrypted, mac]);

    return {
        mediaKey,
        fileSha256: sha256(buffer),
        fileEncSha256: sha256(encBuffer),
        fileLength: buffer.length,
        encBuffer
    };
}

async function getMediaConn(sock) {
    if (typeof sock?.refreshMediaConn === 'function') {
        const info = await sock.refreshMediaConn(true);
        return {
            auth: info.auth,
            hosts: (info.hosts || []).map((h) => h.hostname || h).filter(Boolean)
        };
    }

    if (typeof sock?.query !== 'function') {
        throw new globalThis.Error('media_conn unavailable');
    }

    const iq = await sock.query({
        tag: 'iq',
        attrs: {
            id: sock.generateMessageTag?.() || String(Date.now()),
            to: 's.whatsapp.net',
            type: 'set',
            xmlns: 'w:m'
        },
        content: [{ tag: 'media_conn', attrs: {} }]
    });

    const node = iq.content?.find((n) => n.tag === 'media_conn');
    if (!node?.attrs?.auth) throw new globalThis.Error('media_conn auth missing');

    const hosts = (node.content || [])
        .filter((n) => n.tag === 'host')
        .map((n) => n.attrs?.hostname)
        .filter(Boolean);

    if (!hosts.length) throw new globalThis.Error('media_conn hosts missing');
    return { auth: node.attrs.auth, hosts };
}

function postBuffer(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = httpsRequest(
            {
                hostname: parsed.hostname,
                port: 443,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    Origin: 'https://web.whatsapp.com',
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': body.length
                }
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode >= 400) {
                        reject(new globalThis.Error(`upload ${res.statusCode}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(text));
                    } catch {
                        reject(new globalThis.Error('invalid upload response'));
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function uploadMms(sock, buffer, { hkdf, mediaPath, mediaKey }) {
    const enc = encryptMedia(buffer, hkdf, mediaKey);
    const { auth, hosts } = await getMediaConn(sock);
    const token = encodeURIComponent(
        enc.fileEncSha256.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    );

    let lastError;
    for (const host of hosts) {
        try {
            const json = await postBuffer(
                `https://${host}${mediaPath}/${token}?auth=${encodeURIComponent(auth)}&token=${token}`,
                enc.encBuffer
            );
            const directPath = json.direct_path || json.directPath || json.url;
            if (!directPath) throw new globalThis.Error('directPath missing');
            return { ...enc, directPath };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new globalThis.Error('mms upload failed');
}

async function makeZip(files) {
    try {
        const { zip } = await import('fflate');
        const data = Object.fromEntries(
            Object.entries(files).map(([name, buf]) => [name, [new Uint8Array(buf), { level: 0 }]])
        );
        return await new Promise((resolve, reject) => {
            zip(data, (err, out) => (err ? reject(err) : resolve(Buffer.from(out))));
        });
    } catch {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (const [name, buf] of Object.entries(files)) zip.file(name, buf);
        return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    }
}

/**
 * Build stickerPackMessage using /mms/sticker-pack upload.
 */
export async function buildStickerPackMessage(pack, { sock, caps }) {
    const items = pack.stickers || [];
    if (!items.length) throw new globalThis.Error('stickers required');
    if (items.length > 60) throw new globalThis.Error('max 60 stickers');
    if (pack.cover == null) throw new globalThis.Error('cover required');
    if (!sock) throw new globalThis.Error('socket required');

    const files = {};
    const stickers = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const raw = await loadBuffer(item.sticker ?? item.data ?? item);
        const { buffer, animated } = await toWebp(raw);
        if (buffer.length > 1024 * 1024) throw new globalThis.Error(`sticker ${i} > 1MB`);

        const fileName = `${sha256(buffer).toString('base64').replace(/\//g, '-')}.webp`;
        files[fileName] = buffer;
        stickers.push({
            fileName,
            mimetype: 'image/webp',
            isAnimated: animated,
            emojis: item.emojis || pack.emojis || [],
            accessibilityLabel: item.accessibilityLabel || '‎'
        });
    }

    const cover = await loadBuffer(pack.cover);
    const tray = await resizeCover(cover, 'webp');
    const packId =
        (typeof caps?.generateMessageIDV2 === 'function' && caps.generateMessageIDV2()) ||
        randomBytes(8).toString('hex').toUpperCase();
    const trayIconFileName = `${packId}.webp`;
    files[trayIconFileName] = tray;

    const archive = await makeZip(files);
    const packUpload = await uploadMms(sock, archive, { hkdf: PACK_HKDF, mediaPath: PACK_PATH });
    const thumb = await resizeCover(cover, 'jpeg');
    const thumbUpload = await uploadMms(sock, thumb, {
        hkdf: THUMB_HKDF,
        mediaPath: THUMB_PATH,
        mediaKey: packUpload.mediaKey
    });

    const origin = caps?.proto?.Message?.StickerPackMessage?.StickerPackOrigin?.USER_CREATED ?? 1;

    return {
        name: pack.name || '',
        publisher: pack.publisher || '',
        stickerPackId: packId,
        packDescription: pack.description || '',
        stickerPackOrigin: origin,
        stickerPackSize: archive.length,
        stickers,
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
        imageDataHash: sha256(thumb).toString('base64')
    };
}
