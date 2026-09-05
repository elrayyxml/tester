/**
 * Sticker + sticker-pack helpers.
 * Pack upload uses /mms/sticker-pack (media_conn), same approach as technical reference.
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

async function toWebp(buf) {
    if (isWebP(buf)) return { buf, animated: isAnimatedWebP(buf) };
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp required');
    return {
        buf: await sharp(buf).resize(512, 512, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
        animated: false
    };
}

async function makeTray(buf) {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp required');
    return sharp(buf, { animated: false }).resize(252, 252, { fit: 'cover' }).webp().toBuffer();
}

async function makeThumb(buf) {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new globalThis.Error('sharp required');
    return sharp(buf, { animated: false }).resize(252, 252, { fit: 'cover' }).jpeg().toBuffer();
}

function sha256(buf) {
    return createHash('sha256').update(buf).digest();
}

function encryptMedia(buffer, hkdfInfo, mediaKey = randomBytes(32)) {
    const expanded = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(hkdfInfo), 112));
    const iv = expanded.subarray(0, 16);
    const cipherKey = expanded.subarray(16, 48);
    const macKey = expanded.subarray(48, 80);

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

async function fetchMediaConn(sock) {
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

function postEnc(url, encBuffer) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = httpsRequest(
            {
                hostname: u.hostname,
                port: 443,
                path: u.pathname + u.search,
                method: 'POST',
                headers: {
                    Origin: 'https://web.whatsapp.com',
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': encBuffer.length
                }
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode >= 400) {
                        reject(new globalThis.Error(`upload ${res.statusCode}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new globalThis.Error('invalid upload response'));
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(encBuffer);
        req.end();
    });
}

/** Upload encrypted media to /mms/... via media_conn hosts. */
async function uploadMms(sock, buffer, { hkdf, mediaPath, mediaKey }) {
    const enc = encryptMedia(buffer, hkdf, mediaKey);
    const { auth, hosts } = await fetchMediaConn(sock);
    const token = encodeURIComponent(
        enc.fileEncSha256.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    );

    let lastError;
    for (const host of hosts) {
        try {
            const json = await postEnc(
                `https://${host}${mediaPath}/${token}?auth=${encodeURIComponent(auth)}&token=${token}`,
                enc.encBuffer
            );
            const directPath = json.direct_path || json.directPath || json.url;
            if (!directPath) throw new globalThis.Error('directPath missing');
            return { ...enc, directPath };
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new globalThis.Error('mms upload failed');
}

async function makeZip(files) {
    try {
        const { zip } = await import('fflate');
        const data = Object.fromEntries(
            Object.entries(files).map(([k, v]) => [k, [new Uint8Array(v), { level: 0 }]])
        );
        return await new Promise((resolve, reject) => {
            zip(data, (err, out) => (err ? reject(err) : resolve(Buffer.from(out))));
        });
    } catch {
        const JSZip = (await import('jszip')).default;
        const z = new JSZip();
        for (const [k, v] of Object.entries(files)) z.file(k, v);
        return z.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    }
}

/**
 * Build stickerPackMessage (messages.md fields) using /mms upload.
 */
export async function buildStickerPackMessage(pack, { sock, caps }) {
    const items = pack.stickers || [];
    if (!items.length) throw new globalThis.Error('stickers required');
    if (items.length > 60) throw new globalThis.Error('max 60 stickers');
    if (pack.cover == null) throw new globalThis.Error('cover required');
    if (!sock) throw new globalThis.Error('socket required');

    const files = {};
    const meta = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const raw = await loadBuffer(item.sticker ?? item.data ?? item);
        const { buf, animated } = await toWebp(raw);
        if (buf.length > 1024 * 1024) throw new globalThis.Error(`sticker ${i} > 1MB`);

        const fileName = `${sha256(buf).toString('base64').replace(/\//g, '-')}.webp`;
        files[fileName] = buf;
        meta.push({
            fileName,
            mimetype: 'image/webp',
            isAnimated: animated,
            emojis: item.emojis || pack.emojis || [],
            accessibilityLabel: item.accessibilityLabel || '‎'
        });
    }

    const cover = await loadBuffer(pack.cover);
    const tray = await makeTray(cover);
    const packId =
        (typeof caps?.generateMessageIDV2 === 'function' && caps.generateMessageIDV2()) ||
        randomBytes(8).toString('hex').toUpperCase();
    const trayIconFileName = `${packId}.webp`;
    files[trayIconFileName] = tray;

    const archive = await makeZip(files);
    const packUp = await uploadMms(sock, archive, { hkdf: PACK_HKDF, mediaPath: PACK_PATH });
    const thumb = await makeThumb(tray);
    const thumbUp = await uploadMms(sock, thumb, {
        hkdf: THUMB_HKDF,
        mediaPath: THUMB_PATH,
        mediaKey: packUp.mediaKey
    });

    const origin = caps?.proto?.Message?.StickerPackMessage?.StickerPackOrigin?.USER_CREATED ?? 1;

    return {
        name: pack.name || '',
        publisher: pack.publisher || '',
        stickerPackId: packId,
        packDescription: pack.description || '',
        stickerPackOrigin: origin,
        stickerPackSize: archive.length,
        stickers: meta,
        fileSha256: packUp.fileSha256,
        fileEncSha256: packUp.fileEncSha256,
        mediaKey: packUp.mediaKey,
        directPath: packUp.directPath,
        fileLength: packUp.fileLength,
        mediaKeyTimestamp: Math.floor(Date.now() / 1000),
        trayIconFileName,
        thumbnailDirectPath: thumbUp.directPath,
        thumbnailSha256: thumbUp.fileSha256,
        thumbnailEncSha256: thumbUp.fileEncSha256,
        thumbnailHeight: 252,
        thumbnailWidth: 252,
        imageDataHash: sha256(thumb).toString('base64')
    };
}
