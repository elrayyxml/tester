/**
 * Message payload helpers, processors, and relay pipeline.
 * Structure aligned with Baileys messages.md (generateWAMessageContent-style builders).
 */

import { Error as Err, createError } from '../constant/index.js';
import {
    toMediaSource,
    resolveMediaBuffer,
    generateMessageId,
    isBotMessageId,
    extractMessageId,
    hasNonNullishProperty,
    hasOptionalProperty,
    hasValidAlbumMedia,
    hasValidInteractiveHeader,
    hasValidCarouselHeader
} from '../utils/function.js';
import { info } from '../utils/logs.js';
import { buildAdditionalNodes } from './node.js';


/* ── interactive / product builders (messages.md) ───────── */

/**
 * Normalize button list for nativeFlowMessage / interactiveButtons.
 * Keeps `{ name, buttonParamsJson }` (single_select, quick_reply, …) and classic shapes.
 * @param {*} source
 * @returns {object[]}
 */
function toButtons(source) {
    if (!source) return [];
    const raw = Array.isArray(source) ? source : Array.isArray(source.buttons) ? source.buttons : [];
    return raw.map((b) => {
        if (!b || typeof b !== 'object') return b;
        if (b.name) {
            return {
                name: b.name,
                buttonParamsJson:
                    typeof b.buttonParamsJson === 'object'
                        ? JSON.stringify(b.buttonParamsJson)
                        : b.buttonParamsJson ?? b.paramsJson ?? '{}'
            };
        }
        return b;
    });
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

/**
 * Native flow button helper for interactive messages — structure mirrors
 * messages.md prepareNativeFlowButtons 1:1 (reads `message.nativeFlow` only).
 * For the richer multi-source lookup (interactiveButtons/buttons/nativeFlowMessage)
 * used across this library's builders, see toButtons()/toParamsJson() above.
 */
function prepareNativeFlowButtons(message) {
    const buttons = message.nativeFlow;
    const correctedField = Array.isArray(buttons) ? buttons : (buttons?.buttons || []);
    let messageParamsJson = message.messageParamsJson || message.paramsJson || '';
    if (typeof messageParamsJson === 'object' && messageParamsJson !== null) {
        messageParamsJson = JSON.stringify(messageParamsJson);
    }
    return {
        buttons: correctedField,
        messageParamsJson
    };
}

/**
 * Baileys getStream does `'stream' in media` — raw strings throw TypeError.
 * Normalize to Buffer | { url } | { stream }.
 * @param {*} src
 * @returns {*}
 */
function asMediaInput(src) {
    if (src == null) return src;
    if (Buffer.isBuffer(src)) return src;
    if (src instanceof Uint8Array) return Buffer.from(src);
    if (typeof src === 'string') return { url: src };
    if (typeof src === 'object' && (src.url != null || src.stream != null)) return src;
    return toMediaSource(src);
}

/**
 * @param {object} input - e.g. `{ image: source }`
 * @param {object} caps
 * @param {Function} upload
 * @param {object} [opts]
 */
async function prepareMedia(input, caps, upload, opts = {}) {
    if (!input || typeof caps?.prepareWAMessageMedia !== 'function') return null;
    const resolved = { ...input };
    for (const key of ['image', 'video', 'audio', 'document', 'sticker']) {
        if (resolved[key] != null) resolved[key] = asMediaInput(resolved[key]);
    }
    const prepared = await caps.prepareWAMessageMedia(resolved, {
        upload,
        logger: opts.logger,
        mediaCache: opts.mediaCache,
        options: opts.options
    });
    if (
        prepared?.imageMessage ||
        prepared?.videoMessage ||
        prepared?.documentMessage ||
        prepared?.audioMessage
    ) {
        return prepared;
    }
    return null;
}

/**
 * @param {object} media
 * @param {object} caps
 * @param {Function} upload
 * @param {object} [opts]
 */
async function prepareHeaderMedia(media, caps, upload, opts) {
    const input = {};
    if (media.image != null) input.image = media.image;
    else if (media.video != null) input.video = media.video;
    else if (media.document != null) input.document = media.document;
    else return null;
    return prepareMedia(input, caps, upload, opts);
}

/**
 * messages.md prepareProductMessage — productImage via `image:`.
 * Returns content assigned as `m.productMessage = await prepareProductMessage(...)`.
 * @param {object} message
 * @param {{ caps?: object, upload?: Function, opts?: object }} [ctx]
 */
async function prepareProductMessage(message, { caps, upload, opts = {} } = {}) {
    if (!message?.businessOwnerJid) {
        throw createError(Err.INVALID_MESSAGE, '"businessOwnerJid" is missing from the content');
    }
    if (typeof caps?.prepareWAMessageMedia !== 'function') {
        throw createError(Err.INVALID_ENGINE, 'prepareWAMessageMedia unavailable');
    }

    const { imageMessage } = await caps.prepareWAMessageMedia(
        { image: asMediaInput(message.image || message.product?.productImage) },
        { upload, logger: opts.logger, mediaCache: opts.mediaCache, options: opts.options }
    );
    if (!imageMessage) {
        throw createError(Err.INVALID_MEDIA, 'failed to prepare product image');
    }

    const { image, ...content } = message;
    content.product = {
        ...message.product,
        productImage: imageMessage
    };
    return content;
}

/** @deprecated alias */
const buildProductMessage = prepareProductMessage;

/**
 * Build interactiveMessage from interactiveButtons | nativeFlowMessage | nativeFlow.
 * Supports header media: image, video, document, product, location (thumbnail).
 * @param {object} message
 * @param {{ caps?: object, upload?: Function, opts?: object, config?: object }} [ctx]
 * @returns {Promise<{ interactiveMessage: object }>}
 */
async function buildInteractiveMessage(message, { caps, upload, opts = {}, config } = {}) {
    const source =
        message.interactiveButtons ||
        message.nativeFlowMessage ||
        message.nativeFlow ||
        message.buttons;
    const isArray = Array.isArray(source);
    const buttonsField = isArray ? source : toButtons(source);
    if (!buttonsField.length) throw createError(Err.INVALID_MESSAGE, 'interactiveButtons required');

    let paramsJson = isArray
        ? (message.messageParamsJson || message.paramsJson || '')
        : (source?.messageParamsJson || message.messageParamsJson || message.paramsJson || '');
    if (typeof paramsJson === 'object' && paramsJson !== null) paramsJson = JSON.stringify(paramsJson);

    const interactiveMessage = {
        nativeFlowMessage: { buttons: buttonsField, messageParamsJson: paramsJson || '' }
    };

    if (hasOptionalProperty(message, 'bizJid')) {
        interactiveMessage.collectionMessage = {
            bizJid: message.bizJid,
            id: message.id,
            messageVersion: 1
        };
    } else if (hasOptionalProperty(message, 'shopSurface')) {
        interactiveMessage.shopStorefrontMessage = {
            surface: message.shopSurface,
            id: message.id,
            messageVersion: 1
        };
    }

    if (hasOptionalProperty(message, 'text')) interactiveMessage.body = { text: message.text };
    else if (hasOptionalProperty(message, 'caption')) interactiveMessage.body = { text: message.caption };

    const headerSrc = hasOptionalProperty(message, 'header') ? message.header : null;
    const locationSrc =
        (hasOptionalProperty(message, 'location') && message.location) || headerSrc?.location || null;
    const wantsProduct =
        message.product || message.productId || (message.businessOwnerJid && message.image);

    let headerMedia = null;
    if (wantsProduct) {
        // messages.md: m.productMessage = await prepareProductMessage(...)
        headerMedia = {
            productMessage: await prepareProductMessage(message, { caps, upload, opts })
        };
    } else if (!locationSrc) {
        headerMedia = await prepareHeaderMedia(message, caps, upload, opts);
    }

    const hasValidMedia = hasValidInteractiveHeader(headerMedia || {});
    const hasLocationProp = !!locationSrc;
    const hasTitle = hasOptionalProperty(message, 'title') || !!headerSrc?.title;

    if (hasValidMedia || hasLocationProp || hasTitle || headerSrc) {
        interactiveMessage.header = {
            title: headerSrc?.title || message.title || '',
            subtitle: headerSrc?.subtitle || message.subtitle || '',
            hasMediaAttachment: headerSrc?.hasMediaAttachment ?? !!(hasValidMedia || hasLocationProp)
        };

        if (hasLocationProp) {
            let jpegThumbnail = locationSrc.jpegThumbnail || locationSrc.thumbnail;
            if (jpegThumbnail && !Buffer.isBuffer(jpegThumbnail)) {
                try {
                    if (typeof jpegThumbnail === 'string' && !/^https?:/i.test(jpegThumbnail)) {
                        const { promises: fsp } = await import('fs');
                        jpegThumbnail = await fsp.readFile(jpegThumbnail);
                    } else if (typeof jpegThumbnail === 'string') {
                        jpegThumbnail = Buffer.from(await (await fetch(jpegThumbnail)).arrayBuffer());
                    } else if (jpegThumbnail?.url) {
                        const src = String(jpegThumbnail.url);
                        jpegThumbnail = /^https?:/i.test(src)
                            ? Buffer.from(await (await fetch(src)).arrayBuffer())
                            : await (await import('fs')).promises.readFile(src);
                    }
                } catch {
                    jpegThumbnail = undefined;
                }
            }
            if (Buffer.isBuffer(jpegThumbnail)) {
                try {
                    const sharp = (await import('sharp')).default;
                    jpegThumbnail = await sharp(jpegThumbnail).resize(300, 300, { fit: 'cover' }).jpeg().toBuffer();
                } catch {
                    /* keep original buffer */
                }
            }
            interactiveMessage.header.locationMessage = {
                degreesLatitude: locationSrc.degreesLatitude || 0,
                degreesLongitude: locationSrc.degreesLongitude || 0,
                name: locationSrc.name || '',
                address: locationSrc.address || '',
                url: locationSrc.url || '',
                jpegThumbnail
            };
        } else if (hasValidMedia && headerMedia) {
            Object.assign(interactiveMessage.header, headerMedia);
        }
    }

    if (hasOptionalProperty(message, 'thumbnail') && message.thumbnail) {
        interactiveMessage.jpegThumbnail = message.thumbnail;
    }

    if (hasOptionalProperty(message, 'audioFooter')) {
        const prepared = await prepareMedia({ audio: toMediaSource(message.audioFooter) }, caps, upload, opts);
        if (prepared?.audioMessage) {
            interactiveMessage.footer = { audioMessage: prepared.audioMessage, hasMediaAttachment: true };
        }
    } else if (hasOptionalProperty(message, 'footer')) {
        interactiveMessage.footer = { text: message.footer };
    }

    annotateMedia(interactiveMessage, config, caps?.proto);
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
        if (!hasValidCarouselHeader({ ...(headerMedia || {}), productMessage: card.product })) {
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
    annotateMedia(interactiveMessage, config, caps?.proto);
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


/** Build listMessage from sections (messages.md { sections }). */
function buildSectionsMessage(payload) {
    if (!Array.isArray(payload.sections) || !payload.sections.length) {
        throw new globalThis.Error('sections must be a non-empty array');
    }
    return {
        listMessage: {
            sections: payload.sections,
            buttonText: payload.buttonText,
            title: payload.title,
            footerText: payload.footer,
            description: payload.text,
            listType: 1 // SINGLE_SELECT
        }
    };
}

/** Build listMessage PRODUCT_LIST (messages.md { productList }). */
async function buildProductListMessage(payload, { caps, upload, opts = {} } = {}) {
    if (!Array.isArray(payload.productList) || !payload.productList.length) {
        throw new globalThis.Error('productList must be a non-empty array');
    }
    if (!payload.businessOwnerJid) {
        throw new globalThis.Error('businessOwnerJid is required for productList');
    }
    const firstProduct = payload.productList[0]?.products?.[0];
    if (!firstProduct?.productId) {
        throw new globalThis.Error('first product must have a valid productId');
    }

    let jpegThumbnail;
    if (payload.thumbnail) {
        const prepared = await prepareMedia({ image: toMediaSource(payload.thumbnail) }, caps, upload, opts);
        jpegThumbnail = prepared?.imageMessage?.jpegThumbnail;
    }

    return {
        listMessage: {
            title: payload.title,
            buttonText: payload.buttonText,
            footerText: payload.footer,
            description: payload.text,
            productListInfo: {
                productSections: payload.productList,
                headerImage: { productId: firstProduct.productId, jpegThumbnail },
                businessOwnerJid: payload.businessOwnerJid
            },
            listType: 3 // PRODUCT_LIST
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

/**
 * Inject newsletter annotations onto image/video/product media nodes (in-place).
 * @param {object} target
 * @param {object} config
 * @param {object} [proto]
 */
function annotateMedia(target, config, proto) {
    if (!config?.newsletterAnnotation || !target || typeof target !== 'object') return target;
    const annotations = createNewsletterAnnotations(config.newsletterAnnotation, proto);
    if (!annotations.length) return target;

    const stamp = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.imageMessage) Object.assign(node.imageMessage, { annotations });
        if (node.videoMessage) Object.assign(node.videoMessage, { annotations });
        if (node.productMessage?.product?.productImage) {
            Object.assign(node.productMessage.product.productImage, { annotations });
        }
        if (node.header) stamp(node.header);
        if (node.interactiveMessage) stamp(node.interactiveMessage);
        if (Array.isArray(node.cards)) node.cards.forEach(stamp);
    };

    stamp(target);
    return target;
}

/** @deprecated use annotateMedia */
const applyNewsletterMediaAnnotations = annotateMedia;


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
    const addBiz = meta || !!opts.addBizAttributes;
    return {
        messageId: opts.messageId,
        useCachedGroupMetadata: opts.useCachedGroupMetadata,
        addBizAttributes: addBiz,
        statusJidList: opts.statusJidList,
        additionalAttributes: opts.additionalAttributes || {},
        additionalNodes: buildAdditionalNodes({
            ...opts,
            message,
            addBizAttributes: addBiz,
            forceBiz: addBiz,
            additionalNodes: opts.additionalNodes
        }),
        participant: opts.participant,
        event: opts.event,
        polltype: opts.polltype
    };
}

/**
 * Normalize quoted for Baileys (messages.md `options.quoted`).
 * Supports real WAMessage and fake/custom quotes (ftoko, fkon, status@broadcast, …).
 * `fromMe` is boolean (keeps false); missing `id` gets a synthetic id so stanzaId is valid.
 * @param {*} quoted
 * @returns {object|undefined}
 */
export function normalizeQuoted(quoted) {
    if (!quoted || typeof quoted !== 'object') return undefined;

    let msg = quoted;
    if (!msg.key && msg.message?.key) msg = msg.message;
    else if (!msg.key && msg.msg?.key) msg = msg.msg;

    const key = msg.key;
    if (!key || typeof key !== 'object') return undefined;
    // need at least remoteJid or participant for a usable quote
    if (key.remoteJid == null && key.participant == null && key.id == null) return undefined;

    const id =
        key.id != null
            ? String(key.id)
            : '3EB0' + Date.now().toString(16).toUpperCase().slice(-8);

    return {
        key: {
            remoteJid: key.remoteJid || 'status@broadcast',
            fromMe: key.fromMe === true,
            id,
            participant: key.participant,
            addressingMode: key.addressingMode
        },
        message: msg.message,
        participant: msg.participant || key.participant,
        messageTimestamp: msg.messageTimestamp,
        pushName: msg.pushName
    };
}

/**
 * Central generate + annotate + relay pipeline.
 * @param {object} ctx
 * @param {string} jid
 * @param {object} content
 * @param {object} [options]
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

    const meta = useMetaLabel(opts, config);
    let payload = content;
    if (meta && payload && typeof payload === 'object') {
        payload = { ...payload, secureMetaServiceLabel: true };
    }

    // messages-send.md: quoted from options.quoted (normalized for fake quotes / missing id)
    const quoted = normalizeQuoted(opts.quoted);

    const fullMsg = opts.prebuiltMessage
        ? opts.prebuiltMessage
        : await caps.generateWAMessage(jid, payload, {
              logger: opts.logger,
              userJid: meId,
              messageId,
              quoted,
              ephemeralExpiration: opts.ephemeralExpiration,
              upload: opts.upload || sock.waUploadToServer,
              mediaCache: opts.mediaCache,
              options: opts.httpOptions || opts.options,
              jid,
              getUrlInfo: opts.getUrlInfo,
              ...opts.generateOptions
          });

    if (fullMsg.key && messageId) fullMsg.key.id = fullMsg.key.id || messageId;

    if (fullMsg?.message) {
        annotateMedia(fullMsg.message, config, caps?.proto);
        if (opts.contextInfo || opts.mentions || opts.mentionAll || opts.externalAdReply) {
            fullMsg.message = applyContextInfo(fullMsg.message, opts);
        }
    }

    await caps.relayMessage(jid, fullMsg.message, relayOpts({ config }, { ...opts, messageId }, fullMsg.message));

    info('Message relayed', fullMsg.key?.id || messageId);
    return fullMsg;
}

export const relayPipeline = relayMessagePipeline;

/* ── exports for messages-send + public API ───────── */
export {
    toButtons,
    toParamsJson,
    prepareNativeFlowButtons,
    prepareMedia,
    prepareHeaderMedia,
    prepareProductMessage,
    buildProductMessage,
    buildInteractiveMessage,
    buildCarouselMessage,
    buildVCard,
    buildContactMessage,
    buildSectionsMessage,
    buildProductListMessage,
    annotateMedia,
    applyNewsletterMediaAnnotations,
    contentFlags,
    useMetaLabel,
    relayOpts
};
