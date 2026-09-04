/**
 * Message builders, processors, relay, helpers.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Error, createError } from '../constant/index.js';
import {
    asString,
    isPlainObject,
    mergeObjects,
    delay,
    generateMessageId,
    isBotMessageId,
    extractMessageId,
    normalizeMediaInput
} from '../utils/function.js';
import { debug, info } from '../utils/logs.js';
import { prepareStickerBuffer } from '../utils/sticker-pack.js';
import { buildAdditionalNodes } from './node.js';

export { generateMessageId, isBotMessageId, extractMessageId, normalizeMediaInput };

/* ─── light validation ───────────────────────────────────── */

function needJid(jid) {
    const s = asString(jid);
    if (!s || !s.includes('@')) throw createError(Error.INVALID_JID, `Invalid JID: ${jid}`);
    return s;
}

function needMedia(input) {
    const m = normalizeMediaInput(input);
    if (m == null) throw createError(Error.INVALID_MEDIA, 'Invalid media input');
    return m;
}

function opts(o) {
    return isPlainObject(o) ? o : {};
}

/* ─── media → engine-ready value ─────────────────────────── */

/**
 * Pass through to Baileys-compatible shape.
 * Prefer leaving path/URL/Buffer for prepareWAMessageMedia / getStream.
 */
export async function resolveMedia(input, caps) {
    const media = needMedia(input);

    // If engine exposes getStream, trust it for validation later during upload
    if (typeof caps?.getStream === 'function') {
        if (Buffer.isBuffer(media)) return media;
        if (typeof media === 'string') {
            if (/^https?:\/\//i.test(media) || media.startsWith('data:')) return { url: media };
            return { url: media }; // local path as url — Baileys getStream handles file://
        }
        return media; // { url } | { stream }
    }

    if (Buffer.isBuffer(media)) return media;
    if (typeof media === 'string') {
        if (/^https?:\/\//i.test(media) || media.startsWith('data:')) return { url: media };
        await fs.access(media).catch(() => {
            throw createError(Error.INVALID_MEDIA, `File not found: ${media}`);
        });
        return { url: media };
    }
    return media;
}

/* ─── processors ─────────────────────────────────────────── */

const POLYGON = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
];

export function buildNewsletterAnnotations(config, proto) {
    if (!config?.newsletterJid) return [];
    let contentType = config.contentType;
    if (contentType == null) {
        contentType = proto?.ContextInfo?.ForwardedNewsletterMessageInfo?.ContentType?.UPDATE ?? 1;
    }
    return [
        {
            polygonVertices: POLYGON,
            newsletter: {
                newsletterJid: config.newsletterJid,
                newsletterName: config.newsletterName || '',
                contentType,
                accessibilityText: config.accessibilityText || ''
            }
        }
    ];
}

export function applyContextInfo(content, options = {}) {
    if (!content || typeof content !== 'object') return content;
    const mainKey = Object.keys(content).find((k) => k !== 'messageContextInfo') || Object.keys(content)[0];
    if (!mainKey || typeof content[mainKey] !== 'object') return content;
    const target = content[mainKey];
    let ctx = { ...(target.contextInfo || {}) };
    if (options.mentions?.length) ctx.mentionedJid = options.mentions;
    if (options.mentionsAll || options.mentionAll) ctx.nonJidMentions = 1;
    if (isPlainObject(options.contextInfo)) ctx = mergeObjects(ctx, options.contextInfo);
    if (isPlainObject(options.externalAdReply)) {
        const ad = { ...options.externalAdReply };
        if (ad.url && !ad.sourceUrl) ad.sourceUrl = ad.url;
        if (ad.largeThumbnail != null) ad.renderLargerThumbnail = ad.largeThumbnail;
        delete ad.largeThumbnail;
        delete ad.url;
        ctx.externalAdReply = { ...(ctx.externalAdReply || {}), ...ad };
    }
    if (options.groupStatus) ctx.isGroupStatus = true;
    if (options.spoiler) ctx.isSpoiler = true;
    if (Object.keys(ctx).length) target.contextInfo = ctx;
    return content;
}

export function normalizeClientOptions(raw = {}) {
    let stealth = null;
    if (typeof raw.stealth === 'string') {
        const s = raw.stealth.toLowerCase();
        if (['ios', 'android', 'web', 'desktop'].includes(s)) stealth = s;
    }
    let newsletterAnnotation = null;
    if (isPlainObject(raw.newsletterAnnotation) && raw.newsletterAnnotation.newsletterJid) {
        const n = raw.newsletterAnnotation;
        newsletterAnnotation = {
            newsletterJid: String(n.newsletterJid),
            newsletterName: n.newsletterName || '',
            accessibilityText: n.accessibilityText || '',
            contentType: n.contentType
        };
    }
    return {
        bot: raw.bot ?? null,
        customId: typeof raw.custom_id === 'string' ? raw.custom_id : typeof raw.customId === 'string' ? raw.customId : null,
        stealth,
        newsletterAnnotation,
        secureMetaServiceLabel: raw.secureMetaServiceLabel === true || raw.metaLabel === true,
        debug: Boolean(raw.debug)
    };
}

function flags(o = {}) {
    const f = {};
    if (o.viewOnce) f.viewOnce = true;
    if (o.viewOnceV2) f.viewOnceV2 = true;
    if (o.ephemeral) f.ephemeral = true;
    if (o.groupStatus) f.groupStatus = true;
    if (o.spoiler) f.spoiler = true;
    if (o.ai) f.ai = true;
    if (o.secureMetaServiceLabel) f.secureMetaServiceLabel = true;
    if (o.isLottie) f.isLottie = true;
    if (o.mentionAll || o.mentionsAll) f.mentionAll = true;
    if (o.mentions?.length) f.mentions = o.mentions;
    return f;
}

/* ─── relay ──────────────────────────────────────────────── */

export async function relayPipeline(ctx, jid, content, options = {}) {
    const { engineCtx, config, meId } = ctx;
    const { caps, sock } = engineCtx;

    if (typeof caps.relayMessage !== 'function') {
        throw createError(Error.INVALID_ENGINE, 'relayMessage unavailable');
    }

    const messageId = generateMessageId({
        meId,
        customId: config.customId,
        stealth: config.stealth,
        explicitId: options.messageId
    });

    let payload = content;
    const secure =
        options.secureMetaServiceLabel === true ||
        options.metaLabel === true ||
        (config.secureMetaServiceLabel && options.secureMetaServiceLabel !== false);
    if (secure && payload && typeof payload === 'object') {
        payload = { ...payload, secureMetaServiceLabel: true };
    }

    const fullMsg = options.prebuiltMessage
        ? options.prebuiltMessage
        : await caps.generateWAMessage(jid, payload, {
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
          });

    if (fullMsg.key && messageId) fullMsg.key.id = fullMsg.key.id || messageId;

    if (fullMsg?.message && (options.contextInfo || options.mentions || options.mentionsAll || options.externalAdReply)) {
        fullMsg.message = applyContextInfo(fullMsg.message, options);
    }

    const additionalNodes = buildAdditionalNodes(options);

    await caps.relayMessage(jid, fullMsg.message, {
        messageId: fullMsg.key?.id || messageId,
        useCachedGroupMetadata: options.useCachedGroupMetadata,
        addBizAttributes: secure || options.addBizAttributes,
        statusJidList: options.statusJidList,
        additionalAttributes: options.additionalAttributes,
        additionalNodes,
        participant: options.participant
    });

    info('Message relayed', fullMsg.key?.id || messageId);
    return fullMsg;
}

/* ─── helpers ────────────────────────────────────────────── */

export function createMessageApi(ctx) {
    const { engineCtx, config } = ctx;
    const { caps, sock } = engineCtx;

    async function sendText(remoteJid, text, quoted = null, options = {}) {
        const jid = needJid(remoteJid);
        if (typeof text !== 'string') throw createError(Error.INVALID_MESSAGE, 'Text must be a string');
        const o = opts(options);
        return relayPipeline(ctx, jid, { text, ...flags(o) }, {
            ...o,
            quoted: quoted || null,
            mentions: o.mentions,
            mentionsAll: o.mentionsAll || o.mentionAll,
            contextInfo: o.contextInfo,
            externalAdReply: o.externalAdReply,
            ai: o.ai,
            messageId: o.messageId
        });
    }

    async function reply(remoteJid, text, quoted = null, options = {}) {
        return sendText(remoteJid, text, quoted, options);
    }

    async function sendReact(remoteJid, emoji, key, options = {}) {
        const jid = needJid(remoteJid);
        if (!key || typeof key !== 'object' || !key.id) throw createError(Error.INVALID_KEY, 'Invalid message key');
        const o = opts(options);
        return relayPipeline(ctx, jid, { react: { text: emoji == null ? '' : String(emoji), key } }, {
            ...o,
            messageId: o.messageId
        });
    }

    async function sendMedia(kind, remoteJid, media, caption, quoted, options) {
        const jid = needJid(remoteJid);
        const o = opts(options);
        const resolved = await resolveMedia(media, caps);

        const payload = { [kind]: resolved };
        if (caption != null && caption !== '') payload.caption = String(caption);
        if (o.ptt === true) payload.ptt = true;
        if (o.ptv === true) payload.ptv = true;
        if (o.gif || o.gifPlayback) payload.gifPlayback = true;
        if (o.mimetype) payload.mimetype = o.mimetype;
        if (o.fileName) payload.fileName = o.fileName;
        if (o.seconds != null) payload.seconds = o.seconds;
        if (o.waveform) payload.waveform = o.waveform;

        if (kind === 'audio' && o.ptt && !o.waveform && typeof caps.getAudioWaveform === 'function' && Buffer.isBuffer(resolved)) {
            try {
                payload.waveform = await caps.getAudioWaveform(resolved);
            } catch {
                /* optional */
            }
        }

        if ((kind === 'image' || kind === 'video') && config.newsletterAnnotation) {
            const ann = buildNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
            if (ann.length) payload.annotations = ann;
        }

        Object.assign(payload, flags(o));

        return relayPipeline(ctx, jid, payload, {
            ...o,
            quoted: quoted || null,
            mentions: o.mentions,
            mentionsAll: o.mentionsAll || o.mentionAll,
            contextInfo: o.contextInfo,
            externalAdReply: o.externalAdReply,
            ai: o.ai,
            messageId: o.messageId,
            secureMetaServiceLabel: o.secureMetaServiceLabel
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
        const jid = needJid(remoteJid);
        const o = opts(options);
        const resolved = await resolveMedia(sticker, caps);

        let buffer;
        if (Buffer.isBuffer(resolved)) buffer = resolved;
        else if (resolved?.url && !/^https?:/i.test(String(resolved.url))) buffer = await fs.readFile(resolved.url);
        else if (resolved?.url && /^https?:/i.test(String(resolved.url))) {
            buffer = Buffer.from(await (await fetch(resolved.url)).arrayBuffer());
        } else {
            return relayPipeline(ctx, jid, { sticker: resolved, ...flags(o) }, { ...o, quoted, messageId: o.messageId });
        }

        const prepared = await prepareStickerBuffer(buffer, o);
        const content = { sticker: prepared.buffer, ...flags(o) };
        if (prepared.isAiSticker) content.isAiSticker = true;
        if (prepared.premium != null) content.premium = prepared.premium;
        if (o.isLottie) content.isLottie = true;
        if (o.isAvatar) content.isAvatar = true;

        return relayPipeline(ctx, jid, content, { ...o, quoted, messageId: o.messageId });
    }

    /**
     * Album — parent albumMessage then children with messageAssociation MEDIA_ALBUM.
     * Supports 1+ items (engine may require 2+ for native albumMessage counts).
     */
    async function sendAlbum(jid, quotedOrItems, itemsMaybe, options = {}) {
        const remoteJid = needJid(jid);
        let quoted = null;
        let items;
        let o;

        if (Array.isArray(quotedOrItems)) {
            items = quotedOrItems;
            o = opts(itemsMaybe);
        } else {
            quoted = quotedOrItems || null;
            items = itemsMaybe;
            o = opts(options);
        }

        if (!Array.isArray(items) || items.length === 0) {
            throw createError(Error.INVALID_MESSAGE, 'Album requires items array');
        }

        let imageCount = 0;
        let videoCount = 0;
        const resolvedItems = [];

        for (const item of items) {
            if (item?.image) {
                imageCount++;
                resolvedItems.push({ kind: 'image', media: await resolveMedia(item.image, caps), caption: item.caption });
            } else if (item?.video) {
                videoCount++;
                resolvedItems.push({ kind: 'video', media: await resolveMedia(item.video, caps), caption: item.caption });
            } else {
                throw createError(Error.INVALID_MEDIA, 'Album item needs image or video');
            }
        }

        // Parent: albumMessage with expected counts (messages.md)
        const parentContent = {
            album: resolvedItems.map((it) =>
                it.kind === 'image'
                    ? { image: it.media, caption: it.caption }
                    : { video: it.media, caption: it.caption }
            )
        };

        // If only 1 item, still send as associated media under a synthetic parent
        // Engine throws if album length < 2 — so for single item, send plain media
        if (resolvedItems.length < 2) {
            const it = resolvedItems[0];
            return sendMedia(it.kind, remoteJid, it.media, it.caption, quoted, o);
        }

        const parent = await relayPipeline(ctx, remoteJid, parentContent, {
            ...o,
            quoted,
            messageId: o.messageId,
            secureMetaServiceLabel: o.secureMetaServiceLabel
        });

        const delayMs = o.delayMs ?? 1500;
        // AssociationType.MEDIA_ALBUM — typically 1 in Baileys Types
        const MEDIA_ALBUM = caps.proto?.Message?.MessageContextInfo?.MessageAssociationType?.MEDIA_ALBUM ?? 1;

        for (const it of resolvedItems) {
            const childContent =
                it.kind === 'image'
                    ? { image: it.media, caption: it.caption }
                    : { video: it.media, caption: it.caption };

            const childMsg = await caps.generateWAMessage(remoteJid, childContent, {
                userJid: ctx.meId,
                upload: sock.waUploadToServer,
                mediaCache: o.mediaCache,
                messageId: generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth })
            });

            childMsg.message.messageContextInfo ||= {};
            childMsg.message.messageContextInfo.messageAssociation = {
                parentMessageKey: parent.key,
                associationType: MEDIA_ALBUM
            };

            await caps.relayMessage(remoteJid, childMsg.message, {
                messageId: childMsg.key.id,
                useCachedGroupMetadata: o.useCachedGroupMetadata,
                addBizAttributes: o.secureMetaServiceLabel || config.secureMetaServiceLabel,
                additionalAttributes: o.additionalAttributes,
                additionalNodes: o.additionalNodes
            });

            await delay(delayMs);
        }

        return parent;
    }

    /**
     * Live photo — video only; thumbnail via engine.generateThumbnail.
     * Accepts Buffer | path | URL | { video } | { url }
     */
    async function sendLivePhoto(remoteJid, video, quoted = null, options = {}) {
        const jid = needJid(remoteJid);
        const o = opts(options);
        const resolved = await resolveMedia(video, caps);

        let videoPath = null;
        let tmp = false;
        let videoBuffer = null;

        if (Buffer.isBuffer(resolved)) {
            videoBuffer = resolved;
            videoPath = join(tmpdir(), `nexray-live-${Date.now()}.mp4`);
            await fs.writeFile(videoPath, videoBuffer);
            tmp = true;
        } else if (resolved?.url && !/^https?:/i.test(String(resolved.url)) && !String(resolved.url).startsWith('data:')) {
            videoPath = resolved.url;
        } else if (resolved?.url) {
            videoBuffer = Buffer.from(await (await fetch(resolved.url)).arrayBuffer());
            videoPath = join(tmpdir(), `nexray-live-${Date.now()}.mp4`);
            await fs.writeFile(videoPath, videoBuffer);
            tmp = true;
        } else {
            throw createError(Error.INVALID_MEDIA, 'Cannot resolve video for live photo');
        }

        let thumbBuffer;
        try {
            if (typeof caps.generateThumbnail !== 'function') throw new Error('generateThumbnail missing');
            const result = await caps.generateThumbnail(videoPath, 'video', { logger: o.logger });
            thumbBuffer = result?.thumbnail ? Buffer.from(result.thumbnail, 'base64') : Buffer.isBuffer(result) ? result : null;
            if (!thumbBuffer?.length) throw new Error('empty thumbnail');
        } catch (err) {
            if (tmp) await fs.unlink(videoPath).catch(() => {});
            throw createError(Error.INVALID_MEDIA, `Live photo thumb failed: ${err?.message || err}`);
        }

        try {
            let imageMsg;
            let videoMsg;
            const upload = sock.waUploadToServer;

            if (typeof caps.prepareWAMessageMedia === 'function') {
                imageMsg = (await caps.prepareWAMessageMedia({ image: thumbBuffer }, { upload, logger: o.logger })).imageMessage;
                videoMsg = (
                    await caps.prepareWAMessageMedia(
                        { video: videoBuffer || { url: videoPath } },
                        { upload, logger: o.logger }
                    )
                ).videoMessage;
            } else {
                imageMsg = (await caps.generateWAMessage(jid, { image: thumbBuffer }, { userJid: ctx.meId, upload })).message
                    .imageMessage;
                videoMsg = (
                    await caps.generateWAMessage(jid, { video: videoBuffer || { url: videoPath } }, { userJid: ctx.meId, upload })
                ).message.videoMessage;
            }

            imageMsg = {
                ...imageMsg,
                contextInfo: { ...(imageMsg.contextInfo || {}), pairedMediaType: 5, statusSourceType: 0 }
            };

            const parent = await caps.generateWAMessageFromContent(
                jid,
                { imageMessage: imageMsg },
                { userJid: ctx.meId, messageId: o.messageId, quoted }
            );

            await caps.relayMessage(jid, parent.message, { messageId: parent.key.id });

            await caps.relayMessage(jid, {
                videoMessage: {
                    ...videoMsg,
                    contextInfo: { ...(videoMsg.contextInfo || {}), pairedMediaType: 6, statusSourceType: 0 }
                },
                messageContextInfo: {
                    messageAssociation: { associationType: 12, parentMessageKey: parent.key }
                }
            });

            return parent;
        } finally {
            if (tmp) await fs.unlink(videoPath).catch(() => {});
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
