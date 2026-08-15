'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAnnotationsToMessage = exports.extractQuotedContent = exports.buildMediaAnnotations = exports.buildQuoted = exports.buildContextInfo = exports.applyNewsletterAnnotation = exports.DEFAULT_POLYGON_VERTICES = void 0;

/** Default polygon vertices (elrayyxml/baileys-itsliaaa messages.md) */
exports.DEFAULT_POLYGON_VERTICES = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
];

/**
 * Build media annotations with polygonVertices + newsletter
 * @param {object|false|null} annotation
 * @returns {object[]|undefined}
 */
function buildMediaAnnotations(annotation) {
    if (!annotation || annotation === false)
        return undefined;
    var newsletter = {
        newsletterJid: annotation.newsletterJid || annotation.jid,
        newsletterName: annotation.newsletterName || annotation.name || '',
        contentType: annotation.contentType != null ? annotation.contentType : 1,
        accessibilityText: annotation.accessibilityText || annotation.newsletterName || annotation.name || ''
    };
    if (annotation.serverMessageId != null) {
        newsletter.serverMessageId = annotation.serverMessageId;
    }
    return [
        {
            polygonVertices: annotation.polygonVertices || exports.DEFAULT_POLYGON_VERTICES.slice(),
            newsletter: newsletter
        }
    ];
}
exports.buildMediaAnnotations = buildMediaAnnotations;

function applyNewsletterAnnotation(contextInfo, annotation) {
    if (!annotation || annotation === false)
        return contextInfo || {};
    var ctx = Object.assign({}, contextInfo || {});
    ctx.forwardedNewsletterMessageInfo = {
        newsletterJid: annotation.newsletterJid || annotation.jid,
        newsletterName: annotation.newsletterName || annotation.name || '',
        serverMessageId: annotation.serverMessageId != null
            ? annotation.serverMessageId
            : Math.floor(Math.random() * 999999),
        contentType: annotation.contentType != null ? annotation.contentType : 1
    };
    return ctx;
}
exports.applyNewsletterAnnotation = applyNewsletterAnnotation;

/**
 * Extract proto message content for quotedMessage (never return empty {}).
 * @param {object} quoted
 * @returns {object}
 */
function extractQuotedContent(quoted) {
    if (!quoted)
        return { conversation: '' };
    // full WAMessage
    if (quoted.message && typeof quoted.message === 'object') {
        var keys = Object.keys(quoted.message).filter(function (k) {
            return k !== 'messageContextInfo' && quoted.message[k] != null;
        });
        if (keys.length)
            return quoted.message;
    }
    // fakeObj (neoxr-style)
    if (quoted.fakeObj && quoted.fakeObj.message && typeof quoted.fakeObj.message === 'object') {
        return quoted.fakeObj.message;
    }
    // serialized shape with .msg + .type
    if (quoted.msg != null) {
        var t = quoted.type || quoted.mtype || 'conversation';
        if (t === 'conversation' && typeof quoted.msg === 'string') {
            return { conversation: quoted.msg };
        }
        if (typeof quoted.msg === 'object') {
            var o = {};
            o[t] = quoted.msg;
            return o;
        }
        return { conversation: String(quoted.msg) };
    }
    // body / text fallbacks
    if (quoted.body || quoted.text) {
        return { conversation: String(quoted.body || quoted.text) };
    }
    if (typeof quoted.conversation === 'string') {
        return { conversation: quoted.conversation };
    }
    // extendedTextMessage on root
    if (quoted.extendedTextMessage) {
        return { extendedTextMessage: quoted.extendedTextMessage };
    }
    // last resort — non-empty stub so WA does not get {}
    return { conversation: '' };
}
exports.extractQuotedContent = extractQuotedContent;

/**
 * Normalize quoted into { key, message } for generateWAMessage / contextInfo
 */
function buildQuoted(quoted) {
    if (!quoted)
        return null;
    var key = null;
    if (quoted.key && quoted.key.id) {
        key = {
            remoteJid: quoted.key.remoteJid,
            id: quoted.key.id,
            fromMe: !!quoted.key.fromMe,
            participant: quoted.key.participant || quoted.key.participantAlt || undefined
        };
        // prefer LID/PN alt when useful
        if (quoted.key.participantAlt)
            key.participant = quoted.key.participant || quoted.key.participantAlt;
    }
    else if (quoted.remoteJid && quoted.id) {
        key = {
            remoteJid: quoted.remoteJid,
            id: quoted.id,
            fromMe: !!quoted.fromMe,
            participant: quoted.participant || undefined
        };
    }
    else if (quoted.id && (quoted.chat || quoted.sender)) {
        key = {
            remoteJid: quoted.chat || quoted.key && quoted.key.remoteJid,
            id: quoted.id,
            fromMe: !!quoted.fromMe,
            participant: quoted.sender || quoted.participant || undefined
        };
    }
    if (!key || !key.id)
        return null;
    var message = extractQuotedContent(quoted);
    // ensure not empty object
    if (!message || !Object.keys(message).length) {
        message = { conversation: '' };
    }
    return { key: key, message: message };
}
exports.buildQuoted = buildQuoted;

/**
 * Build contextInfo for mentions / quoted / expiration
 */
function buildContextInfo(opts) {
    if (opts === void 0) { opts = {}; }
    var ctx = Object.assign({}, opts.extra || opts.contextInfo || {});
    if (opts.mentions && Array.isArray(opts.mentions) && opts.mentions.length) {
        ctx.mentionedJid = opts.mentions.slice();
    }
    if (opts.mentionedJid && Array.isArray(opts.mentionedJid)) {
        ctx.mentionedJid = opts.mentionedJid.slice();
    }
    if (opts.expiration != null) {
        ctx.expiration = opts.expiration;
    }
    var q = buildQuoted(opts.quoted);
    if (q && q.key) {
        ctx.stanzaId = q.key.id;
        ctx.participant = q.key.participant || q.key.remoteJid;
        ctx.quotedMessage = q.message && Object.keys(q.message).length
            ? q.message
            : { conversation: '' };
    }
    return ctx;
}
exports.buildContextInfo = buildContextInfo;


/**
 * Inject newsletter media annotations into any imageMessage / videoMessage
 * found in a WA message tree (top-level, interactive header, carousel cards, product, album items, etc.)
 * @param {object} message - proto message object (mutated)
 * @param {object|false|null} annotation
 * @returns {object} message
 */
function applyAnnotationsToMessage(message, annotation) {
    if (!message || !annotation || annotation === false)
        return message;
    var anns = buildMediaAnnotations(annotation);
    if (!anns)
        return message;

    function paint(node) {
        if (!node || typeof node !== 'object')
            return;
        if (node.imageMessage) {
            node.imageMessage.annotations = anns;
            node.imageMessage.contextInfo = applyNewsletterAnnotation(node.imageMessage.contextInfo || {}, annotation);
        }
        if (node.videoMessage) {
            node.videoMessage.annotations = anns;
            node.videoMessage.contextInfo = applyNewsletterAnnotation(node.videoMessage.contextInfo || {}, annotation);
        }
        // product image inside productMessage
        if (node.productMessage && node.productMessage.product && node.productMessage.product.productImage) {
            var pi = node.productMessage.product.productImage;
            pi.annotations = anns;
            pi.contextInfo = applyNewsletterAnnotation(pi.contextInfo || {}, annotation);
        }
        // interactive
        if (node.interactiveMessage) {
            var im = node.interactiveMessage;
            if (im.header) {
                paint(im.header);
                // header may embed imageMessage/videoMessage/productMessage directly
                if (im.header.imageMessage) {
                    im.header.imageMessage.annotations = anns;
                    im.header.imageMessage.contextInfo = applyNewsletterAnnotation(im.header.imageMessage.contextInfo || {}, annotation);
                }
                if (im.header.videoMessage) {
                    im.header.videoMessage.annotations = anns;
                    im.header.videoMessage.contextInfo = applyNewsletterAnnotation(im.header.videoMessage.contextInfo || {}, annotation);
                }
                if (im.header.productMessage) {
                    paint(im.header);
                }
            }
            if (im.carouselMessage && Array.isArray(im.carouselMessage.cards)) {
                for (var i = 0; i < im.carouselMessage.cards.length; i++) {
                    paint(im.carouselMessage.cards[i]);
                    if (im.carouselMessage.cards[i].header) {
                        paint(im.carouselMessage.cards[i].header);
                    }
                }
            }
        }
        // viewOnce wrappers
        if (node.viewOnceMessage && node.viewOnceMessage.message) {
            paint(node.viewOnceMessage.message);
        }
        if (node.viewOnceMessageV2 && node.viewOnceMessageV2.message) {
            paint(node.viewOnceMessageV2.message);
        }
        if (node.ephemeralMessage && node.ephemeralMessage.message) {
            paint(node.ephemeralMessage.message);
        }
        if (node.documentWithCaptionMessage && node.documentWithCaptionMessage.message) {
            paint(node.documentWithCaptionMessage.message);
        }
    }

    paint(message);
    return message;
}
exports.applyAnnotationsToMessage = applyAnnotationsToMessage;
