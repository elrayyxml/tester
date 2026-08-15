'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMediaAnnotations = exports.buildQuoted = exports.buildContextInfo = exports.applyNewsletterAnnotation = exports.DEFAULT_POLYGON_VERTICES = void 0;

/** Default polygon vertices (from elrayyxml/baileys-itsliaaa messages.md mediaAnnotation) */
exports.DEFAULT_POLYGON_VERTICES = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
];

/**
 * Build media annotations array with polygonVertices + newsletter
 * (matches messages.md mediaAnnotation structure)
 *
 * @param {object|false|null} annotation - {
 *   newsletterJid, newsletterName, contentType?, accessibilityText?,
 *   serverMessageId?, polygonVertices?
 * }
 * @returns {object[]|undefined}
 */
function buildMediaAnnotations(annotation) {
    if (!annotation || annotation === false)
        return undefined;
    var newsletter = {
        newsletterJid: annotation.newsletterJid || annotation.jid,
        newsletterName: annotation.newsletterName || annotation.name || '',
        contentType: annotation.contentType != null ? annotation.contentType : 1, // UPDATE
        accessibilityText: annotation.accessibilityText || annotation.newsletterName || ''
    };
    if (annotation.serverMessageId != null) {
        newsletter.serverMessageId = annotation.serverMessageId;
    }
    return [
        {
            polygonVertices: annotation.polygonVertices || exports.DEFAULT_POLYGON_VERTICES,
            newsletter: newsletter
        }
    ];
}
exports.buildMediaAnnotations = buildMediaAnnotations;

/**
 * Apply newsletter annotation to contextInfo (forwardedNewsletterMessageInfo).
 * Prefer buildMediaAnnotations for image/video message.annotations field.
 * @param {object} contextInfo
 * @param {object|false|null} annotation
 * @returns {object}
 */
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
 * Normalize quoted input into { key, message }
 */
function buildQuoted(quoted) {
    if (!quoted)
        return null;
    if (quoted.key && (quoted.message || quoted.msg)) {
        var message = quoted.message;
        if (!message && quoted.msg) {
            var t = quoted.type || quoted.mtype || 'conversation';
            message = {};
            message[t] = quoted.msg;
        }
        return { key: quoted.key, message: message };
    }
    if (quoted.remoteJid && quoted.id) {
        return { key: quoted, message: { conversation: '' } };
    }
    if (quoted.id && quoted.chat) {
        return {
            key: {
                remoteJid: quoted.chat,
                id: quoted.id,
                fromMe: !!quoted.fromMe,
                participant: quoted.sender
            },
            message: quoted.message || (quoted.msg ? (function () {
                var o = {};
                o[quoted.type || 'conversation'] = quoted.msg;
                return o;
            })() : { conversation: '' })
        };
    }
    return null;
}
exports.buildQuoted = buildQuoted;

/**
 * Build contextInfo for mentions / quoted / expiration / extra
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
        ctx.quotedMessage = q.message || { conversation: '' };
    }
    return ctx;
}
exports.buildContextInfo = buildContextInfo;
