/**
 * Message system: validation, media resolve, ID, processors, relay, helpers.
 * Public helpers attach via createMessageApi(ctx).
 */

import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { createHash, randomBytes, randomFillSync } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { Error, createError } from '../constant/index.js';
import { asString, isPlainObject, mergeObjects } from '../utils/function.js';
import { debug, info } from '../utils/logs.js';
import { prepareStickerBuffer } from '../utils/sticker-pack.js';
import { buildAdditionalNodes } from './node.js';

/* ─── validators ─────────────────────────────────────────── */

export function validateRemoteJid(jid) {
    const s = asString(jid);
    if (!s || !s.includes('@')) {
        throw createError(Error.INVALID_JID, `Invalid remote JID: ${String(jid)}`);
    }
    return s;
}

export function validateText(text) {
    if (typeof text !== 'string') {
        throw createError(Error.INVALID_MESSAGE, 'Text must be a string');
    }
    return text;
}

export function validateMedia(media) {
    if (media == null) throw createError(Error.INVALID_MEDIA, 'Media is required');
    if (Buffer.isBuffer(media)) return;
    if (typeof media === 'string') return;
    if (typeof media === 'object' && (media.url || media.stream)) return;
    throw createError(Error.INVALID_MEDIA, 'Media must be Buffer, path, URL string, or {url|stream}');
}

export function validateQuoted(quoted) {
    if (quoted == null) return null;
    if (!isPlainObject(quoted)) {
        throw createError(Error.INVALID_MESSAGE, 'Quoted must be an object or null');
    }
    return quoted;
}

export function validateOptions(options) {
    if (options == null) return {};
    if (!isPlainObject(options)) {
        throw createError(Error.INVALID_OPTIONS, 'Options must be a plain object');
    }
    return options;
}

export function validateMessageKey(key) {
    if (!isPlainObject(key) || !key.id) {
        throw createError(Error.INVALID_KEY, 'Message key must be an object with an id');
    }
    return key;
}

/* ─── media resolver ─────────────────────────────────────── */

export function detectMediaInput(input) {
    if (Buffer.isBuffer(input)) return { type: 'buffer', value: input };
    if (input && typeof input === 'object' && input.stream) return { type: 'stream', value: input.stream };
    if (input && typeof input === 'object' && input.url) {
        const url = String(input.url);
        if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return { type: 'url', value: url };
        return { type: 'file', value: url };
    }
    if (typeof input === 'string') {
        if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return { type: 'url', value: input };
        return { type: 'file', value: input };
    }
    return { type: 'invalid' };
}

export async function resolveMedia(input) {
    const detected = detectMediaInput(input);
    debug('media detect', detected.type);
    switch (detected.type) {
        case 'buffer':
            return { media: detected.value, type: 'buffer' };
        case 'stream':
            return { media: { stream: detected.value }, type: 'stream' };
        case 'url':
            return { media: { url: detected.value }, type: 'url' };
        case 'file': {
            try {
                await fs.access(detected.value);
            } catch {
                throw createError(Error.INVALID_MEDIA, `Media file not found: ${detected.value}`);
            }
            return { media: { url: detected.value }, type: 'file' };
        }
        default:
            throw createError(Error.INVALID_MEDIA, 'Unsupported media input');
    }
}

/* ─── message ID (NEXRAY) ────────────────────────────────── */

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
    const device = (stealth || '').toLowerCase();
    const randomHex = (n) => randomBytes(n).toString('hex').toUpperCase();
    switch (device) {
        case 'ios':
            return '3A' + randomHex(9);
        case 'web':
            return '3E' + randomHex(10);
        case 'desktop':
            return '3F' + randomHex(9);
        case 'android':
            return randomHex(16);
        default:
            return generateNexrayId();
    }
}

export function applyCustomId(baseId, customId) {
    if (!customId || typeof customId !== 'string') return baseId;
    if (baseId.startsWith(customId)) return baseId;
    return `${customId}${baseId}`;
}

export function generateMessageId(opts = {}) {
    if (opts.explicitId && typeof opts.explicitId === 'string') return opts.explicitId;
    if (opts.stealth) return generateStealthId(opts.stealth);
    let id = generateNexrayId(opts.meId);
    if (opts.customId && opts.customId !== 'NEXRAY') id = applyCustomId(id, opts.customId);
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
    if (!key || typeof key !== 'object') return null;
    return asString(key.id);
}

/* ─── processors ─────────────────────────────────────────── */

const DEFAULT_POLYGON_VERTICES = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
];

export function buildNewsletterAnnotations(config, proto) {
    if (!config || !config.newsletterJid) return [];
    let contentType = config.contentType;
    if (contentType == null && proto?.ContextInfo?.ForwardedNewsletterMessageInfo?.ContentType) {
        contentType = proto.ContextInfo.ForwardedNewsletterMessageInfo.ContentType.UPDATE;
    }
    if (contentType == null) contentType = 1;
    return [
        {
            polygonVertices: DEFAULT_POLYGON_VERTICES,
            newsletter: {
                newsletterJid: config.newsletterJid,
                newsletterName: config.newsletterName || '',
                contentType,
                accessibilityText: config.accessibilityText || ''
            }
        }
    ];
}

export function applyNewsletterAnnotationToMedia(uploadData, annotationConfig, proto) {
    if (!annotationConfig) return;
    const annotations = buildNewsletterAnnotations(annotationConfig, proto);
    if (annotations.length) {
        uploadData.annotations = annotations;
        debug('Applied newsletter annotations to media');
    }
}

export function applyContextInfo(content, options = {}) {
    if (!content || typeof content !== 'object') return content;
    const keys = Object.keys(content);
    const mainKey = keys.find((k) => k !== 'messageContextInfo') || keys[0];
    if (!mainKey || !content[mainKey] || typeof content[mainKey] !== 'object') return content;
    const target = content[mainKey];
    let ctx = { ...(target.contextInfo || {}) };
    if (Array.isArray(options.mentions) && options.mentions.length) ctx.mentionedJid = options.mentions;
    if (options.mentionsAll || options.mentionAll) ctx.nonJidMentions = 1;
    if (isPlainObject(options.contextInfo)) ctx = mergeObjects(ctx, options.contextInfo);
    if (isPlainObject(options.externalAdReply)) {
        const ad = { ...options.externalAdReply };
        if (ad.url && !ad.sourceUrl) ad.sourceUrl = ad.url;
        if (ad.largeThumbnail != null && ad.renderLargerThumbnail == null) {
            ad.renderLargerThumbnail = ad.largeThumbnail;
        }
        delete ad.largeThumbnail;
        delete ad.url;
        ctx.externalAdReply = { ...(ctx.externalAdReply || {}), ...ad };
    }
    if (options.groupStatus) ctx.isGroupStatus = true;
    if (options.spoiler) ctx.isSpoiler = true;
    if (Object.keys(ctx).length) target.contextInfo = ctx;
    return content;
}

export function applySecureMetaServiceLabel(content, enabled) {
    return { content, addBizAttributes: Boolean(enabled) };
}

export function normalizeClientOptions(raw = {}) {
    const secure = raw.secureMetaServiceLabel === true || raw.metaLabel === true || false;
    let newsletterAnnotation = null;
    if (isPlainObject(raw.newsletterAnnotation) && raw.newsletterAnnotation.newsletterJid) {
        newsletterAnnotation = {
            newsletterJid: String(raw.newsletterAnnotation.newsletterJid),
            newsletterName: raw.newsletterAnnotation.newsletterName || '',
            accessibilityText: raw.newsletterAnnotation.accessibilityText || '',
            contentType: raw.newsletterAnnotation.contentType
        };
    }
    let stealth = null;
    if (typeof raw.stealth === 'string') {
        const s = raw.stealth.toLowerCase();
        if (['ios', 'android', 'web', 'desktop'].includes(s)) stealth = s;
    }
    return {
        bot: raw.bot ?? null,
        customId:
            typeof raw.custom_id === 'string'
                ? raw.custom_id
                : typeof raw.customId === 'string'
                  ? raw.customId
                  : null,
        stealth,
        newsletterAnnotation,
        secureMetaServiceLabel: secure,
        debug: Boolean(raw.debug)
    };
}

/* ─── relay pipeline ─────────────────────────────────────── */

export async function relayPipeline(ctx, jid, content, options = {}) {
    const { engineCtx, config, meId } = ctx;
    const { caps, sock } = engineCtx;

    if (typeof caps.relayMessage !== 'function') {
        throw createError(Error.INVALID_ENGINE, 'relayMessage is not available on the socket');
    }

    const messageId = generateMessageId({
        engineGenerate: caps.generateMessageIDV2,
        meId,
        customId: config.customId,
        stealth: config.stealth,
        explicitId: options.messageId
    });

    const genOpts = {
        logger: options.logger,
        userJid: meId,
        messageId,
        quoted: options.quoted || undefined,
        ephemeralExpiration: options.ephemeralExpiration,
        upload: options.upload || sock.waUploadToServer,
        mediaCache: options.mediaCache,
        options: options.httpOptions || options.options,
        jid,
        getUrlInfo: options.getUrlInfo,
        ...options.generateOptions
    };

    let payload = content;
    if (
        options.secureMetaServiceLabel === true ||
        options.metaLabel === true ||
        (config.secureMetaServiceLabel && options.secureMetaServiceLabel !== false)
    ) {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            payload = { ...payload, secureMetaServiceLabel: true };
        }
    }

    let fullMsg;
    if (options.prebuiltMessage) {
        fullMsg = options.prebuiltMessage;
        if (fullMsg.key && messageId) fullMsg.key.id = messageId;
    } else {
        fullMsg = await caps.generateWAMessage(jid, payload, genOpts);
    }

    if (
        fullMsg?.message &&
        (options.contextInfo || options.mentions || options.mentionsAll || options.externalAdReply)
    ) {
        fullMsg.message = applyContextInfo(fullMsg.message, options);
    }

    const secureEnabled =
        options.secureMetaServiceLabel === true ||
        options.metaLabel === true ||
        (config.secureMetaServiceLabel && options.secureMetaServiceLabel !== false);

    const { addBizAttributes } = applySecureMetaServiceLabel(fullMsg.message, secureEnabled);
    const additionalAttributes = { ...(options.additionalAttributes || {}) };
    const additionalNodes = buildAdditionalNodes(options);

    debug('Relaying message', { jid, messageId, addBizAttributes });

    await caps.relayMessage(jid, fullMsg.message, {
        messageId: fullMsg.key?.id || messageId,
        useCachedGroupMetadata: options.useCachedGroupMetadata,
        addBizAttributes: addBizAttributes || options.addBizAttributes,
        statusJidList: options.statusJidList,
        additionalAttributes,
        additionalNodes,
        participant: options.participant
    });

    info('Message relayed', fullMsg.key?.id || messageId);
    return fullMsg;
}

/* ─── helpers ────────────────────────────────────────────── */

function flags(opts = {}) {
    const f = {};
    if (opts.viewOnce) f.viewOnce = true;
    if (opts.viewOnceV2) f.viewOnceV2 = true;
    if (opts.ephemeral) f.ephemeral = true;
    if (opts.groupStatus) f.groupStatus = true;
    if (opts.spoiler) f.spoiler = true;
    if (opts.ai) f.ai = true;
    if (opts.secureMetaServiceLabel) f.secureMetaServiceLabel = true;
    if (opts.isLottie) f.isLottie = true;
    if (opts.mentionAll) f.mentionAll = true;
    if (Array.isArray(opts.mentions) && opts.mentions.length) f.mentions = opts.mentions;
    return f;
}

/**
 * Create message API bound to relay context.
 * @param {{ engineCtx: object, config: object, meId: string|null }} ctx
 */
export function createMessageApi(ctx) {
    const { engineCtx, config } = ctx;
    const { caps, sock } = engineCtx;

    async function sendText(remoteJid, text, quoted = null, options = {}) {
        const jid = validateRemoteJid(remoteJid);
        const body = validateText(text);
        const q = validateQuoted(quoted);
        const opts = validateOptions(options);
        return relayPipeline(ctx, jid, { text: body, ...flags(opts) }, {
            ...opts,
            quoted: q,
            mentions: opts.mentions,
            mentionsAll: opts.mentionAll,
            contextInfo: opts.contextInfo,
            externalAdReply: opts.externalAdReply,
            ai: opts.ai,
            messageId: opts.messageId
        });
    }

    async function reply(remoteJid, text, quoted = null, options = {}) {
        return sendText(remoteJid, text, quoted, options);
    }

    async function sendReact(remoteJid, emoji, key, options = {}) {
        const jid = validateRemoteJid(remoteJid);
        const k = validateMessageKey(key);
        const opts = validateOptions(options);
        return relayPipeline(
            ctx,
            jid,
            { react: { text: emoji == null ? '' : String(emoji), key: k } },
            { ...opts, messageId: opts.messageId }
        );
    }

    async function sendMedia(kind, remoteJid, media, caption, quoted, options) {
        const jid = validateRemoteJid(remoteJid);
        validateMedia(media);
        const q = validateQuoted(quoted);
        const opts = validateOptions(options);
        const { media: resolved } = await resolveMedia(media);

        const payload = { [kind]: resolved };
        if (caption != null && caption !== '') payload.caption = String(caption);
        if (opts.ptt === true) payload.ptt = true;
        if (opts.ptv === true) payload.ptv = true;
        if (opts.gif === true || opts.gifPlayback === true) payload.gifPlayback = true;
        if (opts.mimetype) payload.mimetype = opts.mimetype;
        if (opts.fileName) payload.fileName = opts.fileName;
        if (opts.seconds != null) payload.seconds = opts.seconds;
        if (opts.waveform) payload.waveform = opts.waveform;
        if (opts.backgroundColor != null) payload.backgroundColor = opts.backgroundColor;

        if (kind === 'audio' && opts.ptt === true && !opts.waveform && typeof caps.getAudioWaveform === 'function') {
            try {
                if (Buffer.isBuffer(resolved)) {
                    payload.waveform = await caps.getAudioWaveform(resolved);
                }
            } catch {
                /* optional */
            }
        }

        if ((kind === 'image' || kind === 'video') && config.newsletterAnnotation) {
            applyNewsletterAnnotationToMedia(payload, config.newsletterAnnotation, caps.proto);
        }

        Object.assign(payload, flags(opts));

        return relayPipeline(ctx, jid, payload, {
            ...opts,
            quoted: q,
            mentions: opts.mentions,
            mentionsAll: opts.mentionsAll || opts.mentionAll,
            contextInfo: opts.contextInfo,
            externalAdReply: opts.externalAdReply,
            ai: opts.ai,
            messageId: opts.messageId,
            secureMetaServiceLabel: opts.secureMetaServiceLabel
        });
    }

    async function sendImage(remoteJid, image, caption, quoted = null, options = {}) {
        return sendMedia('image', remoteJid, image, caption, quoted, options);
    }

    async function sendVideo(remoteJid, video, caption, quoted = null, options = {}) {
        return sendMedia('video', remoteJid, video, caption, quoted, options);
    }

    async function sendAudio(remoteJid, audio, quoted = null, options = {}) {
        return sendMedia('audio', remoteJid, audio, undefined, quoted, options);
    }

    async function sendFile(remoteJid, file, quoted = null, options = {}) {
        return sendMedia('document', remoteJid, file, options?.caption, quoted, options);
    }

    async function sendSticker(remoteJid, sticker, quoted = null, options = {}) {
        const jid = validateRemoteJid(remoteJid);
        validateMedia(sticker);
        const q = validateQuoted(quoted);
        const opts = validateOptions(options);
        const { media: resolved } = await resolveMedia(sticker);

        let buffer;
        if (Buffer.isBuffer(resolved)) {
            buffer = resolved;
        } else if (resolved?.url && typeof resolved.url === 'string' && !/^https?:/i.test(resolved.url)) {
            buffer = await fs.readFile(resolved.url);
        } else if (resolved?.url && /^https?:/i.test(String(resolved.url))) {
            const res = await fetch(resolved.url);
            buffer = Buffer.from(await res.arrayBuffer());
        } else if (resolved?.stream) {
            const chunks = [];
            for await (const c of resolved.stream) chunks.push(c);
            buffer = Buffer.concat(chunks);
        } else {
            return relayPipeline(ctx, jid, { sticker: resolved, ...flags(opts) }, {
                ...opts,
                quoted: q,
                messageId: opts.messageId
            });
        }

        const prepared = await prepareStickerBuffer(buffer, opts);
        const content = { sticker: prepared.buffer, ...flags(opts) };
        if (prepared.isAiSticker) content.isAiSticker = true;
        if (prepared.premium != null) content.premium = prepared.premium;
        if (opts.isLottie) content.isLottie = true;
        if (opts.isAvatar) content.isAvatar = true;

        return relayPipeline(ctx, jid, content, {
            ...opts,
            quoted: q,
            messageId: opts.messageId
        });
    }

    async function sendAlbum(jid, quotedOrItems, itemsMaybe, options = {}) {
        const remoteJid = validateRemoteJid(jid);
        let quoted = null;
        let items;
        let opts;

        if (Array.isArray(quotedOrItems)) {
            items = quotedOrItems;
            opts = validateOptions(itemsMaybe || {});
        } else {
            quoted = validateQuoted(quotedOrItems);
            items = itemsMaybe;
            opts = validateOptions(options);
        }

        if (!Array.isArray(items) || items.length === 0) {
            throw createError(Error.INVALID_MESSAGE, 'Album requires a non-empty items array (1+ media)');
        }

        const albumItems = [];
        for (const item of items) {
            if (!item || (!item.image && !item.video)) {
                throw createError(Error.INVALID_MEDIA, 'Each album item requires image or video');
            }
            if (item.image) {
                const { media } = await resolveMedia(item.image);
                albumItems.push({ image: media, caption: item.caption });
            } else {
                const { media } = await resolveMedia(item.video);
                albumItems.push({ video: media, caption: item.caption });
            }
        }

        return relayPipeline(ctx, remoteJid, { album: albumItems, ...flags(opts) }, {
            ...opts,
            quoted,
            messageId: opts.messageId,
            delayMs: opts.delayMs,
            secureMetaServiceLabel: opts.secureMetaServiceLabel
        });
    }

    /**
     * Live photo — video only; still frame via engine.generateThumbnail.
     */
    async function sendLivePhoto(remoteJid, video, quoted = null, options = {}) {
        const jid = validateRemoteJid(remoteJid);
        validateMedia(video);
        const q = validateQuoted(quoted);
        const opts = validateOptions(options);
        const { media: videoMedia } = await resolveMedia(video);

        let videoPath = null;
        let tmpCreated = false;
        let videoBuffer = null;

        if (Buffer.isBuffer(videoMedia)) {
            videoBuffer = videoMedia;
            videoPath = join(tmpdir(), `nexray-live-${Date.now()}.mp4`);
            await fs.writeFile(videoPath, videoBuffer);
            tmpCreated = true;
        } else if (
            videoMedia?.url &&
            typeof videoMedia.url === 'string' &&
            !/^https?:/i.test(videoMedia.url) &&
            !videoMedia.url.startsWith('data:')
        ) {
            videoPath = videoMedia.url;
        } else if (videoMedia?.url && /^https?:/i.test(String(videoMedia.url))) {
            const res = await fetch(videoMedia.url);
            videoBuffer = Buffer.from(await res.arrayBuffer());
            videoPath = join(tmpdir(), `nexray-live-${Date.now()}.mp4`);
            await fs.writeFile(videoPath, videoBuffer);
            tmpCreated = true;
        } else if (videoMedia?.stream) {
            const chunks = [];
            for await (const c of videoMedia.stream) chunks.push(c);
            videoBuffer = Buffer.concat(chunks);
            videoPath = join(tmpdir(), `nexray-live-${Date.now()}.mp4`);
            await fs.writeFile(videoPath, videoBuffer);
            tmpCreated = true;
        } else {
            throw createError(Error.INVALID_MEDIA, 'Unable to resolve video for live photo');
        }

        let thumbBuffer;
        try {
            if (typeof caps.generateThumbnail !== 'function') {
                throw new Error('generateThumbnail missing on engine');
            }
            const result = await caps.generateThumbnail(videoPath, 'video', { logger: opts.logger });
            if (result?.thumbnail) thumbBuffer = Buffer.from(result.thumbnail, 'base64');
            else if (Buffer.isBuffer(result)) thumbBuffer = result;
            if (!thumbBuffer?.length) throw new Error('empty thumbnail');
        } catch (err) {
            if (tmpCreated) await fs.unlink(videoPath).catch(() => {});
            throw createError(
                Error.INVALID_MEDIA,
                `Live photo thumbnail generation failed. Engine must expose generateThumbnail (FFmpeg). ${err?.message || err}`
            );
        }

        try {
            let imageMsg;
            let videoMsg;

            if (typeof caps.prepareWAMessageMedia === 'function') {
                const imgPrepared = await caps.prepareWAMessageMedia(
                    { image: thumbBuffer },
                    { upload: sock.waUploadToServer, logger: opts.logger, mediaCache: opts.mediaCache }
                );
                const vidPrepared = await caps.prepareWAMessageMedia(
                    { video: videoBuffer || { url: videoPath } },
                    { upload: sock.waUploadToServer, logger: opts.logger, mediaCache: opts.mediaCache }
                );
                imageMsg = imgPrepared.imageMessage;
                videoMsg = vidPrepared.videoMessage;
            } else {
                const imgFull = await caps.generateWAMessage(
                    jid,
                    { image: thumbBuffer },
                    { userJid: ctx.meId, upload: sock.waUploadToServer }
                );
                const vidFull = await caps.generateWAMessage(
                    jid,
                    { video: videoBuffer || { url: videoPath } },
                    { userJid: ctx.meId, upload: sock.waUploadToServer }
                );
                imageMsg = imgFull.message.imageMessage;
                videoMsg = vidFull.message.videoMessage;
            }

            imageMsg = {
                ...imageMsg,
                contextInfo: {
                    ...(imageMsg.contextInfo || {}),
                    pairedMediaType: 5,
                    statusSourceType: 0
                }
            };

            const parent = await caps.generateWAMessageFromContent(
                jid,
                { imageMessage: imageMsg },
                { userJid: ctx.meId, messageId: opts.messageId, quoted: q }
            );

            await caps.relayMessage(jid, parent.message, {
                messageId: parent.key.id,
                additionalAttributes: opts.additionalAttributes,
                additionalNodes: opts.additionalNodes
            });

            await caps.relayMessage(
                jid,
                {
                    videoMessage: {
                        ...videoMsg,
                        contextInfo: {
                            ...(videoMsg.contextInfo || {}),
                            pairedMediaType: 6,
                            statusSourceType: 0
                        }
                    },
                    messageContextInfo: {
                        messageAssociation: {
                            associationType: 12,
                            parentMessageKey: parent.key
                        }
                    }
                },
                { additionalAttributes: opts.additionalAttributes }
            );

            return parent;
        } finally {
            if (tmpCreated) await fs.unlink(videoPath).catch(() => {});
        }
    }

    return {
        sendText,
        reply,
        sendReact,
        sendImage,
        sendVideo,
        sendAudio,
        sendFile,
        sendSticker,
        sendAlbum,
        sendLivePhoto
    };
}
