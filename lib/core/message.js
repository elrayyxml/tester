/**
 * Message helpers, processors, and relay pipeline.
 */

import { promises as fs } from 'fs';
import { Error as Err, createError } from '../constant/index.js';
import {
    toMediaSource,
    generateMessageId,
    isBotMessageId,
    extractMessageId
} from '../utils/function.js';
import { info } from '../utils/logs.js';
import { prepareStickerBuffer, buildStickerPackMessage } from '../utils/sticker-pack.js';
import { buildInteractiveMessage, buildCarouselMessage, buildProductMessage } from '../utils/interactive.js';
import { buildAdditionalNodes } from './node.js';

export { generateMessageId, isBotMessageId, extractMessageId, toMediaSource };

const NEWSLETTER_POLYGON = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
];

export function createNewsletterAnnotations(config, proto) {
    if (!config?.newsletterJid) return [];
    const contentType =
        config.contentType ??
        proto?.ContextInfo?.ForwardedNewsletterMessageInfo?.ContentType?.UPDATE ??
        1;
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

export const buildNewsletterAnnotations = createNewsletterAnnotations;

export function applyContextInfo(content, options = {}) {
    if (!content || typeof content !== 'object') return content;
    const key = Object.keys(content).find((k) => k !== 'messageContextInfo') || Object.keys(content)[0];
    if (!key || typeof content[key] !== 'object') return content;

    const target = content[key];
    const ctx = { ...(target.contextInfo || {}) };

    if (options.mentions?.length) ctx.mentionedJid = options.mentions;
    if (options.mentionAll) ctx.nonJidMentions = 1;
    if (options.contextInfo) Object.assign(ctx, options.contextInfo);

    if (options.externalAdReply) {
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
        const value = raw.stealth.toLowerCase();
        if (['ios', 'android', 'web', 'desktop'].includes(value)) stealth = value;
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
        customId: raw.custom_id || raw.customId || null,
        stealth,
        newsletterAnnotation,
        metaLabel: raw.metaLabel === true || raw.secureMetaServiceLabel === true,
        secureMetaServiceLabel: raw.secureMetaServiceLabel === true || raw.metaLabel === true,
        debug: Boolean(raw.debug)
    };
}

function contentFlags(options = {}) {
    const flags = {};
    if (options.viewOnce) flags.viewOnce = true;
    if (options.viewOnceV2) flags.viewOnceV2 = true;
    if (options.ephemeral) flags.ephemeral = true;
    if (options.groupStatus) flags.groupStatus = true;
    if (options.spoiler) flags.spoiler = true;
    if (options.ai) flags.ai = true;
    if (options.isLottie) flags.isLottie = true;
    if (options.mentionAll) flags.mentionAll = true;
    if (options.mentions?.length) flags.mentions = options.mentions;
    return flags;
}

/** Client metaLabel / per-call override → inject biz attributes */
function useMetaLabel(opts = {}, config = {}) {
    if (opts.metaLabel === false || opts.secureMetaServiceLabel === false) return false;
    if (opts.metaLabel === true || opts.secureMetaServiceLabel === true) return true;
    return !!(config.metaLabel || config.secureMetaServiceLabel);
}

function relayOpts(ctx, opts = {}, message = null) {
    const meta = useMetaLabel(opts, ctx.config);
    return {
        messageId: opts.messageId,
        useCachedGroupMetadata: opts.useCachedGroupMetadata,
        addBizAttributes: meta || !!opts.addBizAttributes,
        statusJidList: opts.statusJidList,
        additionalAttributes: opts.additionalAttributes || {},
        additionalNodes: buildAdditionalNodes({
            ...opts,
            message,
            additionalNodes: opts.additionalNodes
        }),
        participant: opts.participant
    };
}

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

    const meta = useMetaLabel(opts, config);
    let payload = content;
    if (meta && payload && typeof payload === 'object') {
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

    await caps.relayMessage(jid, fullMsg.message, relayOpts({ config }, { ...opts, messageId }, fullMsg.message));

    info('Message relayed', fullMsg.key?.id || messageId);
    return fullMsg;
}

export const relayPipeline = relayMessagePipeline;

export function createMessageApi(ctx) {
    const { engineCtx, config } = ctx;
    const { caps, sock } = engineCtx;

    async function sendText(remoteJid, text, quoted = null, options = {}) {
        const opts = options || {};
        return relayMessagePipeline(ctx, remoteJid, { text, ...contentFlags(opts) }, {
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

    async function sendMedia(kind, remoteJid, media, caption, quoted, options) {
        const opts = options || {};
        const payload = { [kind]: toMediaSource(media) };

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
            Buffer.isBuffer(payload[kind])
        ) {
            try {
                payload.waveform = await caps.getAudioWaveform(payload[kind]);
            } catch {
                /* optional */
            }
        }

        if ((kind === 'image' || kind === 'video') && config.newsletterAnnotation) {
            const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
            if (annotations.length) payload.annotations = annotations;
        }

        Object.assign(payload, contentFlags(opts));

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
                { sticker: source, ...contentFlags(opts) },
                { ...opts, quoted, messageId: opts.messageId }
            );
        }

        const prepared = await prepareStickerBuffer(buffer, opts);
        const content = { sticker: prepared.buffer, ...contentFlags(opts) };
        if (prepared.isAiSticker || opts.looked || opts.isAiSticker) content.isAiSticker = true;
        if (prepared.isAvatar || opts.looked || opts.isAvatar) content.isAvatar = true;
        if (prepared.premium != null) content.premium = prepared.premium;
        else if (opts.premium != null) content.premium = opts.premium === true ? 1 : opts.premium;
        if (opts.isLottie) content.isLottie = true;

        return relayMessagePipeline(ctx, remoteJid, content, { ...opts, quoted, messageId: opts.messageId });
    }

    async function sendStickerPack(remoteJid, pack, quoted = null, options = {}) {
        const opts = options || {};
        if (!pack || typeof pack !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Sticker pack options are required');
        }
        if (!Array.isArray(pack.stickers) || !pack.stickers.length) {
            throw createError(Err.INVALID_MESSAGE, 'Sticker pack must contain at least one sticker');
        }
        if (pack.stickers.length > 60) {
            throw createError(Err.INVALID_MESSAGE, 'Sticker pack exceeds the maximum of 60 stickers');
        }
        if (pack.cover == null) {
            throw createError(Err.INVALID_MEDIA, 'Sticker pack must include a cover');
        }

        try {
            const stickerPackMessage = await buildStickerPackMessage(pack, { sock, caps });
            const messageId =
                opts.messageId ||
                generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });

            const fullMsg = await caps.generateWAMessageFromContent(
                remoteJid,
                { stickerPackMessage },
                { userJid: ctx.meId, messageId, quoted: quoted || undefined }
            );

            await caps.relayMessage(
                remoteJid,
                fullMsg.message,
                relayOpts(ctx, { ...opts, messageId: fullMsg.key?.id || messageId }, fullMsg.message)
            );

            return fullMsg;
        } catch (err) {
            throw createError(Err.INVALID_MEDIA, err?.message || String(err));
        }
    }

    async function sendAlbum(remoteJid, items, quoted = null, options = {}) {
        const opts = options || {};
        if (!Array.isArray(items) || !items.length) {
            throw createError(Err.INVALID_MESSAGE, 'Album requires items array');
        }

        const resolved = [];
        for (const item of items) {
            if (item?.image != null) {
                resolved.push({ kind: 'image', media: toMediaSource(item.image), caption: item.caption });
            } else if (item?.video != null) {
                resolved.push({ kind: 'video', media: toMediaSource(item.video), caption: item.caption });
            } else {
                throw createError(Err.INVALID_MEDIA, 'Album item needs image or video');
            }
        }

        if (resolved.length < 2) {
            const item = resolved[0];
            return sendMedia(item.kind, remoteJid, item.media, item.caption, quoted, opts);
        }

        const album = resolved.map((item) => {
            const entry = item.kind === 'image' ? { image: item.media } : { video: item.media };
            if (item.caption != null) entry.caption = item.caption;
            if (config.newsletterAnnotation) {
                const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
                if (annotations.length) entry.annotations = annotations;
            }
            return entry;
        });

        const parent = await relayMessagePipeline(ctx, remoteJid, { album }, {
            ...opts,
            quoted,
            messageId: opts.messageId,
            secureMetaServiceLabel: opts.secureMetaServiceLabel
        });

        const MEDIA_ALBUM = caps.proto?.Message?.MessageContextInfo?.MessageAssociationType?.MEDIA_ALBUM ?? 1;

        for (const item of resolved) {
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

            await caps.relayMessage(
                remoteJid,
                childMsg.message,
                relayOpts(ctx, { ...opts, messageId: childMsg.key.id }, childMsg.message)
            );
        }

        return parent;
    }

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

        let still = videoMessage.jpegThumbnail;
        if (!still?.length) {
            throw createError(Err.INVALID_MEDIA, 'Video has no jpegThumbnail');
        }
        if (typeof still === 'string') still = Buffer.from(still, 'base64');

        const imagePrepared = await caps.prepareWAMessageMedia(
            { image: still },
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
            { userJid: ctx.meId, messageId, quoted: quoted || undefined }
        );

        await caps.relayMessage(
            remoteJid,
            parent.message,
            relayOpts(ctx, { ...opts, messageId: parent.key.id }, parent.message)
        );

        const videoPayload = {
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
        };
        await caps.relayMessage(remoteJid, videoPayload, relayOpts(ctx, opts, videoPayload));

        return parent;
    }


    /**
     * Carousel cards → interactiveMessage.carouselMessage
     */
    async function sendCard(remoteJid, pack, quoted = null, options = {}) {
        const opts = options || {};
        if (!pack?.cards?.length) {
            throw createError(Err.INVALID_MESSAGE, 'cards array is required');
        }

        try {
            const content = await buildCarouselMessage(pack, {
                caps,
                upload: sock.waUploadToServer,
                opts
            });

            const messageId =
                opts.messageId ||
                generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });

            const fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, {
                userJid: ctx.meId,
                messageId,
                quoted: quoted || undefined
            });

            if (fullMsg?.message && (opts.mentions || pack.mentions || opts.mentionAll || opts.contextInfo)) {
                fullMsg.message = applyContextInfo(fullMsg.message, {
                    mentions: opts.mentions || pack.mentions,
                    mentionAll: opts.mentionAll,
                    contextInfo: opts.contextInfo
                });
            }

            await caps.relayMessage(
                remoteJid,
                fullMsg.message,
                relayOpts(ctx, { ...opts, messageId: fullMsg.key?.id || messageId }, fullMsg.message)
            );

            return fullMsg;
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Interactive + nativeFlow → interactiveMessage
     * Header: image | video | location
     */
    async function sendInteractive(remoteJid, payload, quoted = null, options = {}) {
        const opts = options || {};
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Interactive payload is required');
        }

        const buttons =
            payload.interactiveButtons || payload.buttons || payload.nativeFlow || opts.interactiveButtons;
        if (!buttons || (Array.isArray(buttons) && !buttons.length)) {
            throw createError(Err.INVALID_MESSAGE, 'interactiveButtons are required');
        }

        try {
            const content = await buildInteractiveMessage(payload, {
                caps,
                upload: sock.waUploadToServer,
                opts
            });

            const messageId =
                opts.messageId ||
                generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });

            const fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, {
                userJid: ctx.meId,
                messageId,
                quoted: quoted || undefined
            });

            if (fullMsg?.message && (payload.mentions || opts.mentions || opts.mentionAll || opts.contextInfo)) {
                fullMsg.message = applyContextInfo(fullMsg.message, {
                    mentions: payload.mentions || opts.mentions,
                    mentionAll: payload.mentionAll || opts.mentionAll,
                    contextInfo: opts.contextInfo
                });
            }

            await caps.relayMessage(
                remoteJid,
                fullMsg.message,
                relayOpts(ctx, { ...opts, messageId: fullMsg.key?.id || messageId }, fullMsg.message)
            );

            return fullMsg;
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }


    /**
     * Product message (messages.md productMessage).
     * With interactiveButtons → interactiveMessage + product header + nativeFlow.
     */
    async function sendProduct(remoteJid, payload, quoted = null, options = {}) {
        const opts = options || {};
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Product payload is required');
        }
        if (!payload.businessOwnerJid) {
            throw createError(Err.INVALID_MESSAGE, 'businessOwnerJid is required');
        }

        const buttons =
            payload.interactiveButtons || payload.buttons || payload.nativeFlow || opts.interactiveButtons;

        try {
            let content;
            if (buttons && (Array.isArray(buttons) ? buttons.length : true)) {
                content = await buildInteractiveMessage(
                    { ...payload, interactiveButtons: buttons },
                    { caps, upload: sock.waUploadToServer, opts }
                );
            } else {
                content = await buildProductMessage(payload, {
                    caps,
                    upload: sock.waUploadToServer,
                    opts
                });
            }

            const messageId =
                opts.messageId ||
                generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });

            const fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, {
                userJid: ctx.meId,
                messageId,
                quoted: quoted || undefined
            });

            if (fullMsg?.message && (payload.mentions || opts.mentions || opts.mentionAll || opts.contextInfo)) {
                fullMsg.message = applyContextInfo(fullMsg.message, {
                    mentions: payload.mentions || opts.mentions,
                    mentionAll: payload.mentionAll || opts.mentionAll,
                    contextInfo: opts.contextInfo
                });
            }

            await caps.relayMessage(
                remoteJid,
                fullMsg.message,
                relayOpts(ctx, { ...opts, messageId: fullMsg.key?.id || messageId }, fullMsg.message)
            );

            return fullMsg;
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
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
        sendStickerPack,
        sendAlbum,
        sendLivePhoto,
        sendCard,
        sendInteractive,
        sendProduct
    };
}

