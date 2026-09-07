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
    prepareProductMessage,
    prepareHeaderMedia,
    buildInteractiveMessage,
    buildCarouselMessage,
    buildContactMessage,
    buildSectionsMessage,
    buildProductListMessage,
    annotateMedia,
    applyContextInfo,
    useMetaLabel
} from './message.js';

export function createMessageApi(ctx) {
    const { engineCtx, config } = ctx;
    const { caps, sock } = engineCtx;

    /** sendText(jid, "plain string", quoted?, options?) — classic signature, unchanged. */

    /** / */
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

        return genRelay(remoteJid, payload, quoted, {
            ...opts,
            mentions: opts.mentions,
            mentionAll: opts.mentionAll,
            contextInfo: opts.contextInfo,
            externalAdReply: opts.externalAdReply,
            ai: opts.ai,
            messageId: opts.messageId,
            secureMetaServiceLabel: opts.secureMetaServiceLabel
        });
    }

    function isProtoContent(content) {
        if (!content || typeof content !== 'object') return false;
        return Object.keys(content).some(
            (k) => k.endsWith('Message') || k === 'conversation' || k === 'messageContextInfo'
        );
    }

    /** messages.md-style content builder for Nexray helpers (product / interactive / sections…). */
    async function genWAMessageContent(message, options = {}) {
        const mediaOpts = {
            upload: sock.waUploadToServer,
            logger: options.logger,
            mediaCache: options.mediaCache,
            options: options.httpOptions || options.options
        };
        const ctx = { caps, upload: sock.waUploadToServer, opts: mediaOpts, config };
        let m = {};

        if (hasNonNullishProperty(message, 'raw')) {
            const { raw, ...rest } = message;
            return rest;
        }

        if (
            hasNonNullishProperty(message, 'interactiveButtons') ||
            hasNonNullishProperty(message, 'nativeFlowMessage') ||
            hasNonNullishProperty(message, 'nativeFlow')
        ) {
            return buildInteractiveMessage(message, ctx);
        }
        if (hasNonNullishProperty(message, 'cards')) {
            return buildCarouselMessage(message, ctx);
        }
        if (hasNonNullishProperty(message, 'product') || hasNonNullishProperty(message, 'productId')) {
            m.productMessage = await prepareProductMessage(message, ctx);
            return m;
        }
        if (hasNonNullishProperty(message, 'sections')) {
            return buildSectionsMessage(message);
        }
        if (hasNonNullishProperty(message, 'productList')) {
            return buildProductListMessage(message, ctx);
        }
        if (hasNonNullishProperty(message, 'contacts') || hasNonNullishProperty(message, 'contact')) {
            return buildContactMessage(message.contacts || message.contact || message);
        }

        return message;
    }

    /** Global relay — all helpers go through here. */
    async function genRelay(remoteJid, contentOrFull, quoted = null, options = {}) {
        let q = quoted;
        let opts = { ...(options || {}) };
        if (
            quoted &&
            typeof quoted === 'object' &&
            !quoted.key &&
            !(options && Object.keys(options).length)
        ) {
            opts = { ...quoted };
            q = quoted.quoted || null;
        }

        // metaLabel true → always on every message
        const metaOn = useMetaLabel(opts, config);
        if (metaOn) {
            opts.secureMetaServiceLabel = true;
            opts.addBizAttributes = true;
        }

        const messageId =
            opts.messageId ||
            contentOrFull?.key?.id ||
            generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });

        const genBase = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: q ?? opts.quoted,
            ephemeralExpiration: opts.ephemeralExpiration,
            upload: opts.upload || sock.waUploadToServer,
            mediaCache: opts.mediaCache,
            options: opts.httpOptions || opts.options
        };

        let fullMsg = contentOrFull?.message ? contentOrFull : null;

        if (!fullMsg) {
            let content = contentOrFull;

            // build proto content for product / interactive / sections when needed
            if (
                content &&
                typeof content === 'object' &&
                !isProtoContent(content) &&
                (content.product ||
                    content.productId ||
                    content.interactiveButtons ||
                    content.nativeFlowMessage ||
                    content.nativeFlow ||
                    content.cards ||
                    content.sections ||
                    content.productList)
            ) {
                content = await genWAMessageContent(content, opts);
            }

            if (metaOn && content && typeof content === 'object' && !isProtoContent(content)) {
                content = { ...content, secureMetaServiceLabel: true };
            }

            if (isProtoContent(content)) {
                fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, genBase);
            } else {
                fullMsg = await caps.generateWAMessage(remoteJid, content, {
                    ...genBase,
                    jid: remoteJid,
                    getUrlInfo: opts.getUrlInfo,
                    ...opts.generateOptions
                });
            }
        }

        if (!fullMsg?.message) throw createError(Err.INVALID_MESSAGE, 'Empty message');

        const msg = fullMsg.message;
        if (fullMsg.key) fullMsg.key.id = fullMsg.key.id || messageId;

        if (msg.eventMessage?.startTime != null) {
            msg.eventMessage.startTime = Math.floor(Number(msg.eventMessage.startTime));
        }
        if (msg.eventMessage?.endTime != null) {
            msg.eventMessage.endTime = Math.floor(Number(msg.eventMessage.endTime));
        }

        annotateMedia(msg, config, caps?.proto);

        const ctxOpts = {
            mentions: opts.mentions,
            mentionAll: opts.mentionAll,
            contextInfo: opts.contextInfo,
            externalAdReply: opts.externalAdReply,
            groupStatus: opts.groupStatus,
            spoiler: opts.spoiler
        };
        if (Object.values(ctxOpts).some((v) => v != null && v !== false)) {
            fullMsg.message = applyContextInfo(fullMsg.message, ctxOpts);
        }

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

        // metaLabel true → biz on EVERY message; also interactive/product/buttons always
        const addBiz =
            metaOn ||
            !!opts.addBizAttributes ||
            !!msg.interactiveMessage ||
            !!msg.buttonsMessage ||
            !!msg.listMessage ||
            !!msg.templateMessage ||
            !!msg.productMessage;

        if (!hasBiz && addBiz) {
            try {
                additionalNodes.push(getBizBinaryNode(msg));
            } catch {
                additionalNodes.push(getBizBinaryNode({}));
            }
        }

        await caps.relayMessage(remoteJid, fullMsg.message, {
            messageId: fullMsg.key?.id || messageId,
            useCachedGroupMetadata: opts.useCachedGroupMetadata,
            addBizAttributes: addBiz,
            statusJidList: opts.statusJidList,
            additionalAttributes,
            additionalNodes,
            participant: opts.participant
        });

        return fullMsg;
    }

    const nextId = (opts = {}) =>
        opts.messageId ||
        generateMessageId({ meId: ctx.meId, customId: config.customId, stealth: config.stealth });
    const genOptsFor = (quoted, opts = {}) => ({
        logger: opts.logger,
        userJid: ctx.meId,
        messageId: nextId(opts),
        quoted: quoted ?? opts.quoted,
        upload: sock.waUploadToServer,
        mediaCache: opts.mediaCache
    });

    /**
     * Cards → interactiveMessage.carouselMessage (messages.md cards)
     */

    /** Interactive / nativeFlow — supports image, video, document, product, location header + contextInfo. */

    /**
     * Product (messages.md product → productMessage; + buttons → interactive header)
     * productImage via image:; payload preserved, no long remap.
     */
    /** Product message — maps flat title/productId/currencyCode/priceAmount1000/… */

    /**
     * Order (messages.md order → orderMessage)
     * sock.sendOrder(remoteJid, order, quoted?)
     */

    /**
     * Contact / business vCard
     */

    /**
     * Event — messages.md { event } + meta event_type
     */

    /**
     * Poll — messages.md { poll } + meta polltype
     */

    /**
     * Poll result — messages.md { pollResult }
     */

    /**
     * Location — messages.md { location } → locationMessage
     * sock.sendLocation(remoteJid, { degreesLatitude, degreesLongitude, name?, address? }, quoted?)
     */

    /** Classic buttonsMessage — messages.md `{ buttons }` path. */

    /** List message — messages.md `{ sections }` → listMessage (listType SINGLE_SELECT). */

    /**
     * Product list — messages.md { productList } → listMessage (PRODUCT_LIST).
     * sock.sendProductList(remoteJid, { title, businessOwnerJid, productList: [...], thumbnail? }, quoted?)
     */

    /**
     * Poll vote (encrypted) — messages.md { pollUpdate } → pollUpdateMessage.
     * sock.sendPollUpdate(remoteJid, { key, vote, metadata? })
     */

    /** Group status — sends a normal content payload flagged as a group status update */

    /** Generic content router — mirrors messages.md sock.sendMessage(jid, content, options). */
    /**
     * Generic content router — mirrors messages.md generateWAMessageContent if/else chain.
     * sock.sendMessage(jid, content, options) style entry.
     */

    const api = {
        sendText: async (remoteJid, text, quoted = null, options = {}) => {
            const opts = options || {};
            if (text && typeof text === 'object') {
                return api.send(remoteJid, text, quoted, opts);
            }
            return genRelay(remoteJid, { text, ...contentFlags(opts) }, quoted, {
                ...opts,
                mentions: opts.mentions,
                mentionAll: opts.mentionAll,
                contextInfo: opts.contextInfo,
                externalAdReply: opts.externalAdReply,
                ai: opts.ai,
                messageId: opts.messageId,
                secureMetaServiceLabel: opts.secureMetaServiceLabel
            });
        },

        reply: async (remoteJid, text, quoted = null, options = {}) => {
            return api.sendText(remoteJid, text, quoted, options);
        },

        sendReact: async (remoteJid, emoji, key, options = {}) => {
            const opts = options || {};
            return genRelay(
                remoteJid,
                { react: { text: emoji == null ? '' : String(emoji), key } },
                null,
                { ...opts, messageId: opts.messageId }
            );
        },

        sendImage: async (remoteJid, image, caption, quoted = null, options = {}) => {
            return sendMedia('image', remoteJid, image, caption, quoted, options);
        },

        sendVideo: async (remoteJid, video, caption, quoted = null, options = {}) => {
            return sendMedia('video', remoteJid, video, caption, quoted, options);
        },

        sendAudio: async (remoteJid, audio, quoted = null, options = {}) => {
            return sendMedia('audio', remoteJid, audio, undefined, quoted, options);
        },

        sendFile: async (remoteJid, file, quoted = null, options = {}) => {
            return sendMedia('document', remoteJid, file, options?.caption, quoted, options);
        },

        sendSticker: async (remoteJid, sticker, quoted = null, options = {}) => {
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
                return genRelay(
                    remoteJid,
                    { sticker: source, ...contentFlags(opts) },
                    quoted,
                    { ...opts, messageId: opts.messageId }
                );
            }

            const prepared = await prepareStickerBuffer(buffer, opts);
            const content = { sticker: prepared.buffer, ...contentFlags(opts) };
            if (prepared.isAiSticker || opts.looked || opts.isAiSticker) content.isAiSticker = true;
            if (prepared.isAvatar || opts.looked || opts.isAvatar) content.isAvatar = true;
            if (prepared.premium != null) content.premium = prepared.premium;
            else if (opts.premium != null) content.premium = opts.premium === true ? 1 : opts.premium;
            if (opts.isLottie) content.isLottie = true;

            return genRelay(remoteJid, content, quoted, { ...opts, messageId: opts.messageId });
        },

        sendStickerPack: async (remoteJid, pack, quoted = null, options = {}) => {
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
                    { userJid: ctx.meId, messageId, quoted: quoted }
                );

                return await genRelay(remoteJid, fullMsg, opts);
            } catch (err) {
                throw createError(Err.INVALID_MEDIA, err?.message || String(err));
            }
        },

        sendAlbum: async (remoteJid, items, quoted = null, options = {}) => {
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

            const parent = await genRelay(remoteJid, { album }, quoted, {
                ...opts,
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

                await genRelay(remoteJid, childMsg, opts);
            }

            return parent;
        },

        sendLivePhoto: async (remoteJid, video, quoted = null, options = {}) => {
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
                { userJid: ctx.meId, messageId, quoted: quoted }
            );

            await genRelay(remoteJid, parent, opts);

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
            await genRelay(remoteJid, videoPayload, opts);

            return parent;
        },

        sendCard: async (remoteJid, pack, quoted = null, options = {}) => {
            const opts = options || {};
            if (!pack?.cards?.length) {
                throw createError(Err.INVALID_MESSAGE, 'cards required');
            }

            const messageId = nextId(opts);
            const genOpts = {
                logger: opts.logger,
                userJid: ctx.meId,
                messageId,
                quoted: quoted,
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
                    return await genRelay(remoteJid, fullMsg, opts);
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
                return await genRelay(remoteJid, content, quoted, opts);
            } catch (err) {
                throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
            }
        },

        sendInteractive: async (remoteJid, payload, quoted = null, options = {}) => {
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
                quoted: quoted,
                upload: sock.waUploadToServer,
                mediaCache: opts.mediaCache
            };

            try {
                const fullMsg = await caps.generateWAMessage(remoteJid, payload, genOpts);
                if (fullMsg?.message?.interactiveMessage) {
                    if (opts.mentions || opts.mentionAll || opts.contextInfo || opts.externalAdReply) {
                        fullMsg.message = applyContextInfo(fullMsg.message, opts);
                    }
                    return await genRelay(remoteJid, fullMsg, opts);
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
                return await genRelay(remoteJid, built, quoted, opts);
            } catch (err) {
                throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
            }
        },

        sendProduct: async (remoteJid, payload, quoted = null, options = {}) => {
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

            // genWAMessageContent builds productMessage / interactive; genRelay sends
            return genRelay(remoteJid, payload, quoted, opts);
        },

        sendOrder: async (remoteJid, order, quoted = null, options = {}) => {
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
                quoted: quoted
            };

            try {
                const fullMsg = await caps.generateWAMessage(remoteJid, { order: orderContent }, genOpts);
                if (fullMsg?.message?.orderMessage) {
                    return await genRelay(remoteJid, fullMsg, opts);
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

            return await genRelay(remoteJid, { orderMessage }, quoted, opts);
        },

        sendContact: async (remoteJid, contactOrList, quoted = null, options = {}) => {
            const opts = options || {};
            if (contactOrList == null) {
                throw createError(Err.INVALID_MESSAGE, 'Contact payload is required');
            }
            try {
                return await genRelay(remoteJid, buildContactMessage(contactOrList), quoted, opts);
            } catch (err) {
                throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
            }
        },

        sendEvent: async (remoteJid, event, quoted = null, options = {}) => {
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
                quoted: quoted,
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

            return genRelay(remoteJid, fullMsg, opts);
        },

        sendPoll: async (remoteJid, values, pollOptions = {}, quoted = null, options = {}) => {
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
                quoted: quoted
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

            return genRelay(remoteJid, fullMsg, {
                ...opts,
                polltype: isQuiz ? 'quiz_creation' : 'creation'
            });
        },

        sendPollResult: async (remoteJid, name, votes, quoted = null, options = {}) => {
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
                quoted: quoted
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

            return genRelay(remoteJid, fullMsg, { ...opts, polltype: 'creation' });
        },

        sendLocation: async (remoteJid, location, quoted = null, options = {}) => {
            const opts = options || {};
            if (!location || typeof location !== 'object') {
                throw createError(Err.INVALID_MESSAGE, 'Location payload is required');
            }
            if (typeof location.degreesLatitude !== 'number' || typeof location.degreesLongitude !== 'number') {
                throw createError(Err.INVALID_MESSAGE, 'degreesLatitude and degreesLongitude are required numbers');
            }

            try {
                return await genRelay(remoteJid, { location }, quoted, {
                    ...opts,
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
            return await genRelay(remoteJid, { locationMessage }, quoted, opts);
        },

        sendButtons: async (remoteJid, payload, quoted = null, options = {}) => {
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
                    return await genRelay(remoteJid, fullMsg, opts);
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

            return await genRelay(remoteJid, { buttonsMessage }, quoted, opts);
        },

        sendSections: async (remoteJid, payload, quoted = null, options = {}) => {
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
                    return await genRelay(remoteJid, fullMsg, opts);
                }
            } catch {
                /* fallback */
            }

            try {
                const content = buildSectionsMessage(payload);
                return await genRelay(remoteJid, content, quoted, opts);
            } catch (err) {
                throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
            }
        },

        sendProductList: async (remoteJid, payload, quoted = null, options = {}) => {
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
                quoted: quoted,
                upload: sock.waUploadToServer,
                mediaCache: opts.mediaCache
            };

            try {
                const fullMsg = await caps.generateWAMessage(remoteJid, { productList: payload.productList, ...payload }, genOpts);
                if (fullMsg?.message?.listMessage) {
                    return await genRelay(remoteJid, fullMsg, opts);
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
                return await genRelay(remoteJid, content, quoted, opts);
            } catch (err) {
                throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
            }
        },

        sendPollUpdate: async (remoteJid, pollUpdate, options = {}) => {
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
                    return await genRelay(remoteJid, fullMsg, { ...opts, polltype: 'vote' });
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
            return await genRelay(remoteJid, content, null, { ...opts, polltype: 'vote' });
        },

        sendGroupStatus: async (remoteJid, content, options = {}, quoted = null) => {
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
                return await genRelay(remoteJid, { ...content, groupStatus: true }, quoted, pipelineOpts);
            } catch {
                /* engine may not recognize the "groupStatus" content flag — retry without it,
                   the group-status semantics are already carried by additionalNodes/relayOpts */
            }

            return await genRelay(remoteJid, content, quoted, pipelineOpts);
        },

        send: async (remoteJid, content, quoted = null, options = {}) => {
            const opts = options || {};

            if (typeof content === 'string') {
                return api.sendText(remoteJid, content, quoted, opts);
            }
            if (!content || typeof content !== 'object') {
                throw createError(Err.INVALID_MESSAGE, 'content must be a string or a payload object');
            }

            if (hasNonNullishProperty(content, 'react')) {
                const react = content.react;
                return api.sendReact(remoteJid, react?.text ?? react, react?.key ?? opts.key, opts);
            } else if (hasNonNullishProperty(content, 'sticker')) {
                return api.sendSticker(remoteJid, content.sticker, quoted, opts);
            } else if (hasNonNullishProperty(content, 'stickers')) {
                return api.sendStickerPack(remoteJid, content.stickers, quoted, opts);
            } else if (hasNonNullishProperty(content, 'album')) {
                return api.sendAlbum(remoteJid, content.album, quoted, opts);
            } else if (hasOptionalProperty(content, 'ptv') && content.ptv) {
                return api.sendLivePhoto(remoteJid, content.video, quoted, opts);
            } else if (hasNonNullishProperty(content, 'image')) {
                return api.sendImage(remoteJid, content.image, content.caption, quoted, opts);
            } else if (hasNonNullishProperty(content, 'video')) {
                return api.sendVideo(remoteJid, content.video, content.caption, quoted, opts);
            } else if (hasNonNullishProperty(content, 'audio')) {
                return api.sendAudio(remoteJid, content.audio, quoted, { ...opts, caption: content.caption });
            } else if (hasNonNullishProperty(content, 'document')) {
                return api.sendFile(remoteJid, content.document, quoted, { ...opts, caption: content.caption });
            } else if (hasNonNullishProperty(content, 'location')) {
                return api.sendLocation(remoteJid, content.location, quoted, opts);
            } else if (hasNonNullishProperty(content, 'contacts')) {
                return api.sendContact(remoteJid, content.contacts?.contacts ?? content.contacts, quoted, opts);
            } else if (hasNonNullishProperty(content, 'productList')) {
                return api.sendProductList(remoteJid, content, quoted, opts);
            } else if (hasNonNullishProperty(content, 'product')) {
                return api.sendProduct(remoteJid, content, quoted, opts);
            } else if (hasNonNullishProperty(content, 'cards')) {
                return api.sendCard(remoteJid, content, quoted, opts);
            } else if (
                hasNonNullishProperty(content, 'interactiveButtons') ||
                hasNonNullishProperty(content, 'nativeFlow') ||
                hasNonNullishProperty(content, 'nativeFlowMessage')
            ) {
                return api.sendInteractive(remoteJid, content, quoted, opts);
            } else if (hasNonNullishProperty(content, 'buttons')) {
                return api.sendButtons(remoteJid, content, quoted, opts);
            } else if (hasNonNullishProperty(content, 'sections')) {
                return api.sendSections(remoteJid, content, quoted, opts);
            } else if (hasNonNullishProperty(content, 'order')) {
                return api.sendOrder(remoteJid, content.order, quoted, opts);
            } else if (hasNonNullishProperty(content, 'event')) {
                return api.sendEvent(remoteJid, content.event, quoted, opts);
            } else if (hasNonNullishProperty(content, 'poll')) {
                return api.sendPoll(remoteJid, content.poll?.values, content.poll, quoted, opts);
            } else if (hasNonNullishProperty(content, 'pollUpdate')) {
                return api.sendPollUpdate(remoteJid, content.pollUpdate, opts);
            } else if (hasNonNullishProperty(content, 'pollResult')) {
                const pr = content.pollResult;
                return api.sendPollResult(remoteJid, pr?.name, pr?.votes, quoted, opts);
            } else if (hasOptionalProperty(content, 'groupStatus') && content.groupStatus) {
                const { groupStatus, ...rest } = content;
                return api.sendGroupStatus(remoteJid, rest, opts, quoted);
            }

            // fallback: text (messages.md default path)
            return api.sendText(remoteJid, content.text ?? content.caption ?? '', quoted, {
                ...opts,
                contextInfo: content.contextInfo ?? opts.contextInfo,
                mentions: content.mentions ?? opts.mentions,
                mentionAll: content.mentionAll ?? opts.mentionAll,
                externalAdReply: content.externalAdReply ?? opts.externalAdReply,
                ai: content.ai ?? opts.ai
            });
        }
    };
    return api;
}

