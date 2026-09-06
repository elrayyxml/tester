/**
 * Message send helpers (sock.send* surface).
 * Structure aligned with Baileys messages-send.md — type helpers / relay orchestration.
 */

import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { Error as Err, createError } from '../constant/index.js';
import {
    toMediaSource,
    resolveMediaBuffer,
    generateMessageId,
    hasNonNullishProperty,
    hasOptionalProperty,
    hasValidAlbumMedia
} from '../utils/function.js';
import { prepareStickerBuffer, buildStickerPackMessage } from '../utils/sticker-pack.js';
import {
    buildAdditionalNodes,
    getBizBinaryNode,
    statusMentionMetaNode,
    groupStatusMentionMetaNode,
    mentionedUsersNode
} from './node.js';
import {
    contentFlags,
    createNewsletterAnnotations,
    relayMessagePipeline,
    prepareProductMessage,
    prepareHeaderMedia,
    buildInteractiveMessage,
    buildCarouselMessage,
    buildContactMessage,
    buildSectionsMessage,
    buildProductListMessage,
    annotateMedia,
    applyContextInfo,
    useMetaLabel,
    normalizeQuoted
} from './message.js';

export function createMessageApi(ctx) {
    const { engineCtx, config } = ctx;
    const { caps, sock } = engineCtx;

    /**
     * sendText(jid, "plain string", quoted?, options?) — classic signature, unchanged.
     * sendText(jid, { text, contextInfo?, buttons?, document?, ... }, quoted?, options?) —
     * messages.md-style free-form payload; delegates to sendMessage() so a single
     * object can inject anything (contextInfo, buttons, a document, mentions, etc.)
     * without needing a different helper per field.
     */
    async function sendText(remoteJid, text, quoted = null, options = {}) {
        const opts = options || {};
        if (text && typeof text === 'object') {
            return sendMessage(remoteJid, text, quoted, opts);
        }
        return relayMessagePipeline(ctx, remoteJid, { text, ...contentFlags(opts) }, {
            ...opts,
            quoted: normalizeQuoted(quoted),
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

    /**
     * @param {'image'|'video'|'audio'|'document'} kind
     * @param {string} remoteJid
     * @param {*} media
     * @param {string} [caption]
     * @param {object|null} [quoted]
     * @param {object} [options]
     */
    async function sendMedia(kind, remoteJid, media, caption, quoted, options) {
        const opts = options || {};
        const resolved = await resolveMediaBuffer(media);
        const payload = { [kind]: resolved };

        if (caption != null && caption !== '') payload.caption = String(caption);
        if (opts.ptv === true) payload.ptv = true;
        if (opts.gif || opts.gifPlayback) payload.gifPlayback = true;
        if (opts.fileName) payload.fileName = opts.fileName;
        if (opts.seconds != null) payload.seconds = opts.seconds;

        // audio: ptt:true → voice note + waveform; otherwise regular audio (not voicenote)
        if (kind === 'audio') {
            if (opts.ptt === true) {
                payload.ptt = true;
                if (opts.mimetype) payload.mimetype = opts.mimetype;
                if (opts.waveform) {
                    payload.waveform = opts.waveform;
                } else if (typeof caps.getAudioWaveform === 'function' && Buffer.isBuffer(resolved)) {
                    try {
                        payload.waveform = await caps.getAudioWaveform(resolved);
                    } catch {
                        /* optional */
                    }
                }
            } else {
                payload.ptt = false;
                payload.mimetype = opts.mimetype || 'audio/mpeg';
            }
        } else if (opts.mimetype) {
            payload.mimetype = opts.mimetype;
        }

        if ((kind === 'image' || kind === 'video') && config.newsletterAnnotation) {
            const annotations = createNewsletterAnnotations(config.newsletterAnnotation, caps.proto);
            if (annotations.length) payload.annotations = annotations;
        }

        Object.assign(payload, contentFlags(opts));

        return relayMessagePipeline(ctx, remoteJid, payload, {
            ...opts,
            quoted: normalizeQuoted(quoted),
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
                { userJid: ctx.meId, messageId, quoted: normalizeQuoted(quoted) }
            );

            return await relay(remoteJid, fullMsg, opts);
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

            // messages.md hasValidAlbumMedia — guard against an engine returning an
            // unexpected content type for what should be an image/video child message.
            if (!hasValidAlbumMedia(childMsg?.message || {})) {
                throw createError(Err.INVALID_MESSAGE, 'Invalid message type for album');
            }

            childMsg.message.messageContextInfo ||= {};
            childMsg.message.messageContextInfo.messageAssociation = {
                parentMessageKey: parent.key,
                associationType: MEDIA_ALBUM
            };

            await relay(remoteJid, childMsg, opts);
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
            { userJid: ctx.meId, messageId, quoted: normalizeQuoted(quoted) }
        );

        await relay(remoteJid, parent, opts);

        const videoPayload = {
            key: { remoteJid, fromMe: true, id: nextId(opts) },
            message: {
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
            }
        };
        await relay(remoteJid, videoPayload, opts);

        return parent;
    }


    /**
     * Carousel cards → interactiveMessage.carouselMessage
     */
    function nextId(opts = {}) {
        return (
            opts.messageId ||
            generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth })
        );
    }

    /**
     * Single relay for prebuilt fullMsg — shared by all helpers (messages-send.md shape).
     * @param {string} remoteJid
     * @param {object} fullMsg
     * @param {object} [opts]
     */
    async function relay(remoteJid, fullMsg, opts = {}) {
        if (!fullMsg?.message) throw createError(Err.INVALID_MESSAGE, 'Empty message');

        const msg = fullMsg.message;
        if (msg.eventMessage?.startTime != null) {
            msg.eventMessage.startTime = Math.floor(Number(msg.eventMessage.startTime));
        }
        if (msg.eventMessage?.endTime != null) {
            msg.eventMessage.endTime = Math.floor(Number(msg.eventMessage.endTime));
        }

        const messageId = fullMsg.key?.id || nextId(opts);
        if (fullMsg.key) fullMsg.key.id = messageId;
        annotateMedia(msg, config, caps?.proto);

        const additionalAttributes = { ...(opts.additionalAttributes || {}) };
        const additionalNodes = [...(opts.additionalNodes || [])];
        const isNewsletter = String(remoteJid).includes('@newsletter');
        const hasBiz = additionalNodes.some((n) => n?.tag === 'biz');

        if (msg.eventMessage && !additionalNodes.some((n) => n?.attrs?.event_type === 'creation')) {
            additionalNodes.push({ tag: 'meta', attrs: { event_type: 'creation' }, content: undefined });
        }

        const isPoll = !!(
            msg.pollCreationMessage ||
            msg.pollCreationMessageV2 ||
            msg.pollCreationMessageV3 ||
            msg.pollCreationMessageV5 ||
            msg.pollCreationMessageV6 ||
            msg.pollUpdateMessage ||
            msg.pollResultSnapshotMessage ||
            msg.pollResultSnapshotMessageV3
        );
        if (isPoll && !additionalNodes.some((n) => n?.attrs?.polltype)) {
            const isQuiz =
                !!msg.pollCreationMessageV5 ||
                msg.pollResultSnapshotMessageV3?.pollType === 1 ||
                opts.polltype === 'quiz_creation';
            const attrs = { polltype: isQuiz ? 'quiz_creation' : 'creation' };
            if (isNewsletter) attrs.contenttype = 'text';
            additionalNodes.push({ tag: 'meta', attrs, content: undefined });
        }

        // metaLabel / secureMetaServiceLabel → biz on every message; interactive/product always
        const addBizAttributes = useMetaLabel(opts, config) || !!opts.addBizAttributes;
        const needBiz =
            !hasBiz &&
            (addBizAttributes ||
                !!msg.interactiveMessage ||
                !!msg.buttonsMessage ||
                !!msg.listMessage ||
                !!msg.templateMessage ||
                !!msg.productMessage);

        if (needBiz) {
            try {
                additionalNodes.push(getBizBinaryNode(msg));
            } catch {
                additionalNodes.push(getBizBinaryNode({}));
            }
        }

        await caps.relayMessage(remoteJid, msg, {
            messageId,
            useCachedGroupMetadata: opts.useCachedGroupMetadata,
            addBizAttributes: addBizAttributes || needBiz,
            statusJidList: opts.statusJidList,
            additionalAttributes,
            additionalNodes,
            participant: opts.participant
        });

        return fullMsg;
    }

    /**
     * generateWAMessageFromContent + contextInfo + shared relay.
     * @param {string} remoteJid
     * @param {object} content
     * @param {object|null} quoted
     * @param {object} [opts]
     */
    async function sendContent(remoteJid, content, quoted, opts = {}) {
        const messageId = nextId(opts);
        const fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, {
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted)
        });
        const ctxOpts = {
            mentions: opts.mentions,
            mentionAll: opts.mentionAll,
            contextInfo: opts.contextInfo,
            externalAdReply: opts.externalAdReply,
            groupStatus: opts.groupStatus,
            spoiler: opts.spoiler
        };
        if (fullMsg?.message && Object.values(ctxOpts).some((v) => v != null && v !== false)) {
            fullMsg.message = applyContextInfo(fullMsg.message, ctxOpts);
        }
        return relay(remoteJid, fullMsg, opts);
    }

    /** Shared genOpts with sanitized quoted (prevents fromMe crash). */
    function genOptsFor(quoted, opts = {}) {
        return {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId: nextId(opts),
            quoted: normalizeQuoted(quoted),
            upload: sock.waUploadToServer,
            mediaCache: opts.mediaCache
        };
    }

    /**
     * Cards → interactiveMessage.carouselMessage (messages.md cards)
     */
    async function sendCard(remoteJid, pack, quoted = null, options = {}) {
        const opts = options || {};
        if (!pack?.cards?.length) {
            throw createError(Err.INVALID_MESSAGE, 'cards required');
        }

        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted),
            upload: sock.waUploadToServer,
            mediaCache: opts.mediaCache
        };

        // native: generateWAMessage({ cards, text, footer, ... })
        try {
            const fullMsg = await caps.generateWAMessage(
                remoteJid,
                {
                    cards: pack.cards,
                    text: pack.text,
                    footer: pack.footer,
                    mentions: pack.mentions,
                    title: pack.title
                },
                genOpts
            );
            if (fullMsg?.message?.interactiveMessage?.carouselMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* builder fallback */
        }

        try {
            const content = await buildCarouselMessage(pack, {
                caps,
                upload: sock.waUploadToServer,
                opts,
                config
            });
            if (pack.mentions) opts.mentions = pack.mentions;
            return await sendContent(remoteJid, content, quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Interactive / nativeFlow — supports image, video, document, product, location header + contextInfo.
     * @param {string} remoteJid
     * @param {object} payload
     * @param {object|null} [quoted]
     * @param {object} [options]
     */
    async function sendInteractive(remoteJid, payload, quoted = null, options = {}) {
        const opts = { ...(options || {}) };
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Interactive payload is required');
        }
        const source =
            payload.interactiveButtons ||
            payload.nativeFlowMessage ||
            payload.buttons ||
            payload.nativeFlow;
        if (!source || (Array.isArray(source) && !source.length)) {
            throw createError(Err.INVALID_MESSAGE, 'interactiveButtons are required');
        }

        if (payload.mentions) opts.mentions = payload.mentions;
        if (payload.mentionAll) opts.mentionAll = payload.mentionAll;
        if (payload.contextInfo) opts.contextInfo = { ...payload.contextInfo, ...opts.contextInfo };
        if (payload.externalAdReply) opts.externalAdReply = payload.externalAdReply;

        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted),
            upload: sock.waUploadToServer,
            mediaCache: opts.mediaCache
        };

        try {
            const fullMsg = await caps.generateWAMessage(remoteJid, payload, genOpts);
            if (fullMsg?.message?.interactiveMessage) {
                if (opts.mentions || opts.mentionAll || opts.contextInfo || opts.externalAdReply) {
                    fullMsg.message = applyContextInfo(fullMsg.message, opts);
                }
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* builder fallback */
        }

        try {
            const built = await buildInteractiveMessage(payload, {
                caps,
                upload: sock.waUploadToServer,
                opts,
                config
            });
            return await sendContent(remoteJid, built, quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Product (messages.md product → productMessage; + buttons → interactive header)
     * productImage via image:; payload preserved, no long remap.
     */
    /**
     * Product message — maps flat title/productId/currencyCode/priceAmount1000/…
     * into productMessage.product. With buttons → interactive header.
     * @param {string} remoteJid
     * @param {object} payload
     * @param {object|null} [quoted]
     * @param {object} [options]
     */
    async function sendProduct(remoteJid, payload, quoted = null, options = {}) {
        const opts = { ...(options || {}) };
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Product payload is required');
        }
        if (!hasNonNullishProperty(payload, 'businessOwnerJid')) {
            throw createError(Err.INVALID_MESSAGE, 'businessOwnerJid is required');
        }

        if (payload.mentions) opts.mentions = payload.mentions;
        if (payload.mentionAll) opts.mentionAll = payload.mentionAll;
        if (payload.contextInfo) opts.contextInfo = { ...payload.contextInfo, ...opts.contextInfo };

        const buttons =
            payload.interactiveButtons ||
            payload.nativeFlowMessage ||
            payload.buttons ||
            payload.nativeFlow ||
            opts.interactiveButtons;

        if (buttons && (Array.isArray(buttons) ? buttons.length : true)) {
            try {
                const built = await buildInteractiveMessage(
                    { ...payload, interactiveButtons: buttons },
                    { caps, upload: sock.waUploadToServer, opts, config }
                );
                return await sendContent(remoteJid, built, quoted, opts);
            } catch (err) {
                throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
            }
        }

        try {
            const content = await prepareProductMessage(payload, {
                caps,
                upload: sock.waUploadToServer,
                opts,
                config
            });
            return await sendContent(remoteJid, content, quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Order (messages.md order → orderMessage)
     * sock.sendOrder(remoteJid, order, quoted?)
     */
    async function sendOrder(remoteJid, order, quoted = null, options = {}) {
        const opts = options || {};
        if (!order || typeof order !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Order payload is required');
        }

        const orderId = order.orderId ?? order.id;
        if (!orderId) {
            throw createError(Err.INVALID_MESSAGE, 'orderId is required');
        }

        // messages.md field map
        const orderContent = {
            id: orderId,
            thumbnail: order.thumbnail,
            itemCount: order.itemCount,
            status: order.status,
            surface: order.surface,
            title: order.orderTitle ?? order.title,
            text: order.message ?? order.text,
            seller: order.sellerJid ?? order.seller,
            token: order.token,
            amount: order.totalAmount1000 ?? order.amount,
            currency: order.totalCurrencyCode ?? order.currency
        };

        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted)
        };

        try {
            const fullMsg = await caps.generateWAMessage(remoteJid, { order: orderContent }, genOpts);
            if (fullMsg?.message?.orderMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* FromContent fallback */
        }

        const orderMessage = {
            orderId: orderContent.id,
            thumbnail: orderContent.thumbnail,
            itemCount: orderContent.itemCount,
            status: orderContent.status,
            surface: orderContent.surface,
            orderTitle: orderContent.title,
            message: orderContent.text,
            sellerJid: orderContent.seller,
            token: orderContent.token,
            totalAmount1000: orderContent.amount,
            totalCurrencyCode: orderContent.currency
        };

        return await sendContent(remoteJid, { orderMessage }, quoted, opts);
    }

    /**
     * Contact / business vCard
     */
    async function sendContact(remoteJid, contactOrList, quoted = null, options = {}) {
        const opts = options || {};
        if (contactOrList == null) {
            throw createError(Err.INVALID_MESSAGE, 'Contact payload is required');
        }
        try {
            return await sendContent(remoteJid, buildContactMessage(contactOrList), quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Event — messages.md { event } + meta event_type
     */
    async function sendEvent(remoteJid, event, quoted = null, options = {}) {
        const opts = options || {};
        if (!event || typeof event !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Event payload is required');
        }
        if (!event.name || typeof event.name !== 'string') {
            throw createError(Err.INVALID_MESSAGE, 'Event name must be a valid string');
        }
        if (event.startDate == null) {
            throw createError(Err.INVALID_MESSAGE, 'Event startDate is required');
        }
        const startDate = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
        if (Number.isNaN(startDate.getTime())) {
            throw createError(Err.INVALID_MESSAGE, 'Event startDate is invalid');
        }

        const messageSecret = event.messageSecret || randomBytes(32);
        const endDate =
            event.endDate != null
                ? event.endDate instanceof Date
                    ? event.endDate
                    : new Date(event.endDate)
                : undefined;

        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted),
            getCallLink: opts.getCallLink || sock.createCallLink || sock.getCallLink,
            upload: sock.waUploadToServer
        };

        const eventBody = {
            name: event.name,
            description: event.description,
            startDate,
            endDate,
            location: event.location,
            call: event.call,
            isCancelled: event.isCancelled ?? event.isCanceled ?? false,
            extraGuestsAllowed: event.extraGuestsAllowed,
            isScheduleCall: event.isScheduleCall ?? false,
            messageSecret
        };

        let fullMsg;
        try {
            fullMsg = await caps.generateWAMessage(remoteJid, { event: eventBody }, genOpts);
            if (!fullMsg?.message?.eventMessage) throw new globalThis.Error('no eventMessage');
        } catch {
            const startTime = Math.floor(startDate.getTime() / 1000);
            const eventMessage = {
                name: event.name,
                description: event.description,
                startTime,
                endTime:
                    endDate && !Number.isNaN(endDate.getTime())
                        ? Math.floor(endDate.getTime() / 1000)
                        : undefined,
                isCanceled: eventBody.isCancelled,
                extraGuestsAllowed: event.extraGuestsAllowed,
                isScheduleCall: event.isScheduleCall ?? false,
                location: event.location
            };
            if (event.call && typeof genOpts.getCallLink === 'function') {
                const token = await genOpts.getCallLink(event.call, { startTime });
                eventMessage.joinLink =
                    (event.call === 'audio'
                        ? 'https://call.whatsapp.com/voice/'
                        : 'https://call.whatsapp.com/video/') + token;
            }
            fullMsg = await caps.generateWAMessageFromContent(
                remoteJid,
                { eventMessage, messageContextInfo: { messageSecret } },
                genOpts
            );
        }

        return relay(remoteJid, fullMsg, opts);
    }

    /**
     * Poll — messages.md { poll } + meta polltype
     */
    async function sendPoll(remoteJid, values, pollOptions = {}, quoted = null, options = {}) {
        const opts = options || {};
        if (!Array.isArray(values) || values.length < 2) {
            throw createError(Err.INVALID_MESSAGE, 'Poll requires at least 2 values');
        }
        const name = pollOptions.name;
        if (!name || typeof name !== 'string') {
            throw createError(Err.INVALID_MESSAGE, 'Poll name is required');
        }

        const selectableCount = pollOptions.selectableCount ?? 0;
        if (selectableCount < 0 || selectableCount > values.length) {
            throw createError(
                Err.INVALID_MESSAGE,
                `selectableCount must be >= 0 and <= ${values.length}`
            );
        }

        const isNewsletter = String(remoteJid).includes('@newsletter');
        const isQuiz = pollOptions.pollType === 1;
        if (isQuiz && !isNewsletter) {
            throw createError(Err.INVALID_MESSAGE, 'Quiz are only allowed for newsletter');
        }

        const messageSecret = pollOptions.messageSecret || randomBytes(32);
        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted)
        };

        const poll = {
            name,
            values: values.map(String),
            selectableCount,
            toAnnouncementGroup: pollOptions.toAnnouncementGroup ?? false,
            endDate: pollOptions.endDate,
            hideVoter: pollOptions.hideVoter,
            canAddOption: pollOptions.canAddOption,
            pollType: pollOptions.pollType,
            correctAnswer: pollOptions.correctAnswer,
            messageSecret
        };

        let fullMsg;
        try {
            fullMsg = await caps.generateWAMessage(remoteJid, { poll }, genOpts);
            const m = fullMsg?.message || {};
            if (
                !(
                    m.pollCreationMessage ||
                    m.pollCreationMessageV2 ||
                    m.pollCreationMessageV3 ||
                    m.pollCreationMessageV5 ||
                    m.pollCreationMessageV6
                )
            ) {
                throw new globalThis.Error('no poll');
            }
        } catch {
            const body = {
                name,
                selectableOptionsCount: selectableCount,
                options: values.map((optionName) => ({ optionName: String(optionName) })),
                endTime: pollOptions.endDate ? new Date(pollOptions.endDate).getTime() : undefined,
                hideParticipantName: pollOptions.hideVoter ?? false,
                allowAddOption: pollOptions.canAddOption ?? false
            };
            let content;
            if (poll.toAnnouncementGroup) content = { pollCreationMessageV2: body };
            else if (isQuiz) {
                if (pollOptions.correctAnswer == null) {
                    throw createError(Err.INVALID_MESSAGE, 'correctAnswer required for quiz poll');
                }
                content = {
                    pollCreationMessageV5: {
                        ...body,
                        correctAnswer: { optionName: String(pollOptions.correctAnswer) },
                        pollType: 1,
                        selectableOptionsCount: 1
                    }
                };
            } else if (selectableCount === 1) content = { pollCreationMessageV3: body };
            else content = { pollCreationMessage: body };
            content.messageContextInfo = { messageSecret };
            fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, genOpts);
        }

        return relay(remoteJid, fullMsg, {
            ...opts,
            polltype: isQuiz ? 'quiz_creation' : 'creation'
        });
    }

    /**
     * Poll result — messages.md { pollResult }
     */
    async function sendPollResult(remoteJid, name, votes, quoted = null, options = {}) {
        const opts = options || {};
        if (!name || typeof name !== 'string') {
            throw createError(Err.INVALID_MESSAGE, 'Poll result name is required');
        }
        if (!Array.isArray(votes) || !votes.length) {
            throw createError(Err.INVALID_MESSAGE, 'Poll result votes are required');
        }

        const messageId = nextId(opts);
        const genOpts = {
            userJid: ctx.meId,
            messageId,
            quoted: normalizeQuoted(quoted)
        };

        const pollResult = {
            name,
            votes: votes.map((v) => ({
                name: String(v.name ?? v.optionName ?? ''),
                voteCount: String(v.count ?? v.voteCount ?? 0)
            })),
            pollType: opts.pollType
        };

        let fullMsg;
        try {
            fullMsg = await caps.generateWAMessage(remoteJid, { pollResult }, genOpts);
            if (
                !fullMsg?.message?.pollResultSnapshotMessage &&
                !fullMsg?.message?.pollResultSnapshotMessageV3
            ) {
                throw new globalThis.Error('no pollResult');
            }
        } catch {
            const pollVotes = votes.map((v) => ({
                optionName: String(v.name ?? v.optionName ?? ''),
                optionVoteCount: parseInt(v.count ?? v.voteCount ?? 0, 10)
            }));
            const snap = { name, pollVotes };
            const content =
                opts.pollType === 1
                    ? {
                          pollResultSnapshotMessageV3: {
                              ...snap,
                              pollType: caps.proto?.Message?.PollType?.QUIZ ?? 1
                          }
                      }
                    : {
                          pollResultSnapshotMessage: {
                              ...snap,
                              pollType: caps.proto?.Message?.PollType?.POLL ?? 0
                          }
                      };
            fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, genOpts);
        }

        return relay(remoteJid, fullMsg, { ...opts, polltype: 'creation' });
    }

    /**
     * Location — messages.md { location } → locationMessage
     * sock.sendLocation(remoteJid, { degreesLatitude, degreesLongitude, name?, address? }, quoted?)
     */
    async function sendLocation(remoteJid, location, quoted = null, options = {}) {
        const opts = options || {};
        if (!location || typeof location !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Location payload is required');
        }
        if (typeof location.degreesLatitude !== 'number' || typeof location.degreesLongitude !== 'number') {
            throw createError(Err.INVALID_MESSAGE, 'degreesLatitude and degreesLongitude are required numbers');
        }

        try {
            return await relayMessagePipeline(ctx, remoteJid, { location }, {
                ...opts,
                quoted,
                mentions: opts.mentions,
                mentionAll: opts.mentionAll,
                contextInfo: opts.contextInfo,
                messageId: opts.messageId
            });
        } catch {
            /* builder fallback: raw locationMessage, no engine mediation needed */
        }

        const locationMessage = {
            degreesLatitude: location.degreesLatitude,
            degreesLongitude: location.degreesLongitude,
            name: location.name,
            address: location.address,
            url: location.url,
            jpegThumbnail: location.jpegThumbnail || location.thumbnail
        };
        return await sendContent(remoteJid, { locationMessage }, quoted, opts);
    }

    /**
     * Classic buttonsMessage — messages.md `{ buttons }` path.
     * Must attach biz MIXED native_flow so clicks emit buttonsResponseMessage.
     * @param {string} remoteJid
     * @param {object} payload
     * @param {object|null} [quoted]
     * @param {object} [options]
     */
    async function sendButtons(remoteJid, payload, quoted = null, options = {}) {
        const opts = { ...(options || {}) };
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Buttons payload is required');
        }
        if (!Array.isArray(payload.buttons) || !payload.buttons.length) {
            throw createError(Err.INVALID_MESSAGE, 'buttons must be a non-empty array');
        }

        if (payload.mentions) opts.mentions = payload.mentions;
        if (payload.mentionAll) opts.mentionAll = payload.mentionAll;
        if (payload.contextInfo) opts.contextInfo = { ...payload.contextInfo, ...opts.contextInfo };

        // Prefer stock generator only when it actually yields buttonsMessage
        try {
            const fullMsg = await caps.generateWAMessage(
                remoteJid,
                {
                    buttons: payload.buttons,
                    text: payload.text,
                    caption: payload.caption,
                    footer: payload.footer,
                    image: payload.image,
                    video: payload.video,
                    document: payload.document
                },
                genOptsFor(quoted, opts)
            );
            if (fullMsg?.message?.buttonsMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* fallback builder */
        }

        let headerMedia = null;
        let headerType = 1; // ButtonHeaderType.EMPTY
        if (payload.image || payload.video || payload.document) {
            headerMedia = await prepareHeaderMedia(payload, caps, sock.waUploadToServer, opts);
            if (headerMedia?.imageMessage) headerType = 4;
            else if (headerMedia?.videoMessage) headerType = 5;
            else if (headerMedia?.documentMessage) headerType = 3;
        }

        // messages.md buttons map: RESPONSE (1) or NATIVE_FLOW with nativeFlowInfo
        const buttons = payload.buttons.map((button) => {
            const buttonText = button.text ?? button.buttonText;
            const display =
                typeof buttonText === 'string' ? { displayText: buttonText } : buttonText || { displayText: '' };

            if (button.nativeFlowInfo || button.name) {
                return {
                    buttonId: button.id ?? button.buttonId,
                    buttonText: display,
                    nativeFlowInfo: button.nativeFlowInfo || {
                        name: button.name,
                        paramsJson: button.paramsJson ?? button.buttonParamsJson
                    },
                    type: button.type ?? 2 // NATIVE_FLOW
                };
            }
            return {
                buttonId: String(button.id ?? button.buttonId ?? ''),
                buttonText: display,
                type: button.type ?? 1 // RESPONSE — required for buttonsResponseMessage on click
            };
        });

        if (buttons.some((b) => b.type === 1 && !b.buttonId)) {
            throw createError(Err.INVALID_MESSAGE, 'each response button needs id / buttonId');
        }

        const buttonsMessage = {
            contentText: payload.caption ?? payload.text ?? '',
            footerText: payload.footer,
            headerType,
            buttons,
            ...(headerMedia || {})
        };

        return await sendContent(remoteJid, { buttonsMessage }, quoted, opts);
    }

    /**
     * List message — messages.md `{ sections }` → listMessage (listType SINGLE_SELECT).
     * Clicks emit listResponseMessage when biz list node is attached.
     * @param {string} remoteJid
     * @param {object} payload
     * @param {object|null} [quoted]
     * @param {object} [options]
     */
    async function sendSections(remoteJid, payload, quoted = null, options = {}) {
        const opts = { ...(options || {}) };
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Sections payload is required');
        }
        if (!Array.isArray(payload.sections) || !payload.sections.length) {
            throw createError(Err.INVALID_MESSAGE, 'sections must be a non-empty array');
        }

        if (payload.mentions) opts.mentions = payload.mentions;
        if (payload.contextInfo) opts.contextInfo = { ...payload.contextInfo, ...opts.contextInfo };

        try {
            const fullMsg = await caps.generateWAMessage(
                remoteJid,
                {
                    sections: payload.sections,
                    title: payload.title,
                    text: payload.text,
                    buttonText: payload.buttonText,
                    footer: payload.footer
                },
                genOptsFor(quoted, opts)
            );
            if (fullMsg?.message?.listMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* fallback */
        }

        try {
            const content = buildSectionsMessage(payload);
            return await sendContent(remoteJid, content, quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Product list — messages.md { productList } → listMessage (PRODUCT_LIST).
     * sock.sendProductList(remoteJid, { title, businessOwnerJid, productList: [...], thumbnail? }, quoted?)
     */
    async function sendProductList(remoteJid, payload, quoted = null, options = {}) {
        const opts = options || {};
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'ProductList payload is required');
        }
        if (!hasNonNullishProperty(payload, 'businessOwnerJid')) {
            throw createError(Err.INVALID_MESSAGE, 'businessOwnerJid is required');
        }

        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId: nextId(opts),
            quoted: normalizeQuoted(quoted),
            upload: sock.waUploadToServer,
            mediaCache: opts.mediaCache
        };

        try {
            const fullMsg = await caps.generateWAMessage(remoteJid, { productList: payload.productList, ...payload }, genOpts);
            if (fullMsg?.message?.listMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* builder fallback */
        }

        try {
            const content = await buildProductListMessage(payload, {
                caps,
                upload: sock.waUploadToServer,
                opts
            });
            return await sendContent(remoteJid, content, quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Poll vote (encrypted) — messages.md { pollUpdate } → pollUpdateMessage.
     * sock.sendPollUpdate(remoteJid, { key, vote, metadata? })
     */
    async function sendPollUpdate(remoteJid, pollUpdate, options = {}) {
        const opts = options || {};
        if (!pollUpdate || typeof pollUpdate !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Poll update payload is required');
        }
        if (!pollUpdate.key) {
            throw createError(Err.INVALID_MESSAGE, 'Poll update requires the original poll message key');
        }
        if (!pollUpdate.vote) {
            throw createError(Err.INVALID_MESSAGE, 'Encrypted vote payload is required');
        }

        const messageId = nextId(opts);
        const genOpts = {
            userJid: ctx.meId,
            messageId
        };

        try {
            const fullMsg = await caps.generateWAMessage(remoteJid, { pollUpdate }, genOpts);
            if (fullMsg?.message?.pollUpdateMessage) {
                return await relay(remoteJid, fullMsg, { ...opts, polltype: 'vote' });
            }
        } catch {
            /* builder fallback */
        }

        const content = {
            pollUpdateMessage: {
                metadata: pollUpdate.metadata,
                pollCreationMessageKey: pollUpdate.key,
                senderTimestampMs: Date.now(),
                vote: pollUpdate.vote
            }
        };
        return await sendContent(remoteJid, content, null, { ...opts, polltype: 'vote' });
    }

    /**
     * Group status — sends a normal content payload flagged as a group status update
     * (base meta node added automatically via buildAdditionalNodes/{groupStatus:true}),
     * with optional status mentions (node.js statusMentionMetaNode / mentionedUsersNode).
     * sock.sendGroupStatus(remoteJid, { text | image | video | ... }, { mentions? }, quoted?)
     */
    async function sendGroupStatus(remoteJid, content, options = {}, quoted = null) {
        const opts = options || {};
        if (!content || typeof content !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Group status content is required');
        }

        const isGroup = String(remoteJid).includes('@g.us');
        const mentions = opts.mentions;
        // note: the base "is_group_status" meta node is added automatically by
        // buildAdditionalNodes() via the `groupStatus: true` flag below — only the
        // mention-specific nodes need to be added here.
        const extraNodes = [];
        if (Array.isArray(mentions) && mentions.length) {
            // group status update mentioning participants vs. a 1:1 status mention
            extraNodes.push(isGroup ? groupStatusMentionMetaNode() : statusMentionMetaNode());
            extraNodes.push(mentionedUsersNode(mentions));
        }

        const pipelineOpts = {
            ...opts,
            quoted,
            mentions,
            groupStatus: true,
            additionalNodes: [...(opts.additionalNodes || []), ...extraNodes],
            messageId: opts.messageId
        };

        try {
            return await relayMessagePipeline(ctx, remoteJid, { ...content, groupStatus: true }, pipelineOpts);
        } catch {
            /* engine may not recognize the "groupStatus" content flag — retry without it,
               the group-status semantics are already carried by additionalNodes/relayOpts */
        }

        return await relayMessagePipeline(ctx, remoteJid, content, pipelineOpts);
    }

    /**
     * Generic content router — mirrors messages.md sock.sendMessage(jid, content, options).
     * Accepts one free-form payload object and routes it to the matching helper by
     * detecting which key is present (hasNonNullishProperty), same if-else-chain
     * philosophy as generateWAMessageContent, just delegating to this library's
     * already-built send* helpers instead of re-implementing each proto shape here.
     *
     * sock.sendMessage(jid, { text, contextInfo?, mentions?, ... })
     * sock.sendMessage(jid, { image | video | audio | document, caption? })
     * sock.sendMessage(jid, { buttons, text? })
     * sock.sendMessage(jid, { sections, title?, buttonText? })
     * sock.sendMessage(jid, { productList, businessOwnerJid })
     * sock.sendMessage(jid, { product, businessOwnerJid })
     * sock.sendMessage(jid, { interactiveButtons | nativeFlow, ... })
     * sock.sendMessage(jid, { cards, ... })
     * sock.sendMessage(jid, { location })
     * sock.sendMessage(jid, { contacts })
     * sock.sendMessage(jid, { sticker })
     * sock.sendMessage(jid, { react, key? })
     * sock.sendMessage(jid, { poll })
     * sock.sendMessage(jid, { pollUpdate })
     * sock.sendMessage(jid, { pollResult })
     * sock.sendMessage(jid, { event })
     * sock.sendMessage(jid, { order })
     * sock.sendMessage(jid, { album })
     * ...falls back to sendText for a plain string/{ text } payload.
     */
    /**
     * Generic content router — mirrors messages.md generateWAMessageContent if/else chain.
     * sock.sendMessage(jid, content, options) style entry.
     */
    async function send(remoteJid, content, quoted = null, options = {}) {
        const opts = options || {};

        if (typeof content === 'string') {
            return sendText(remoteJid, content, quoted, opts);
        }
        if (!content || typeof content !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'content must be a string or a payload object');
        }

        if (hasNonNullishProperty(content, 'react')) {
            const react = content.react;
            return sendReact(remoteJid, react?.text ?? react, react?.key ?? opts.key, opts);
        } else if (hasNonNullishProperty(content, 'sticker')) {
            return sendSticker(remoteJid, content.sticker, quoted, opts);
        } else if (hasNonNullishProperty(content, 'stickers')) {
            return sendStickerPack(remoteJid, content.stickers, quoted, opts);
        } else if (hasNonNullishProperty(content, 'album')) {
            return sendAlbum(remoteJid, content.album, quoted, opts);
        } else if (hasOptionalProperty(content, 'ptv') && content.ptv) {
            return sendLivePhoto(remoteJid, content.video, quoted, opts);
        } else if (hasNonNullishProperty(content, 'image')) {
            return sendImage(remoteJid, content.image, content.caption, quoted, opts);
        } else if (hasNonNullishProperty(content, 'video')) {
            return sendVideo(remoteJid, content.video, content.caption, quoted, opts);
        } else if (hasNonNullishProperty(content, 'audio')) {
            return sendAudio(remoteJid, content.audio, quoted, { ...opts, caption: content.caption });
        } else if (hasNonNullishProperty(content, 'document')) {
            return sendFile(remoteJid, content.document, quoted, { ...opts, caption: content.caption });
        } else if (hasNonNullishProperty(content, 'location')) {
            return sendLocation(remoteJid, content.location, quoted, opts);
        } else if (hasNonNullishProperty(content, 'contacts')) {
            return sendContact(remoteJid, content.contacts?.contacts ?? content.contacts, quoted, opts);
        } else if (hasNonNullishProperty(content, 'productList')) {
            return sendProductList(remoteJid, content, quoted, opts);
        } else if (hasNonNullishProperty(content, 'product')) {
            return sendProduct(remoteJid, content, quoted, opts);
        } else if (hasNonNullishProperty(content, 'cards')) {
            return sendCard(remoteJid, content, quoted, opts);
        } else if (
            hasNonNullishProperty(content, 'interactiveButtons') ||
            hasNonNullishProperty(content, 'nativeFlow') ||
            hasNonNullishProperty(content, 'nativeFlowMessage')
        ) {
            return sendInteractive(remoteJid, content, quoted, opts);
        } else if (hasNonNullishProperty(content, 'buttons')) {
            return sendButtons(remoteJid, content, quoted, opts);
        } else if (hasNonNullishProperty(content, 'sections')) {
            return sendSections(remoteJid, content, quoted, opts);
        } else if (hasNonNullishProperty(content, 'order')) {
            return sendOrder(remoteJid, content.order, quoted, opts);
        } else if (hasNonNullishProperty(content, 'event')) {
            return sendEvent(remoteJid, content.event, quoted, opts);
        } else if (hasNonNullishProperty(content, 'poll')) {
            return sendPoll(remoteJid, content.poll?.values, content.poll, quoted, opts);
        } else if (hasNonNullishProperty(content, 'pollUpdate')) {
            return sendPollUpdate(remoteJid, content.pollUpdate, opts);
        } else if (hasNonNullishProperty(content, 'pollResult')) {
            const pr = content.pollResult;
            return sendPollResult(remoteJid, pr?.name, pr?.votes, quoted, opts);
        } else if (hasOptionalProperty(content, 'groupStatus') && content.groupStatus) {
            const { groupStatus, ...rest } = content;
            return sendGroupStatus(remoteJid, rest, opts, quoted);
        }

        // fallback: text (messages.md default path)
        return sendText(remoteJid, content.text ?? content.caption ?? '', quoted, {
            ...opts,
            contextInfo: content.contextInfo ?? opts.contextInfo,
            mentions: content.mentions ?? opts.mentions,
            mentionAll: content.mentionAll ?? opts.mentionAll,
            externalAdReply: content.externalAdReply ?? opts.externalAdReply,
            ai: content.ai ?? opts.ai
        });
    }

    // messages.md / sock.sendMessage alias
    const sendMessage = send;

    return {
        send,
        sendMessage,
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
        sendProduct,
        sendContact,
        sendOrder,
        sendEvent,
        sendPoll,
        sendPollResult,
        sendLocation,
        sendButtons,
        sendSections,
        sendProductList,
        sendPollUpdate,
        sendGroupStatus
    };
}

