import { randomBytes } from 'crypto';
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
import { buildAdditionalNodes, pollMetaNode, eventCreationNode, getBizBinaryNode } from './node.js';


/* ── interactive / product builders (messages.md) ───────── */

function toButtons(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source;
    return Array.isArray(source.buttons) ? source.buttons : [];
}

function toParamsJson(payload = {}, source) {
    let v =
        (!Array.isArray(source) && source && (source.messageParamsJson || source.paramsJson)) ||
        payload.messageParamsJson ||
        payload.paramsJson ||
        '';
    if (v && typeof v === 'object') v = JSON.stringify(v);
    return v || '';
}

async function prepareMedia(input, caps, upload, opts = {}) {
    if (!input || typeof caps?.prepareWAMessageMedia !== 'function') return null;
    const prepared = await caps.prepareWAMessageMedia(input, {
        upload,
        logger: opts.logger,
        mediaCache: opts.mediaCache,
        options: opts.options
    });
    return prepared?.imageMessage || prepared?.videoMessage || prepared?.documentMessage ? prepared : null;
}

async function prepareHeaderMedia(media, caps, upload, opts) {
    const input = {};
    if (media.image != null) input.image = toMediaSource(media.image);
    else if (media.video != null) input.video = toMediaSource(media.video);
    else if (media.document != null) input.document = toMediaSource(media.document);
    else return null;
    return prepareMedia(input, caps, upload, opts);
}

async function buildProductMessage(payload, { caps, upload, opts = {}, config } = {}) {
    if (!payload?.businessOwnerJid) throw new globalThis.Error('businessOwnerJid is required');
    const image = payload.image ?? payload.product?.productImage;
    if (image == null) throw new globalThis.Error('product image is required');

    const prepared = await prepareMedia({ image: toMediaSource(image) }, caps, upload, opts);
    if (!prepared?.imageMessage) throw new globalThis.Error('failed to prepare product image');

    const product = {
        ...(payload.product || {}),
        productImage: prepared.imageMessage,
        productId: payload.productId ?? payload.product?.productId ?? '',
        title: payload.title ?? payload.product?.title ?? '',
        description: payload.description ?? payload.product?.description ?? '',
        currencyCode: payload.currencyCode ?? payload.product?.currencyCode ?? 'IDR',
        priceAmount1000: payload.priceAmount1000 ?? payload.product?.priceAmount1000,
        salePriceAmount1000: payload.salePriceAmount1000 ?? payload.product?.salePriceAmount1000,
        retailerId: payload.retailerId ?? payload.product?.retailerId,
        url: payload.url ?? payload.product?.url,
        productImageCount: payload.productImageCount ?? payload.product?.productImageCount ?? 1
    };
    for (const k of Object.keys(product)) if (product[k] === undefined) delete product[k];

    const content = {
        productMessage: {
            product,
            businessOwnerJid: payload.businessOwnerJid,
            body: payload.body,
            footer: payload.footer
        }
    };
    applyNewsletterMediaAnnotations(content, config, caps?.proto);
    return content;
}

async function buildInteractiveMessage(payload, { caps, upload, opts = {}, config } = {}) {
    const buttons = toButtons(
        payload.interactiveButtons || payload.buttons || payload.nativeFlow || payload.nativeFlowMessage
    );
    if (!buttons.length) throw new globalThis.Error('interactiveButtons required');

    const interactiveMessage = {
        nativeFlowMessage: {
            buttons,
            messageParamsJson: toParamsJson(payload, payload.interactiveButtons || payload.nativeFlowMessage)
        }
    };

    if (payload.bizJid) {
        interactiveMessage.collectionMessage = { bizJid: payload.bizJid, id: payload.id, messageVersion: 1 };
    } else if (payload.shopSurface) {
        interactiveMessage.shopStorefrontMessage = {
            surface: payload.shopSurface,
            id: payload.id,
            messageVersion: 1
        };
    }

    if (payload.text != null) interactiveMessage.body = { text: String(payload.text) };
    else if (payload.caption != null) interactiveMessage.body = { text: String(payload.caption) };

    if (payload.product || payload.productId || (payload.businessOwnerJid && payload.image)) {
        const { productMessage } = await buildProductMessage(payload, { caps, upload, opts });
        interactiveMessage.header = {
            title: payload.header?.title || payload.title || '',
            subtitle: payload.header?.subtitle || payload.subtitle || '',
            hasMediaAttachment: payload.hasMediaAttachment !== false,
            productMessage
        };
    } else {
        const headerMedia = await prepareHeaderMedia(payload, caps, upload, opts);
        const hasLocation = !!payload.location;
        if (headerMedia || hasLocation || payload.title != null || payload.header) {
            interactiveMessage.header = {
                title: payload.header?.title || payload.title || '',
                subtitle: payload.header?.subtitle || payload.subtitle || '',
                hasMediaAttachment: !!(headerMedia || hasLocation)
            };
            if (hasLocation) {
                const loc = payload.location;
                interactiveMessage.header.locationMessage = {
                    degreesLatitude: loc.degreesLatitude || 0,
                    degreesLongitude: loc.degreesLongitude || 0,
                    name: loc.name || '',
                    address: loc.address || '',
                    url: loc.url || '',
                    jpegThumbnail: loc.jpegThumbnail || loc.thumbnail
                };
            } else if (headerMedia) {
                Object.assign(interactiveMessage.header, headerMedia);
            }
        }
    }

    if (payload.thumbnail) interactiveMessage.jpegThumbnail = payload.thumbnail;
    if (payload.footer != null) interactiveMessage.footer = { text: String(payload.footer) };

    applyNewsletterMediaAnnotations(interactiveMessage, config, caps?.proto);
    return { interactiveMessage };
}

async function buildCarouselMessage(pack, { caps, upload, opts = {}, config } = {}) {
    const list = pack.cards || [];
    if (!list.length) throw new globalThis.Error('cards required');

    const cards = [];
    for (let i = 0; i < list.length; i++) {
        const card = list[i];
        if (!card || typeof card !== 'object') throw new globalThis.Error(`invalid card ${i}`);

        const headerMedia = await prepareHeaderMedia(card, caps, upload, opts);
        if (!headerMedia?.imageMessage && !headerMedia?.videoMessage && !card.product) {
            throw new globalThis.Error(`Card ${i} needs valid image or video`);
        }

        const carouselCard = {
            nativeFlowMessage: {
                buttons: toButtons(card.buttons || card.nativeFlow || card.interactiveButtons),
                messageParamsJson: toParamsJson(card, card.nativeFlow)
            }
        };

        if (card.text != null) {
            carouselCard.body = { text: String(card.text) };
        } else {
            carouselCard.header = {
                title: card.title || '',
                subtitle: card.subtitle || '',
                hasMediaAttachment: true,
                ...(headerMedia || {})
            };
            if (card.caption != null) carouselCard.body = { text: String(card.caption) };
            if (card.thumbnail) carouselCard.jpegThumbnail = card.thumbnail;
        }

        if (card.footer != null) carouselCard.footer = { text: String(card.footer) };
        cards.push(carouselCard);
    }

    const carouselCardType =
        caps?.proto?.Message?.InteractiveMessage?.CarouselMessage?.CarouselCardType?.UNKNOWN ?? 0;

    const interactiveMessage = {
        carouselMessage: { cards, carouselCardType, messageVersion: 1 }
    };
    if (pack.text != null) interactiveMessage.body = { text: String(pack.text) };
    if (pack.footer != null) interactiveMessage.footer = { text: String(pack.footer) };
    applyNewsletterMediaAnnotations(interactiveMessage, config, caps?.proto);
    return { interactiveMessage };
}

function buildVCard(contact = {}) {
    const number = String(contact.number || contact.phone || '').replace(/\D/g, '');
    const name = contact.name || contact.fullName || contact.displayName || '';
    const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${name};;;;`,
        `FN:${name}`
    ];
    if (contact.org) lines.push(`ORG:${contact.org}`);
    if (contact.title) lines.push(`TITLE:${contact.title}`);
    if (number) lines.push(`TEL;type=CELL;type=VOICE;waid=${number}:+${number}`);
    if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${contact.email}`);
    if (contact.website || contact.url) lines.push(`URL:${contact.website || contact.url}`);
    if (contact.location || contact.address) {
        lines.push(`ADR;TYPE=WORK:;;${contact.location || contact.address};;;`);
    }
    if (contact.other || contact.note) lines.push(`NOTE:${contact.other || contact.note}`);
    if (contact.biz_name || contact.bizName) {
        lines.push(`X-WA-BIZ-NAME:${contact.biz_name || contact.bizName}`);
    }
    if (contact.biz_description || contact.bizDescription) {
        lines.push(`X-WA-BIZ-DESCRIPTION:${contact.biz_description || contact.bizDescription}`);
    }
    lines.push('END:VCARD');
    return lines.join('\n');
}

/** Build contactMessage or contactsArrayMessage (messages.md contacts). */
function buildContactMessage(input) {
    const list = Array.isArray(input) ? input : [input];
    const contacts = list.map((c) => {
        if (typeof c === 'string') {
            return { displayName: c, vcard: buildVCard({ name: c }) };
        }
        if (!c || typeof c !== 'object') throw new globalThis.Error('invalid contact');
        const displayName = c.displayName || c.name || c.fullName || '';
        return { displayName, vcard: c.vcard || buildVCard(c) };
    });
    if (!contacts.length) throw new globalThis.Error('at least one contact required');
    if (contacts.length === 1) {
        return { contactMessage: contacts[0] };
    }
    return {
        contactsArrayMessage: {
            displayName: contacts[0].displayName || 'Contacts',
            contacts
        }
    };
}


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

/** Attach newsletter annotations onto image/video message fields in-place. */
function applyNewsletterMediaAnnotations(target, config, proto) {
    if (!config?.newsletterAnnotation || !target || typeof target !== 'object') return target;
    const annotations = createNewsletterAnnotations(config.newsletterAnnotation, proto);
    if (!annotations.length) return target;

    const apply = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.imageMessage) node.imageMessage = { ...node.imageMessage, annotations };
        if (node.videoMessage) node.videoMessage = { ...node.videoMessage, annotations };
        if (node.header) apply(node.header);
        if (Array.isArray(node.cards)) node.cards.forEach(apply);
        if (node.interactiveMessage) apply(node.interactiveMessage);
        if (node.productMessage?.product?.productImage) {
            node.productMessage = {
                ...node.productMessage,
                product: {
                    ...node.productMessage.product,
                    productImage: { ...node.productMessage.product.productImage, annotations }
                }
            };
        }
        // productMessage nested under header
        if (node.header?.productMessage?.product?.productImage) {
            apply({ productMessage: node.header.productMessage });
            node.header = {
                ...node.header,
                productMessage: {
                    ...node.header.productMessage,
                    product: {
                        ...node.header.productMessage.product,
                        productImage: {
                            ...node.header.productMessage.product.productImage,
                            annotations
                        }
                    }
                }
            };
        }
    };

    apply(target);
    return target;
}


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
        participant: opts.participant,
        event: opts.event,
        polltype: opts.polltype
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
            { userJid: ctx.meId, messageId, quoted: quoted || undefined }
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
     * Single relay for every helper (metaLabel + event/poll meta auto).
     */
    async function relay(remoteJid, fullMsg, opts = {}) {
        if (!fullMsg?.message) {
            throw createError(Err.INVALID_MESSAGE, 'Empty message');
        }

        const msg = fullMsg.message;
        if (msg.eventMessage) {
            if (msg.eventMessage.startTime != null) {
                msg.eventMessage.startTime = Math.floor(Number(msg.eventMessage.startTime));
            }
            if (msg.eventMessage.endTime != null) {
                msg.eventMessage.endTime = Math.floor(Number(msg.eventMessage.endTime));
            }
        }

        const messageId = fullMsg.key?.id || nextId(opts);
        if (fullMsg.key) fullMsg.key.id = messageId;

        const nodes = [...(opts.additionalNodes || [])];
        const isNewsletter = String(remoteJid).includes('@newsletter');
        const hasBiz = nodes.some((n) => n?.tag === 'biz');

        // event meta
        if (msg.eventMessage && !nodes.some((n) => n?.attrs?.event_type === 'creation')) {
            nodes.push({ tag: 'meta', attrs: { event_type: 'creation' }, content: undefined });
        }

        // poll meta
        const isPoll =
            msg.pollCreationMessage ||
            msg.pollCreationMessageV2 ||
            msg.pollCreationMessageV3 ||
            msg.pollCreationMessageV5 ||
            msg.pollCreationMessageV6 ||
            msg.pollUpdateMessage ||
            msg.pollResultSnapshotMessage ||
            msg.pollResultSnapshotMessageV3;
        if (isPoll && !nodes.some((n) => n?.attrs?.polltype)) {
            const isQuiz =
                !!msg.pollCreationMessageV5 ||
                msg.pollResultSnapshotMessageV3?.pollType === 1 ||
                opts.polltype === 'quiz_creation';
            const attrs = { polltype: isQuiz ? 'quiz_creation' : 'creation' };
            if (isNewsletter) attrs.contenttype = 'text';
            nodes.push({ tag: 'meta', attrs, content: undefined });
        }

        // interactive / carousel / product-with-buttons → biz node
        // carousel has no top-level nativeFlowMessage so Baileys skips getBizBinaryNode
        if (!hasBiz && msg.interactiveMessage) {
            try {
                nodes.push(getBizBinaryNode(msg));
            } catch {
                nodes.push({
                    tag: 'biz',
                    attrs: {
                        actual_actors: '2',
                        host_storage: '2',
                        privacy_mode_ts: String((Date.now() / 1000) | 0)
                    },
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                        }
                    ]
                });
            }
        }

        await caps.relayMessage(remoteJid, msg, {
            messageId,
            useCachedGroupMetadata: opts.useCachedGroupMetadata,
            addBizAttributes: useMetaLabel(opts, config) || !!opts.addBizAttributes,
            statusJidList: opts.statusJidList,
            additionalAttributes: opts.additionalAttributes || {},
            additionalNodes: nodes,
            participant: opts.participant
        });

        return fullMsg;
    }

    /** generateWAMessageFromContent + relay */
    async function sendContent(remoteJid, content, quoted, opts = {}) {
        const messageId = nextId(opts);
        const fullMsg = await caps.generateWAMessageFromContent(remoteJid, content, {
            userJid: ctx.meId,
            messageId,
            quoted: quoted || undefined
        });
        if (fullMsg?.message && (opts.mentions || opts.mentionAll || opts.contextInfo)) {
            fullMsg.message = applyContextInfo(fullMsg.message, opts);
        }
        return relay(remoteJid, fullMsg, opts);
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
            quoted: quoted || undefined,
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
     * Interactive + nativeFlow (messages.md interactiveButtons)
     */
    async function sendInteractive(remoteJid, payload, quoted = null, options = {}) {
        const opts = options || {};
        if (!payload || typeof payload !== 'object') {
            throw createError(Err.INVALID_MESSAGE, 'Interactive payload is required');
        }
        const buttons =
            payload.interactiveButtons || payload.buttons || payload.nativeFlow || payload.nativeFlowMessage;
        if (!buttons || (Array.isArray(buttons) && !buttons.length)) {
            throw createError(Err.INVALID_MESSAGE, 'interactiveButtons are required');
        }

        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: quoted || undefined,
            upload: sock.waUploadToServer,
            mediaCache: opts.mediaCache
        };

        // native messages.md content keys
        const content = {
            interactiveButtons: buttons,
            text: payload.text,
            caption: payload.caption,
            footer: payload.footer,
            title: payload.title,
            subtitle: payload.subtitle,
            image: payload.image,
            video: payload.video,
            location: payload.location,
            mentions: payload.mentions,
            mentionAll: payload.mentionAll,
            messageParamsJson: payload.messageParamsJson || payload.paramsJson,
            hasMediaAttachment: payload.hasMediaAttachment,
            product: payload.product,
            productId: payload.productId,
            businessOwnerJid: payload.businessOwnerJid,
            currencyCode: payload.currencyCode,
            priceAmount1000: payload.priceAmount1000
        };

        try {
            const fullMsg = await caps.generateWAMessage(remoteJid, content, genOpts);
            if (fullMsg?.message?.interactiveMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* builder fallback */
        }

        try {
            const built = await buildInteractiveMessage(
                { ...payload, interactiveButtons: buttons },
                { caps, upload: sock.waUploadToServer, opts, config }
            );
            if (payload.mentions) opts.mentions = payload.mentions;
            if (payload.mentionAll) opts.mentionAll = payload.mentionAll;
            return await sendContent(remoteJid, built, quoted, opts);
        } catch (err) {
            throw createError(Err.INVALID_MESSAGE, err?.message || String(err));
        }
    }

    /**
     * Product (messages.md product → productMessage; + buttons → interactive header)
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

        const messageId = nextId(opts);
        const genOpts = {
            logger: opts.logger,
            userJid: ctx.meId,
            messageId,
            quoted: quoted || undefined,
            upload: sock.waUploadToServer,
            mediaCache: opts.mediaCache
        };

        // with buttons → interactive product header
        if (buttons && (Array.isArray(buttons) ? buttons.length : true)) {
            try {
                const fullMsg = await caps.generateWAMessage(
                    remoteJid,
                    {
                        interactiveButtons: buttons,
                        image: payload.image,
                        caption: payload.caption || payload.text,
                        footer: payload.footer,
                        title: payload.title,
                        businessOwnerJid: payload.businessOwnerJid,
                        productId: payload.productId,
                        product: payload.product,
                        currencyCode: payload.currencyCode,
                        priceAmount1000: payload.priceAmount1000,
                        productImageCount: payload.productImageCount,
                        messageParamsJson: payload.messageParamsJson
                    },
                    genOpts
                );
                if (fullMsg?.message?.interactiveMessage) {
                    return await relay(remoteJid, fullMsg, opts);
                }
            } catch {
                /* builder */
            }

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

        // plain product
        try {
            const fullMsg = await caps.generateWAMessage(
                remoteJid,
                {
                    product: {
                        productImage: payload.image,
                        productId: payload.productId,
                        title: payload.title,
                        description: payload.description,
                        currencyCode: payload.currencyCode,
                        priceAmount1000: payload.priceAmount1000,
                        salePriceAmount1000: payload.salePriceAmount1000,
                        retailerId: payload.retailerId,
                        url: payload.url,
                        productImageCount: payload.productImageCount ?? 1,
                        ...(payload.product || {})
                    },
                    businessOwnerJid: payload.businessOwnerJid,
                    caption: payload.caption,
                    footer: payload.footer
                },
                genOpts
            );
            if (fullMsg?.message?.productMessage) {
                return await relay(remoteJid, fullMsg, opts);
            }
        } catch {
            /* builder */
        }

        try {
            const content = await buildProductMessage(payload, {
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
            quoted: quoted || undefined,
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
            quoted: quoted || undefined
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
            quoted: quoted || undefined
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
        sendProduct,
        sendContact,
        sendEvent,
        sendPoll,
        sendPollResult
    };
}

