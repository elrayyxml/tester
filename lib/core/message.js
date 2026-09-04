/**
 * Message construction, processing, and transport helpers.
 */

import { promises as fs } from 'fs';
import { Error as Err, createError } from '../constant/index.js';
import {
    asString,
    toMediaSource,
    generateMessageId,
    isBotMessageId,
    extractMessageId
} from '../utils/function.js';
import { info } from '../utils/logs.js';
import { prepareStickerBuffer } from '../utils/sticker-pack.js';
import { buildAdditionalNodes } from './node.js';

export { generateMessageId, isBotMessageId, extractMessageId, toMediaSource };

const NEWSLETTER_POLYGON = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
];

/**
 * Build newsletter media annotations (message.md structure).
 */
export function createNewsletterAnnotations(config, proto) {
    if (!config?.newsletterJid) return [];
    let contentType = config.contentType;
    if (contentType == null) {
        contentType = proto?.ContextInfo?.ForwardedNewsletterMessageInfo?.ContentType?.UPDATE ?? 1;
    }
    return [
        {
            polygonVertices: NEWSLETTER_POLYGON,
            newsletter: {
                newsletterJid: config.newsletterJid,
                newsletterName: config.newsletterName || '',
                contentType,
                accessibilityText: config.accessibilityText || ''
            }
        }
    ];
}

/** @deprecated use createNewsletterAnnotations */
export const buildNewsletterAnnotations = createNewsletterAnnotations;

/**
 * Merge mentions, ads, and related fields into message contextInfo.
 */
export function applyContextInfo(content, options = {}) {
    if (!content || typeof content !== 'object') return content;
    const mainKey = Object.keys(content).find((k) => k !== 'messageContextInfo') || Object.keys(content)[0];
    if (!mainKey || typeof content[mainKey] !== 'object') return content;
    const target = content[mainKey];
    const ctx = { ...(target.contextInfo || {}) };
    if (options.mentions?.length) ctx.mentionedJid = options.mentions;
    if (options.mentionAll) ctx.nonJidMentions = 1;
    if (options.contextInfo && typeof options.contextInfo === 'object') Object.assign(ctx, options.contextInfo);
    if (options.externalAdReply && typeof options.externalAdReply === 'object') {
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

/**
 * Normalize Client() configuration once at initialization.
 */
export function normalizeClientOptions(raw = {}) {
    let stealth = null;
    if (typeof raw.stealth === 'string') {
        const s = raw.stealth.toLowerCase();
        if (['ios', 'android', 'web', 'desktop'].includes(s)) stealth = s;
    }
    let newsletterAnnotation = null;
    if (raw.newsletterAnnotation?.newsletterJid) {
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

function buildContentFlags(options = {}) {
    const flags = {};
    if (options.viewOnce) flags.viewOnce = true;
    if (options.viewOnceV2) flags.viewOnceV2 = true;
    if (options.ephemeral) flags.ephemeral = true;
    if (options.groupStatus) flags.groupStatus = true;
    if (options.spoiler) flags.spoiler = true;
    if (options.ai) flags.ai = true;
    if (options.secureMetaServiceLabel) flags.secureMetaServiceLabel = true;
    if (options.isLottie) flags.isLottie = true;
    if (options.mentionAll) flags.mentionAll = true;
    if (options.mentions?.length) flags.mentions = options.mentions;
    return flags;
}

/**
 * Generate message content and dispatch via engine.relayMessage.
 * Always supplies a defined options object to Baileys.
 */
export async function relayMessagePipeline(ctx, jid, content, options = {}) {
    const { engineCtx, config, meId } = ctx;
    const { caps, sock } = engineCtx;
    const opts = options || {};

    if (typeof caps.relayMessage !== 'function') {
        throw createError(Err.INVALID_ENGINE, 'relayMessage unavailable');
    }

    const messageId = generateMessageId({
        meId,
        customId: config.customId,
        stealth: config.stealth,
        explicitId: opts.messageId
    });

    let payload = content;
    const secureMeta =
        opts.secureMetaServiceLabel === true ||
        opts.metaLabel === true ||
        (config.secureMetaServiceLabel && opts.secureMetaServiceLabel !== false);
    if (secureMeta && payload && typeof payload === 'object') {
        payload = { ...payload, secureMetaServiceLabel: true };
    }

    const fullMsg = opts.prebuiltMessage
        ? opts.prebuiltMessage
        : await caps.generateWAMessage(jid, payload, {
              logger: opts.logger,
              userJid: meId,
              messageId,
              quoted: opts.quoted || undefined,
              ephemeralExpiration: opts.ephemeralExpiration,
              upload: opts.upload || sock.waUploadToServer,
              mediaCache: opts.mediaCache,
              options: opts.httpOptions || opts.options,
              jid,
              getUrlInfo: opts.getUrlInfo,
              ...opts.generateOptions
          });

    if (fullMsg.key && messageId) fullMsg.key.id = fullMsg.key.id || messageId;

    if (fullMsg?.message && (opts.contextInfo || opts.mentions || opts.mentionAll || opts.externalAdReply)) {
        fullMsg.message = applyContextInfo(fullMsg.message, opts);
    }

    await caps.relayMessage(jid, fullMsg.message, {
        messageId: fullMsg.key?.id || messageId,
        useCachedGroupMetadata: opts.useCachedGroupMetadata,
        addBizAttributes: secureMeta || opts.addBizAttributes,
        statusJidList: opts.statusJidList,
        additionalAttributes: opts.additionalAttributes || {},
        additionalNodes: buildAdditionalNodes(opts),
        participant: opts.participant
    });

    info('Message relayed', fullMsg.key?.id || messageId);
    return fullMsg;
}

/** @deprecated use relayMessagePipeline */
export const relayPipeline = relayMessagePipeline;

/**
 * Bind public send helpers to a relay context.
 */
export function createMessageApi(ctx) {
    const { engineCtx, config } = ctx;
    const { caps, sock } = engineCtx;

    async function sendText(remoteJid, text, quoted = null, options = {}) {
        const opts = options || {};
        return relayMessagePipeline(ctx, remoteJid, { text, ...buildContentFlags(opts) }, {
            ...opts,
            quoted,
            mentions: opts.mentions,
            mentionAll: opts.mentionAll,
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
        const opts = options || {};
        return relayMessagePipeline(
            ctx,
            remoteJid,
            { react: { text: emoji == null ? '' : String(emoji), key } },
            { ...opts, messageId: opts.messageId }
        );
    }

    async function sendMediaMessage(kind, remoteJid, media, caption, quoted, options) {
        const opts = options || {};
        const source = toMediaSource(media);
        const payload = { [kind]: source };
        if (caption != null && caption !== '') payload.caption = String(caption);
        if (opts.ptt === true) payload.ptt = true;
        if (opts.ptv === true) payload.ptv = true;
        if (opts.gif || opts.gifPlayback) payload.gifPlayback = true;
        if (opts.mimetype) payload.mimetype = opts.mimetype;
        if (opts.fileName) payload.fileName = opts.fileName;
        if (opts.seconds != null) payload.seconds = opts.seconds;
        if (opts.waveform) payload.waveform = opts.waveform;

        if (
            kind === 'audio' &&
            opts.ptt &&
            !opts.waveform &&
            typeof caps.getAudioWaveform === 'function' &&
            Buffer.isBuffer(source)
        ) {
            try {
                payload.waveform = await caps.getAudioWaveform(source);
            } catch {
                /* optional */
            }
        }

        if ((kind === 'image' || kind === 'video') && config.newsletterAnnotation) {
            const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
            if (annotations.length) payload.annotations = annotations;
        }

        Object.assign(payload, buildContentFlags(opts));

        return relayMessagePipeline(ctx, remoteJid, payload, {
            ...opts,
            quoted,
            mentions: opts.mentions,
            mentionAll: opts.mentionAll,
            contextInfo: opts.contextInfo,
            externalAdReply: opts.externalAdReply,
            ai: opts.ai,
            messageId: opts.messageId,
            secureMetaServiceLabel: opts.secureMetaServiceLabel
        });
    }

    async function sendImage(remoteJid, image, caption, quoted = null, options = {}) {
        return sendMediaMessage('image', remoteJid, image, caption, quoted, options);
    }

    async function sendVideo(remoteJid, video, caption, quoted = null, options = {}) {
        return sendMediaMessage('video', remoteJid, video, caption, quoted, options);
    }

    async function sendAudio(remoteJid, audio, quoted = null, options = {}) {
        return sendMediaMessage('audio', remoteJid, audio, undefined, quoted, options);
    }

    async function sendFile(remoteJid, file, quoted = null, options = {}) {
        return sendMediaMessage('document', remoteJid, file, options?.caption, quoted, options);
    }

    async function sendSticker(remoteJid, sticker, quoted = null, options = {}) {
        const opts = options || {};
        const source = toMediaSource(sticker);

        let buffer;
        if (Buffer.isBuffer(source)) {
            buffer = source;
        } else if (source?.url && !/^https?:/i.test(String(source.url))) {
            buffer = await fs.readFile(source.url);
        } else if (source?.url && /^https?:/i.test(String(source.url))) {
            buffer = Buffer.from(await (await fetch(source.url)).arrayBuffer());
        } else {
            return relayMessagePipeline(
                ctx,
                remoteJid,
                { sticker: source, ...buildContentFlags(opts) },
                { ...opts, quoted, messageId: opts.messageId }
            );
        }

        const prepared = await prepareStickerBuffer(buffer, opts);
        const content = { sticker: prepared.buffer, ...buildContentFlags(opts) };
        if (prepared.isAiSticker) content.isAiSticker = true;
        if (prepared.premium != null) content.premium = prepared.premium;
        if (opts.isLottie) content.isLottie = true;
        if (opts.isAvatar) content.isAvatar = true;

        return relayMessagePipeline(ctx, remoteJid, content, { ...opts, quoted, messageId: opts.messageId });
    }

    /**
     * Album: parent albumMessage, then associated image/video children.
     * Signature: sendAlbum(jid, items, quoted?)
     */
    async function sendAlbum(remoteJid, items, quoted = null, options = {}) {
        const opts = options || {};
        if (!Array.isArray(items) || items.length === 0) {
            throw createError(Err.INVALID_MESSAGE, 'Album requires items array');
        }

        const resolvedItems = [];
        for (const item of items) {
            if (item?.image != null) {
                resolvedItems.push({ kind: 'image', media: toMediaSource(item.image), caption: item.caption });
            } else if (item?.video != null) {
                resolvedItems.push({ kind: 'video', media: toMediaSource(item.video), caption: item.caption });
            } else {
                throw createError(Err.INVALID_MEDIA, 'Album item needs image or video');
            }
        }

        if (resolvedItems.length < 2) {
            const item = resolvedItems[0];
            return sendMediaMessage(item.kind, remoteJid, item.media, item.caption, quoted, opts);
        }

        const albumPayload = resolvedItems.map((item) => {
            const entry = item.kind === 'image' ? { image: item.media } : { video: item.media };
            if (item.caption != null) entry.caption = item.caption;
            if (config.newsletterAnnotation) {
                const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
                if (annotations.length) entry.annotations = annotations;
            }
            return entry;
        });

        const parent = await relayMessagePipeline(
            ctx,
            remoteJid,
            { album: albumPayload },
            { ...opts, quoted, messageId: opts.messageId, secureMetaServiceLabel: opts.secureMetaServiceLabel }
        );

        const MEDIA_ALBUM = caps.proto?.Message?.MessageContextInfo?.MessageAssociationType?.MEDIA_ALBUM ?? 1;

        for (const item of resolvedItems) {
            const childContent =
                item.kind === 'image'
                    ? { image: item.media, caption: item.caption }
                    : { video: item.media, caption: item.caption };

            if (config.newsletterAnnotation) {
                const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
                if (annotations.length) childContent.annotations = annotations;
            }

            const childMsg = await caps.generateWAMessage(remoteJid, childContent, {
                userJid: ctx.meId,
                upload: sock.waUploadToServer,
                mediaCache: opts.mediaCache,
                messageId: generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth })
            });

            childMsg.message.messageContextInfo ||= {};
            childMsg.message.messageContextInfo.messageAssociation = {
                parentMessageKey: parent.key,
                associationType: MEDIA_ALBUM
            };

            await caps.relayMessage(remoteJid, childMsg.message, {
                messageId: childMsg.key.id,
                useCachedGroupMetadata: opts.useCachedGroupMetadata,
                addBizAttributes: opts.secureMetaServiceLabel || config.secureMetaServiceLabel,
                additionalAttributes: opts.additionalAttributes || {},
                additionalNodes: opts.additionalNodes || []
            });
        }

        return parent;
    }

    /**
     * Live photo from a single video source.
     * Still frame uses video jpegThumbnail from prepareWAMessageMedia (Baileys upload path).
     * Pairs image (pairedMediaType 5) with video (6) and associationType 12.
     */
    async function sendLivePhoto(remoteJid, video, quoted = null, options = {}) {
        const opts = options || {};
        const upload = sock.waUploadToServer;
        const media = toMediaSource(video);

        if (typeof caps.prepareWAMessageMedia !== 'function') {
            throw createError(Err.INVALID_ENGINE, 'prepareWAMessageMedia is required for live photo');
        }

        const videoPrepared = await caps.prepareWAMessageMedia(
            { video: media },
            { upload, logger: opts.logger, mediaCache: opts.mediaCache }
        );
        const videoMessage = videoPrepared.videoMessage;
        if (!videoMessage) {
            throw createError(Err.INVALID_MEDIA, 'Failed to prepare video for live photo');
        }

        let stillSource = videoMessage.jpegThumbnail;
        if (!stillSource || !stillSource.length) {
            throw createError(
                Err.INVALID_MEDIA,
                'Video has no jpegThumbnail; ensure the engine generates video thumbnails'
            );
        }
        if (typeof stillSource === 'string') {
            stillSource = Buffer.from(stillSource, 'base64');
        }

        const imagePrepared = await caps.prepareWAMessageMedia(
            { image: stillSource },
            { upload, logger: opts.logger, mediaCache: opts.mediaCache }
        );
        let imageMessage = imagePrepared.imageMessage;
        if (!imageMessage) {
            throw createError(Err.INVALID_MEDIA, 'Failed to prepare live photo still image');
        }

        if (config.newsletterAnnotation) {
            const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
            if (annotations.length) {
                imageMessage = { ...imageMessage, annotations };
                videoMessage.annotations = annotations;
            }
        }

        const messageId =
            opts.messageId ||
            generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });

        const parent = await caps.generateWAMessageFromContent(
            remoteJid,
            {
                imageMessage: {
                    ...imageMessage,
                    contextInfo: {
                        ...(imageMessage.contextInfo || {}),
                        pairedMediaType: 5,
                        statusSourceType: 0
                    }
                }
            },
            {
                userJid: ctx.meId,
                messageId,
                quoted: quoted || undefined
            }
        );

        await caps.relayMessage(remoteJid, parent.message, {
            messageId: parent.key.id
        });

        await caps.relayMessage(
            remoteJid,
            {
                videoMessage: {
                    ...videoMessage,
                    contextInfo: {
                        ...(videoMessage.contextInfo || {}),
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
            {}
        );

        return parent;
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
