/**
 * Interactive, carousel, and product message builders (messages.md shapes).
 */

import { toMediaSource } from './function.js';

function asButtons(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source;
    if (Array.isArray(source.buttons)) return source.buttons;
    return [];
}

function asParamsJson(payload = {}, source) {
    let params =
        (source && !Array.isArray(source) && (source.messageParamsJson || source.paramsJson)) ||
        payload.messageParamsJson ||
        payload.paramsJson ||
        '';
    if (params && typeof params === 'object') params = JSON.stringify(params);
    return params || '';
}

async function prepareMedia(input, caps, upload, opts = {}) {
    if (!input || typeof caps?.prepareWAMessageMedia !== 'function') return null;
    const prepared = await caps.prepareWAMessageMedia(input, {
        upload,
        logger: opts.logger,
        mediaCache: opts.mediaCache,
        options: opts.options
    });
    if (prepared?.imageMessage || prepared?.videoMessage || prepared?.documentMessage) return prepared;
    return null;
}

async function prepareHeader(media, caps, upload, opts = {}) {
    const input = {};
    if (media.image != null) input.image = toMediaSource(media.image);
    else if (media.video != null) input.video = toMediaSource(media.video);
    else if (media.document != null) input.document = toMediaSource(media.document);
    else return null;
    return prepareMedia(input, caps, upload, opts);
}

/**
 * Product body (messages.md prepareProductMessage).
 */
export async function buildProductMessage(payload, { caps, upload, opts = {} } = {}) {
    if (!payload?.businessOwnerJid) {
        throw new globalThis.Error('businessOwnerJid is required');
    }

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
        productImageCount: payload.productImageCount ?? payload.product?.productImageCount ?? 1,
        firstImageId: payload.firstImageId ?? payload.product?.firstImageId
    };

    // drop undefined fields
    for (const key of Object.keys(product)) {
        if (product[key] === undefined) delete product[key];
    }

    return {
        productMessage: {
            product,
            businessOwnerJid: payload.businessOwnerJid,
            body: payload.body,
            footer: payload.footer,
            firstImageId: payload.firstImageId
        }
    };
}

/**
 * interactiveButtons / nativeFlow → interactiveMessage
 */
export async function buildInteractiveMessage(payload, { caps, upload, opts = {} } = {}) {
    const buttons = asButtons(
        payload.interactiveButtons || payload.buttons || payload.nativeFlow || payload.nativeFlowMessage
    );
    if (!buttons.length) throw new globalThis.Error('interactiveButtons required');

    const interactiveMessage = {
        nativeFlowMessage: {
            buttons,
            messageParamsJson: asParamsJson(payload, payload.interactiveButtons || payload.nativeFlowMessage)
        }
    };

    if (payload.bizJid) {
        interactiveMessage.collectionMessage = {
            bizJid: payload.bizJid,
            id: payload.id,
            messageVersion: 1
        };
    } else if (payload.shopSurface) {
        interactiveMessage.shopStorefrontMessage = {
            surface: payload.shopSurface,
            id: payload.id,
            messageVersion: 1
        };
    }

    if (payload.text != null) interactiveMessage.body = { text: String(payload.text) };
    else if (payload.caption != null) interactiveMessage.body = { text: String(payload.caption) };

    // Product header
    if (payload.product || payload.productId || payload.businessOwnerJid) {
        const { productMessage } = await buildProductMessage(payload, { caps, upload, opts });
        interactiveMessage.header = {
            title: payload.header?.title || payload.title || '',
            subtitle: payload.header?.subtitle || payload.subtitle || '',
            hasMediaAttachment: payload.hasMediaAttachment !== false,
            productMessage
        };
    } else {
        const headerMedia = await prepareHeader(payload, caps, upload, opts);
        const hasLocation = !!payload.location;
        const hasTitle = payload.title != null || payload.header?.title != null;
        const hasHeaderSrc = !!payload.header;

        if (headerMedia || hasLocation || hasTitle || hasHeaderSrc) {
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

    if (payload.audioFooter && typeof caps?.prepareWAMessageMedia === 'function') {
        const { audioMessage } = await caps.prepareWAMessageMedia(
            { audio: toMediaSource(payload.audioFooter) },
            { upload, logger: opts.logger, mediaCache: opts.mediaCache }
        );
        interactiveMessage.footer = { audioMessage, hasMediaAttachment: true };
    } else if (payload.footer != null) {
        interactiveMessage.footer = { text: String(payload.footer) };
    }

    return { interactiveMessage };
}

/**
 * cards → interactiveMessage.carouselMessage
 */
export async function buildCarouselMessage(pack, { caps, upload, opts = {} } = {}) {
    const list = pack.cards || [];
    if (!list.length) throw new globalThis.Error('cards required');

    const cards = [];
    for (let i = 0; i < list.length; i++) {
        const card = list[i];
        if (!card || typeof card !== 'object') throw new globalThis.Error(`invalid card ${i}`);

        const headerMedia = await prepareHeader(card, caps, upload, opts);
        if (!headerMedia?.imageMessage && !headerMedia?.videoMessage && !card.product) {
            throw new globalThis.Error(`Card ${i} needs valid image or video`);
        }

        const buttons = asButtons(card.buttons || card.nativeFlow || card.interactiveButtons);
        const carouselCard = {
            nativeFlowMessage: {
                buttons,
                messageParamsJson: asParamsJson(card, card.nativeFlow)
            }
        };

        if (card.text != null) {
            carouselCard.body = { text: String(card.text) };
        } else {
            if (card.caption != null) {
                carouselCard.header = {
                    title: card.title || '',
                    subtitle: card.subtitle || '',
                    hasMediaAttachment: true
                };
                carouselCard.body = { text: String(card.caption) };
            }
            if (card.thumbnail) carouselCard.jpegThumbnail = card.thumbnail;
            if (headerMedia) {
                carouselCard.header = carouselCard.header || {
                    title: card.title || '',
                    subtitle: card.subtitle || '',
                    hasMediaAttachment: true
                };
                Object.assign(carouselCard.header, headerMedia);
            }
        }

        if (card.audioFooter && typeof caps?.prepareWAMessageMedia === 'function') {
            const { audioMessage } = await caps.prepareWAMessageMedia(
                { audio: toMediaSource(card.audioFooter) },
                { upload, logger: opts.logger, mediaCache: opts.mediaCache }
            );
            carouselCard.footer = { audioMessage, hasMediaAttachment: true };
        } else if (card.footer != null) {
            carouselCard.footer = { text: String(card.footer) };
        }

        cards.push(carouselCard);
    }

    const carouselCardType =
        caps?.proto?.Message?.InteractiveMessage?.CarouselMessage?.CarouselCardType?.UNKNOWN ?? 0;

    const interactiveMessage = {
        carouselMessage: {
            cards,
            carouselCardType,
            messageVersion: 1
        }
    };

    if (pack.text != null) interactiveMessage.body = { text: String(pack.text) };
    if (pack.footer != null) interactiveMessage.footer = { text: String(pack.footer) };

    return { interactiveMessage };
}
