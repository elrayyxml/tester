'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create(("function" === typeof Iterator ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachSendHelpers = void 0;

var context_1 = require("./context");
var functions_1 = require("../utils/functions");
var errors_1 = require("../constant/errors");
var airich_1 = require("./rich-message");
var nodes_1 = require("./nodes");
var hasNonNullishProperty = functions_1.hasNonNullishProperty;

/**
 * Resolve baileys module strictly from Client({ engines: [baileys] }) — no implicit
 * require('baileys') anywhere. The consumer owns which baileys build/fork is used and
 * must pass it explicitly, e.g.:
 *   const baileys = require('baileys')
 *   Client(sock, { engines: [baileys] })
 */
function getBaileys(sock) {
    var cfg = sock && sock.__nexray;
    var resolved = cfg && Array.isArray(cfg.engines) && cfg.engines[0];
    if (!resolved) {
        throw new errors_1.NexrayError(
            'No baileys engine configured. Pass it explicitly: Client(sock, { engines: [require("baileys")] })',
            errors_1.ErrorCodes.INVALID_OPTIONS
        );
    }
    // Unwrap common ESM/CJS interop shapes: some bundlers/loaders hand back
    // { default: { generateWAMessage, ... } } instead of the flat module —
    // if the top-level object is missing the functions we need but .default has them, use that.
    if (typeof resolved.generateWAMessage !== 'function' && resolved.default && typeof resolved.default.generateWAMessage === 'function') {
        resolved = resolved.default;
    }
    return resolved;
}

/**
 * Look up a function on the resolved baileys engine at call-time (never cached),
 * so a partially-shaped or lazily-populated engine object still works, and so a
 * missing function throws a precise, actionable error instead of a generic
 * "X is not a function" deep inside a send call.
 */
function baileysFn(sock, name) {
    var b = getBaileys(sock);
    var fn = b[name];
    if (typeof fn !== 'function') {
        throw new errors_1.NexrayError(
            'baileys.' + name + ' is not a function on the configured engine — ' +
            'check that Client(sock, { engines: [baileys] }) was given the real "baileys" module ' +
            '(the one exporting generateWAMessage, prepareWAMessageMedia, generateThumbnail, etc.), ' +
            'not a wrapper, a partial mock, or an unresolved ESM namespace object.',
            errors_1.ErrorCodes.NOT_IMPLEMENTED
        );
    }
    return fn;
}

/**
 * Generate message id, honoring `custom_id` (readable prefix) and `stealth`
 * (device-shaped id — makes the bot's own messages look like they came from
 * that device type, per Baileys' own getDevice() pattern-matching):
 *   ios     -> '3A' + 18 chars  (20 total)
 *   web     -> '3E' + 20 chars  (22 total)
 *   android -> 21 or 32 chars, no fixed prefix
 *   desktop / dekstop -> '3F' + 16 chars (18 total)
 */
function stealthId(mode) {
    var hex = function (n) { return require('crypto').randomBytes(Math.ceil(n / 2)).toString('hex').toUpperCase().slice(0, n); };
    switch (String(mode || '').toLowerCase()) {
        case 'ios': return '3A' + hex(18);
        case 'web': return '3E' + hex(20);
        case 'android': return hex(21);
        case 'desktop':
        case 'dekstop': return '3F' + hex(16);
        default: return null;
    }
}

function makeMsgId(sock) {
    var cfg = sock.__nexray || {};
    var stealthed = stealthId(cfg.stealth);
    if (stealthed) return stealthed;
    var prefix = cfg.custom_id || cfg.messageIdPrefix || '';
    var user = sock.user && (sock.user.id || sock.user.lid);
    if (prefix) {
        return (0, functions_1.generateMessageID)(prefix);
    }
    return (0, functions_1.generateMessageIDV2)(user);
}


/**
 * Normalize media input for baileys generateWAMessage / prepareWAMessageMedia.
 * Accepts: Buffer | path string | http(s) url | { url } | stream
 * Returns: Buffer | { url: string } | original stream shape
 * (matches messages-media getStream contract)
 */
function normalizeMediaInput(input) {
    if (input == null) return input;
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === 'object') {
        if (input.url != null) return { url: String(input.url) };
        if (input.stream) return input;
        // already a WAMediaUpload-like object
        return input;
    }
    if (typeof input === 'string') {
        // path or url — baileys getStream expects { url }
        return { url: input };
    }
    return input;
}

/**
 * Resolve quoted arg: allow positional m / key object, or opts.quoted
 */
function resolveQuoted(quoted, options) {
    if (quoted && (quoted.key || quoted.id || quoted.chat || quoted.remoteJid))
        return quoted;
    if (options && options.quoted)
        return options.quoted;
    // if 3rd arg was plain options object without message shape
    return null;
}

/**
 * Attach all stage-2 send helpers onto the socket (mutate in-place).
 * @param {import('baileys').WASocket} sock
 */
function attachSendHelpers(sock) {
    // Resolved once at attach time — this is a live object reference, so
    // baileys.generateThumbnail(...) etc. below always calls straight through to
    // whatever the engine currently has, with no local reimplementation and no
    // stale copies of individual functions.
    var baileys = getBaileys(sock);
    function generateWAMessage() {
        return baileysFn(sock, 'generateWAMessage').apply(null, arguments);
    }
    function generateWAMessageFromContent() {
        return baileysFn(sock, 'generateWAMessageFromContent').apply(null, arguments);
    }
    var proto = baileys.proto;

    /**
     * Core relay path — prefer relayMessage over sendMessage.
     * Automatically injects newsletter media annotations on any image/video
     * in the payload (sendImage, sendVideo, album items, carousel, interactive header, product, …).
     */
    function relay(jid, message, options) {
        return __awaiter(this, void 0, void 0, function () {
            var ann;
            return __generator(this, function (_a) {
                ann = (options && options.newsletterAnnotation)
                    || (sock.__nexray && sock.__nexray.newsletterAnnotation)
                    || false;
                if (ann && message) {
                    (0, context_1.applyAnnotationsToMessage)(message, ann);
                }
                return [2 /*return*/, sock.relayMessage(jid, message, options || {})];
            });
        });
    }

    /**
     * sendText(jid, text, quoted?, opts?)
     * Supports: mentionAll, mentions, quoted, linkPreview, ephemeral
     */
    /**
     * sendText(jid, text, quoted?, opts)
     * opts.mentionAll: true lets baileys resolve "@everyone" natively via
     * contextInfo.nonJidMentions — no need to fetch groupMetadata ourselves.
     * opts.mentions / opts.mentionedJid: explicit JID list for targeted @mentions.
     */
    function sendText(jid, text, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, contextInfo, content, msg, messageId;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!jid)
                            throw new errors_1.NexrayError('sendText: jid required', errors_1.ErrorCodes.INVALID_JID);
                        options = opts || {};
                        // (jid, text, m) | (jid, text, m, opts) | (jid, text, opts)
                        if (quoted && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid && typeof quoted === 'object') {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        quoted = resolveQuoted(quoted, options);
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            expiration: options.expiration,
                            extra: options.contextInfo
                        });
                        content = {
                            text: text,
                            linkPreview: options.linkPreview === false ? null : undefined,
                            // top-level mentions/mentionAll — baileys' own generateWAMessageContent
                            // resolves these into contextInfo.mentionedJid / contextInfo.nonJidMentions
                            mentions: options.mentions || options.mentionedJid || undefined,
                            mentionAll: !!options.mentionAll,
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, content, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId,
                                ephemeralExpiration: options.expiration
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalAttributes: options.additionalAttributes,
                                additionalNodes: options.additionalNodes
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }

    /**
     * sock.reply(jid, text, quoted, opts) — neoxr style
     */
    function reply(jid, text, quoted, opts) {
        return sendText(jid, text, quoted, opts);
    };

    /**
     * sendReact(jid, emoji, key)
     */
    function sendReact(jid, emoji, key) {
        return __awaiter(this, void 0, void 0, function () {
            var msg, messageId;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        messageId = makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                react: {
                                    text: emoji,
                                    key: key
                                }
                            }, {
                                userJid: sock.user && sock.user.id,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };

    /**
     * Internal: prepare media content via baileys prepareWAMessageMedia when available
     */
    function prepareMedia(mediaInput, type, options) {
        return __awaiter(this, void 0, void 0, function () {
            var prepareWAMessageMedia, mediaObj, normalized;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prepareWAMessageMedia = baileys.prepareWAMessageMedia;
                        if (!prepareWAMessageMedia) {
                            throw new errors_1.NexrayError('prepareWAMessageMedia not available in baileys', errors_1.ErrorCodes.NOT_IMPLEMENTED);
                        }
                        if (mediaInput == null) {
                            throw new errors_1.NexrayError('prepareMedia: media input is empty', errors_1.ErrorCodes.INVALID_MEDIA);
                        }
                        // reject location/interactive option objects mistakenly passed as media
                        if (typeof mediaInput === 'object' && !Buffer.isBuffer(mediaInput) && !mediaInput.url && !mediaInput.stream &&
                            (mediaInput.location || mediaInput.degreesLatitude != null || mediaInput.productImage)) {
                            throw new errors_1.NexrayError('prepareMedia: invalid media input (location/product object). Use dedicated header path.', errors_1.ErrorCodes.INVALID_MEDIA);
                        }
                        mediaObj = {};
                        normalized = normalizeMediaInput(mediaInput);
                        mediaObj[type] = normalized;
                        return [4 /*yield*/, prepareWAMessageMedia(mediaObj, {
                                upload: sock.waUploadToServer,
                                mediaTypeOverride: options && options.mediaTypeOverride
                            })];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    }

    /**
     * Resolve interactive header from options.media / image / video / location
     */
    function buildInteractiveHeader(options) {
        return __awaiter(this, void 0, void 0, function () {
            var title, media, prepared, loc, thumb, thumbBuf, fs, locationMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        title = (typeof options.title === 'string' ? options.title : '') || (typeof options.header === 'string' ? options.header : '') || (options.header && options.header.title) || '';
                        media = options.media;
                        // Support:
                        //   media: { location: {...} }
                        //   header: { location: { name, thumbnail }, hasMediaAttachment }
                        //   location: {...}
                        loc = null;
                        if (media && typeof media === 'object' && media.location)
                            loc = media.location;
                        else if (options.header && typeof options.header === 'object' && options.header.location)
                            loc = options.header.location;
                        else if (options.location && typeof options.location === 'object')
                            loc = options.location;
                        if (loc) {
                            thumb = loc.jpegThumbnail || loc.thumbnail || loc.thumb;
                            thumbBuf = undefined;
                            if (thumb) {
                                if (Buffer.isBuffer(thumb))
                                    thumbBuf = thumb;
                                else if (typeof thumb === 'string') {
                                    if (/^https?:\/\//i.test(thumb)) {
                                        // leave remote — some builds accept later; try local read for path
                                        try {
                                            fs = require('fs');
                                            if (fs.existsSync(thumb))
                                                thumbBuf = fs.readFileSync(thumb);
                                        }
                                        catch (_b) { }
                                    }
                                    else {
                                        try {
                                            fs = require('fs');
                                            if (fs.existsSync(thumb))
                                                thumbBuf = fs.readFileSync(thumb);
                                        }
                                        catch (_c) { }
                                    }
                                }
                            }
                            locationMessage = {
                                degreesLatitude: loc.degreesLatitude != null ? loc.degreesLatitude : (loc.lat || 0),
                                degreesLongitude: loc.degreesLongitude != null ? loc.degreesLongitude : (loc.lng || 0),
                                name: loc.name || title || '',
                                address: loc.address || '',
                                url: loc.url || ''
                            };
                            if (thumbBuf)
                                locationMessage.jpegThumbnail = thumbBuf;
                            return [2 /*return*/, {
                                    title: title,
                                    hasMediaAttachment: true,
                                    locationMessage: locationMessage
                                }];
                        }
                        // media / image / video as buffer|path|url
                        if (options.video || (typeof media === 'string') || Buffer.isBuffer(media) || (media && media.url) || options.image) {
                            return [4 /*yield*/, prepareMedia(options.video || options.image || media, options.video ? 'video' : 'image', options)];
                        }
                        return [3 /*break*/, 2];
                    case 1:
                        prepared = _a.sent();
                        return [2 /*return*/, Object.assign({
                                title: title,
                                hasMediaAttachment: true
                            }, prepared.imageMessage ? { imageMessage: prepared.imageMessage } : {}, prepared.videoMessage ? { videoMessage: prepared.videoMessage } : {}, prepared)];
                    case 2:
                        if (title) {
                            return [2 /*return*/, { title: title, hasMediaAttachment: false }];
                        }
                        return [2 /*return*/, null];
                }
            });
        });
    }

    /**
     * sendImage(jid, image, caption?, quoted?, opts?)
     * image: Buffer | path | url
     */
    function sendImage(jid, image, caption, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, prepared, contextInfo, annotation, content, msg, messageId;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (caption && typeof caption === 'object' && !Buffer.isBuffer(caption)) {
                            // (jid, image, opts)
                            options = caption;
                            caption = options.caption || '';
                            quoted = options.quoted || quoted;
                        }
                        return [4 /*yield*/, prepareMedia(image, 'image', options)];
                    case 1:
                        prepared = _a.sent();
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            mentions: options.mentions || options.mentionedJid,
                            expiration: options.expiration,
                            extra: options.contextInfo
                        });
                        annotation = (sock.__nexray && sock.__nexray.newsletterAnnotation) || options.newsletterAnnotation;
                        if (annotation) {
                            contextInfo = (0, context_1.applyNewsletterAnnotation)(contextInfo, annotation);
                        }
                        content = Object.assign({}, prepared.imageMessage ? { imageMessage: prepared.imageMessage } : prepared, {
                            // generateWAMessage style
                        });
                        // Prefer high-level generateWAMessage with image buffer/url when possible
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                image: normalizeMediaInput(image),
                                caption: caption || options.caption || '',
                                mimetype: options.mimetype,
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId,
                                upload: sock.waUploadToServer,
                                ephemeralExpiration: options.expiration
                            })];
                    case 2:
                        msg = _a.sent();
                        // media annotation with polygonVertices (messages.md mediaAnnotation)
                        if (annotation && msg.message && msg.message.imageMessage) {
                            var anns = (0, context_1.buildMediaAnnotations)(annotation);
                            if (anns) {
                                msg.message.imageMessage.annotations = anns;
                            }
                            msg.message.imageMessage.contextInfo = (0, context_1.applyNewsletterAnnotation)(msg.message.imageMessage.contextInfo || contextInfo || {}, annotation);
                        }
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };

    /**
     * sendVideo(jid, video, caption?, quoted?, opts?)
     */
    function sendVideo(jid, video, caption, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, contextInfo, annotation, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (caption && typeof caption === 'object' && !Buffer.isBuffer(caption)) {
                            options = caption;
                            caption = options.caption || '';
                            quoted = options.quoted || quoted;
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            mentions: options.mentions || options.mentionedJid,
                            expiration: options.expiration,
                            extra: options.contextInfo
                        });
                        annotation = (sock.__nexray && sock.__nexray.newsletterAnnotation) || options.newsletterAnnotation;
                        if (annotation) {
                            contextInfo = (0, context_1.applyNewsletterAnnotation)(contextInfo, annotation);
                        }
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                video: normalizeMediaInput(video),
                                caption: caption || options.caption || '',
                                mimetype: options.mimetype || 'video/mp4',
                                gifPlayback: options.gifPlayback,
                                ptv: options.ptv,
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId,
                                upload: sock.waUploadToServer,
                                ephemeralExpiration: options.expiration
                            })];
                    case 1:
                        msg = _a.sent();
                        if (annotation && msg.message && msg.message.videoMessage) {
                            var annsV = (0, context_1.buildMediaAnnotations)(annotation);
                            if (annsV) {
                                msg.message.videoMessage.annotations = annsV;
                            }
                            msg.message.videoMessage.contextInfo = (0, context_1.applyNewsletterAnnotation)(msg.message.videoMessage.contextInfo || contextInfo || {}, annotation);
                        }
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };

    /**
     * sendAudio(jid, audio, quoted?, opts?)
     * opts.ptt = true → voice note + waveform via audio-decode
     */
    function sendAudio(jid, audio, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, contextInfo, messageId, payload, media_1, waveform, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && !quoted.key && !quoted.id && typeof quoted === 'object') {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            mentions: options.mentions || options.mentionedJid,
                            expiration: options.expiration,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        payload = {
                            audio: normalizeMediaInput(audio),
                            mimetype: options.mimetype || (options.ptt ? 'audio/ogg; codecs=opus' : 'audio/mpeg'),
                            ptt: !!options.ptt,
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        if (!(options.ptt && !options.waveform)) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        media_1 = require('../utils/media');
                        return [4 /*yield*/, media_1.getAudioWaveform(audio)];
                    case 2:
                        waveform = _a.sent();
                        if (waveform)
                            payload.waveform = waveform;
                        return [3 /*break*/, 4];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        if (options.waveform)
                            payload.waveform = options.waveform;
                        return [4 /*yield*/, generateWAMessage(jid, payload, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId,
                                upload: sock.waUploadToServer,
                                ephemeralExpiration: options.expiration
                            })];
                    case 5:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 6:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };


    /**
     * sendFile(jid, path|url|buffer, filename?, caption?, quoted?, opts?)
     * Neoxr-compatible signature:
     *   sendFile(m.chat, url, 'image.jpg', 'Test!', m)
     *   sendFile(m.chat, path, '', '', m, { ptt: true })
     *   sendFile(m.chat, path, 'doc.pdf', 'caption', m, { document: true })
     *
     * Auto-routes to image / video / audio / document based on mime or opts.
     */
    function sendFile(jid, file, fileName, caption, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, name, cap, q, mimeGuess, media_util;
            return __generator(this, function (_a) {
                options = opts || {};
                // overload: (jid, file, opts)
                if (fileName && typeof fileName === 'object' && !Array.isArray(fileName)) {
                    options = fileName;
                    fileName = options.fileName || options.filename || '';
                    caption = options.caption || '';
                    quoted = options.quoted || quoted;
                }
                // overload: (jid, file, fileName, opts)
                if (caption && typeof caption === 'object' && !caption.key && !caption.id) {
                    options = Object.assign({}, caption, options);
                    caption = options.caption || '';
                    quoted = options.quoted || quoted;
                }
                name = fileName || options.fileName || options.filename || '';
                cap = caption || options.caption || '';
                q = quoted || options.quoted || null;
                // detect type
                if (hasNonNullishProperty(options, 'ptt') || hasNonNullishProperty(options, 'audio')) {
                    return [2 /*return*/, sendAudio(jid, file, q, Object.assign({}, options, { ptt: options.ptt !== false || !!options.ptt }))];
                }
                if (hasNonNullishProperty(options, 'document')) {
                    return [2 /*return*/, sendDocumentInternal(jid, file, name || 'file', cap, q, options)];
                }
                mimeGuess = options.mimetype || '';
                try {
                    media_util = require('../utils/media');
                    if (!mimeGuess && typeof file === 'string')
                        mimeGuess = media_util.getMimeType(file) || media_util.getMimeType(name) || '';
                }
                catch (_b) { }
                if (hasNonNullishProperty(options, 'image') || /^image\//.test(mimeGuess) || /\.(jpe?g|png|gif|webp)$/i.test(name) || /\.(jpe?g|png|gif|webp)$/i.test(String(file))) {
                    return [2 /*return*/, sendImage(jid, file, cap, q, options)];
                }
                else if (hasNonNullishProperty(options, 'video') || hasNonNullishProperty(options, 'ptv') || /^video\//.test(mimeGuess) || /\.(mp4|mkv|mov|webm|3gp)$/i.test(name) || /\.(mp4|mkv|mov|webm|3gp)$/i.test(String(file))) {
                    return [2 /*return*/, sendVideo(jid, file, cap, q, Object.assign({}, options, { ptv: options.ptv }))];
                }
                else if (/^audio\//.test(mimeGuess) || /\.(mp3|ogg|opus|wav|m4a)$/i.test(name) || /\.(mp3|ogg|opus|wav|m4a)$/i.test(String(file))) {
                    return [2 /*return*/, sendAudio(jid, file, q, options)];
                }
                // default document
                return [2 /*return*/, sendDocumentInternal(jid, file, name || 'file', cap, q, options)];
            });
        });
    };

    /**
     * sendDocument(jid, file, fileName?, caption?, quoted?, opts?)
     */
    function sendDocumentInternal (jid, file, fileName, caption, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, contextInfo, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (fileName && typeof fileName === 'object') {
                            options = fileName;
                            fileName = options.fileName || options.filename || 'file';
                            caption = options.caption || '';
                            quoted = options.quoted || quoted;
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            mentions: options.mentions || options.mentionedJid,
                            expiration: options.expiration,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                document: normalizeMediaInput(file),
                                mimetype: options.mimetype || 'application/octet-stream',
                                fileName: fileName || options.fileName || 'file',
                                caption: caption || options.caption || '',
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId,
                                upload: sock.waUploadToServer,
                                ephemeralExpiration: options.expiration
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };


    /**
     * sendLocation(jid, coords, quoted?, opts?)
     * coords: { degreesLatitude, degreesLongitude, name?, address? } | [lat, lng]
     * Can later be composed into interactive (stage 4)
     */
    function sendLocation(jid, coords, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, lat, lng, contextInfo, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && !quoted.key && !quoted.id && typeof quoted === 'object') {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        if (Array.isArray(coords)) {
                            lat = coords[0];
                            lng = coords[1];
                        }
                        else {
                            lat = coords.degreesLatitude != null ? coords.degreesLatitude : coords.lat;
                            lng = coords.degreesLongitude != null ? coords.degreesLongitude : coords.lng;
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            mentions: options.mentions || options.mentionedJid,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                location: {
                                    degreesLatitude: lat,
                                    degreesLongitude: lng,
                                    name: coords.name || options.name,
                                    address: coords.address || options.address
                                },
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };


    /**
     * sendAlbum(jid, items, options?)
     * Pattern:
     *  1. relay albumMessage (expectedImageCount / expectedVideoCount)
     *  2. for each item generateWAMessage + inject messageAssociation.parentMessageKey = album.key
     *  3. relay each media
     *  4. return album (with key)
     *
     * items: Array<{
     *   image?: Buffer | path | url,   // preferred
     *   video?: Buffer | path | url,   // preferred
     *   caption?: string,
     *   // legacy optional: url + type?: 'image'|'video' (default image)
     * }>
     *
     * Example:
     *   sock.sendAlbum(chat, [
     *     { image: 'https://…/a.jpg', caption: '1' },
     *     { image: './b.jpg' },
     *     { video: buffer },
     *   ], { quoted: m })
     */
    function sendAlbum(jid, items, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, crypto, messageSecret, imageCount, videoCount, i, it, messageContent, generationOptions, album, _i, items_1, content, mediaSecret, mediaMsg, e_1, q, mediaPayload;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // Signature: sendAlbum(jid, items, m)  or  sendAlbum(jid, items, m, opts)  or  sendAlbum(jid, items, opts)
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                            // 3rd arg is options
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        if (!Array.isArray(items) || items.length < 2) {
                            throw new errors_1.NexrayError('sendAlbum requires at least 2 media items', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        // Normalize items → baileys media shape (Buffer | { url })
                        //   { image: buffer|path|url, caption? }
                        //   { video: buffer|path|url, caption? }
                        //   legacy: { url, type?: 'image'|'video', caption? }
                        items = items.map(function (it) {
                            if (!it || typeof it !== 'object') return it;
                            var caption = it.caption || '';
                            if (hasNonNullishProperty(it, 'image'))
                                return { image: normalizeMediaInput(it.image), caption: caption };
                            else if (hasNonNullishProperty(it, 'video'))
                                return { video: normalizeMediaInput(it.video), caption: caption };
                            var media = it.url || it.path || it.buffer || it.media;
                            if (media == null) return it;
                            var t = (it.type || 'image').toLowerCase();
                            if (t === 'video')
                                return { video: normalizeMediaInput(media), caption: caption };
                            return { image: normalizeMediaInput(media), caption: caption };
                        });
                        crypto = require('crypto');
                        messageSecret = new Uint8Array(32);
                        crypto.randomFillSync(messageSecret);
                        imageCount = 0;
                        videoCount = 0;
                        for (i = 0; i < items.length; i++) {
                            it = items[i];
                            if (hasNonNullishProperty(it, 'video'))
                                videoCount++;
                            else if (hasNonNullishProperty(it, 'image'))
                                imageCount++;
                        }
                        if ((imageCount + videoCount) < 2) {
                            throw new errors_1.NexrayError('sendAlbum: minimum 2 image/video items', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        messageContent = {
                            messageContextInfo: { messageSecret: messageSecret },
                            albumMessage: {
                                expectedImageCount: imageCount,
                                expectedVideoCount: videoCount
                            }
                        };
                        generationOptions = {
                            userJid: sock.user && sock.user.id,
                            upload: sock.waUploadToServer,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            ephemeralExpiration: options.expiration || 0,
                            messageId: options.messageId || makeMsgId(sock)
                        };
                        album = generateWAMessageFromContent(jid, messageContent, generationOptions);
                        // ensure quotedMessage is not empty {}
                        if (q && album.message && album.message.albumMessage) {
                            var qBuilt = (0, context_1.buildQuoted)(q);
                            if (qBuilt) {
                                album.message.albumMessage.contextInfo = Object.assign({}, album.message.albumMessage.contextInfo || {}, {
                                    stanzaId: qBuilt.key.id,
                                    participant: qBuilt.key.participant || qBuilt.key.remoteJid,
                                    quotedMessage: qBuilt.message
                                });
                            }
                        }
                        return [4 /*yield*/, relay(album.key.remoteJid || jid, album.message, { messageId: album.key.id })];
                    case 1:
                        _a.sent();
                        _i = 0, items_1 = items;
                        _a.label = 2;
                    case 2:
                        if (!(_i < items_1.length)) return [3 /*break*/, 8];
                        content = items_1[_i];
                        mediaSecret = new Uint8Array(32);
                        crypto.randomFillSync(mediaSecret);
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 6, , 7]);
                        return [4 /*yield*/, generateWAMessage(album.key.remoteJid || jid, content, {
                                userJid: sock.user && sock.user.id,
                                upload: sock.waUploadToServer,
                                ephemeralExpiration: options.expiration || 0
                            })];
                    case 4:
                        mediaMsg = _a.sent();
                        // Inject association ke parent album key
                        if (!mediaMsg.message)
                            mediaMsg.message = {};
                        mediaMsg.message.messageContextInfo = Object.assign({}, mediaMsg.message.messageContextInfo || {}, {
                            messageSecret: mediaSecret,
                            messageAssociation: {
                                associationType: 1,
                                parentMessageKey: album.key
                            }
                        });
                        // newsletter media annotation on every album image/video
                        var albumAnn = (sock.__nexray && sock.__nexray.newsletterAnnotation) || options.newsletterAnnotation;
                        if (albumAnn) {
                            var albumAnns = (0, context_1.buildMediaAnnotations)(albumAnn);
                            if (albumAnns) {
                                if (mediaMsg.message.imageMessage) {
                                    mediaMsg.message.imageMessage.annotations = albumAnns;
                                    mediaMsg.message.imageMessage.contextInfo = (0, context_1.applyNewsletterAnnotation)(mediaMsg.message.imageMessage.contextInfo || {}, albumAnn);
                                }
                                if (mediaMsg.message.videoMessage) {
                                    mediaMsg.message.videoMessage.annotations = albumAnns;
                                    mediaMsg.message.videoMessage.contextInfo = (0, context_1.applyNewsletterAnnotation)(mediaMsg.message.videoMessage.contextInfo || {}, albumAnn);
                                }
                            }
                        }
                        return [4 /*yield*/, relay(mediaMsg.key.remoteJid || jid, mediaMsg.message, { messageId: mediaMsg.key.id })];
                    case 5:
                        _a.sent();
                        return [3 /*break*/, 7];
                    case 6:
                        e_1 = _a.sent();
                        console.error('[@nexray/lib] sendAlbum item failed:', e_1 && e_1.message);
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 2];
                    case 8: return [2 /*return*/, album];
                }
            });
        });
    };

    /**
     * Normalize button entry to nativeFlow shape { name, buttonParamsJson }
     */

    function normalizeButton(btn, index) {
        // Baileys native interactiveButtons — pass through { name, buttonParamsJson }
        if (!btn || typeof btn !== 'object')
            throw new errors_1.NexrayError('button must be object', errors_1.ErrorCodes.INVALID_OPTIONS);
        if (btn.name && (btn.buttonParamsJson != null || btn.paramsJson != null)) {
            var p = btn.buttonParamsJson != null ? btn.buttonParamsJson : btn.paramsJson;
            return {
                name: btn.name,
                buttonParamsJson: typeof p === 'string' ? p : JSON.stringify(p)
            };
        }
        // minimal shortcuts still accepted
        var display = btn.text || btn.display_text || btn.displayText || ('Button ' + (index + 1));
        if (btn.url) {
            return { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: display, url: btn.url, merchant_url: btn.url }) };
        }
        if (btn.copy || btn.copy_code) {
            return { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: display, copy_code: btn.copy || btn.copy_code }) };
        }
        return {
            name: btn.name || 'quick_reply',
            buttonParamsJson: JSON.stringify(btn.params || { display_text: display, id: btn.id || ('btn_' + (index + 1)) })
        };
    }


    /**
     * sendInteractive(jid, buttons, quoted?, opts?)
     * Unified interactive / nativeFlow / carousel.
     */
    function sendInteractive(jid, buttons, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, processedButtons, i, messageContent, bodyText, prepared, headerMedia, cards, c, imgPrepared, card, nativeFlow, payload, viewOnce, msg, additionalNodes, ctx;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        // Overloads:
                        //   sendInteractive(jid, buttons[], quoted?, opts?)
                        //   sendInteractive(jid, { text, interactiveButtons, header, ... }, quoted?)
                        //   sendInteractive(jid, null, quoted, opts)  // legacy
                        if (buttons && !Array.isArray(buttons) && typeof buttons === 'object' &&
                            (buttons.interactiveButtons || buttons.buttons || buttons.text || buttons.content || buttons.header || buttons.media || buttons.messageParamsJson)) {
                            // 2nd arg is options payload
                            options = Object.assign({}, buttons, options);
                            buttons = options.interactiveButtons || options.buttons || [];
                            if (!quoted)
                                quoted = options.quoted || null;
                        }
                        else if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid && !Array.isArray(quoted)) {
                            options = Object.assign({}, quoted, options);
                            quoted = options.quoted || null;
                        }
                        quoted = resolveQuoted(quoted, options);
                        if (!Array.isArray(buttons) || buttons.length === 0)
                            buttons = options.interactiveButtons || options.buttons || [];
                        processedButtons = [];
                        for (i = 0; i < buttons.length; i++) {
                            processedButtons.push(normalizeButton(buttons[i], i));
                        }
                        messageContent = {};
                        bodyText = options.text || options.content || options.body || options.caption || '';
                        return [4 /*yield*/, buildInteractiveHeader(options)];
                    case 1:
                        headerMedia = _a.sent();
                        if (headerMedia) {
                            messageContent.header = headerMedia;
                        }
                        _a.label = 3;
                    case 3:
                        if (bodyText) {
                            messageContent.body = { text: bodyText };
                        }
                        if (options.footer) {
                            messageContent.footer = { text: options.footer };
                        }
                        if (!(options.carousel && Array.isArray(options.carousel) && options.carousel.length)) return [3 /*break*/, 8];
                        cards = [];
                        i = 0;
                        _a.label = 4;
                    case 4:
                        if (!(i < options.carousel.length)) return [3 /*break*/, 7];
                        c = options.carousel[i];
                        return [4 /*yield*/, prepareMedia(c.image || c.media, 'image', options)];
                    case 5:
                        imgPrepared = _a.sent();
                        card = {
                            header: Object.assign({
                                title: c.caption || c.title || ('Card ' + (i + 1)),
                                hasMediaAttachment: true
                            }, imgPrepared.imageMessage ? { imageMessage: imgPrepared.imageMessage } : imgPrepared),
                            nativeFlowMessage: {
                                buttons: Array.isArray(c.buttons) ? c.buttons.map(function (b, idx) { return normalizeButton(b, idx); }) : []
                            }
                        };
                        if (options.footer) {
                            card.footer = { text: options.footer };
                        }
                        cards.push(card);
                        i++;
                        return [3 /*break*/, 4];
                    case 7:
                        messageContent.carouselMessage = { cards: cards };
                        _a.label = 8;
                    case 8:
                        if (processedButtons.length && !messageContent.carouselMessage) {
                            nativeFlow = { buttons: processedButtons };
                            var params = {};
                            if (options.messageParamsJson) {
                                params = typeof options.messageParamsJson === 'string'
                                    ? JSON.parse(options.messageParamsJson)
                                    : Object.assign({}, options.messageParamsJson);
                            }
                            // neoxr "multiple" → bottom sheet list style
                            if (options.multiple && typeof options.multiple === 'object') {
                                params.bottom_sheet = {
                                    in_thread_buttons_limit: 3,
                                    divider_indices: [1, 2],
                                    list_title: options.multiple.list_title || options.multiple.name || 'Select',
                                    button_title: options.multiple.button_title || 'Tap Here!'
                                };
                            }
                            if (Object.keys(params).length) {
                                nativeFlow.messageParamsJson = JSON.stringify(params);
                            }
                            messageContent.nativeFlowMessage = nativeFlow;
                        }
                        if (options.mentionedJid || options.mentions || options.contextInfo || quoted || options.quoted) {
                            ctx = (0, context_1.buildContextInfo)({
                                quoted: quoted || options.quoted,
                                mentions: options.mentions || options.mentionedJid,
                                extra: options.contextInfo
                            });
                            if (Object.keys(ctx).length)
                                messageContent.contextInfo = ctx;
                        }
                        if (proto && proto.Message && proto.Message.InteractiveMessage && typeof proto.Message.InteractiveMessage.create === 'function') {
                            payload = proto.Message.InteractiveMessage.create(messageContent);
                        }
                        else {
                            payload = messageContent;
                        }
                        viewOnce = {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2
                                    },
                                    interactiveMessage: payload
                                }
                            }
                        };
                        msg = generateWAMessageFromContent(jid, viewOnce, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                            messageId: options.messageId || makeMsgId(sock)
                        });
                        additionalNodes = options.additionalNodes || [{
                                tag: 'biz',
                                attrs: {},
                                content: [{
                                        tag: 'interactive',
                                        attrs: { type: 'native_flow', v: '1' },
                                        content: [{
                                                tag: 'native_flow',
                                                attrs: { v: '9', name: 'mixed' }
                                            }]
                                    }]
                            }];
                        return [4 /*yield*/, relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalNodes: additionalNodes
                            })];
                    case 9:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };

    // aliases — neoxr README compatible names
    var sendIAMessage = sendInteractive;
    var sendButton = sendInteractive;
    var sendAlbumMessage = sendAlbum;

    /**
     * sendCarousel(jid, cards, quoted?, opts?)
     * Neoxr style:
     *   cards = [{ header: { imageMessage|hasMediaAttachment }, body: { text }, nativeFlowMessage: { buttons } }]
     *   opts = { content: 'Hi!' }
     */
    function sendCarousel(jid, cards, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, normalized;
            return __generator(this, function (_a) {
                options = opts || {};
                if (quoted && !quoted.key && !quoted.id && !quoted.chat && typeof quoted === 'object') {
                    options = quoted;
                    quoted = options.quoted || null;
                }
                // If cards already in full interactive card shape, pass through via carousel option
                normalized = (cards || []).map(function (c) {
                    if (c.image || c.media) return c;
                    // neoxr card with header.imageMessage as url/string — convert
                    var img = null;
                    if (c.header) {
                        if (typeof c.header.imageMessage === 'string') img = c.header.imageMessage;
                        else if (c.header.imageMessage && c.header.imageMessage.url) img = c.header.imageMessage.url;
                        else if (c.header.jpegThumbnail) img = c.header.jpegThumbnail;
                    }
                    return {
                        image: img || c.url || c.media,
                        caption: (c.body && c.body.text) || c.caption || c.title || '',
                        buttons: (c.nativeFlowMessage && c.nativeFlowMessage.buttons) || c.buttons || []
                    };
                });
                return [2 /*return*/, sendInteractive(jid, [], quoted, Object.assign({}, options, {
                        text: options.content || options.text || options.body || '',
                        content: options.content || options.text,
                        carousel: normalized
                    }))];
            });
        });
    };


    /**
     * sendSticker(jid, sticker, quoted?, opts?)
     * sticker: Buffer | path | url (prefer webp; non-webp may need external convert)
     * opts: { packname, author } — metadata only if consumer converts; we pass through as sticker media
     * Neoxr: sendSticker(chat, url|buffer, m, { packname, author })
     */

    /**
     * sendSticker(jid, sticker, quoted?, opts?)
     * opts:
     *   packname, author,
     *   isPremium | premium,
     *   isAiSticker | isAi,
     *   isAvatar | avatar,
     *   isLocked | locked  → limitSharing anti-forward
     */

    /**
     * sendSticker(jid, sticker, quoted?, opts?)
     * Proto StickerMessage fields (elrayyxml WAProto):
     *   isAnimated, isAvatar, isAiSticker, isLottie,
     *   accessibilityLabel, premium, emojis,
     *   isPremium / isLocked → limitSharingV2
     * isLottie: true wraps as lottieStickerMessage
     */
    /**
     * Build a WebP EXIF chunk carrying WhatsApp sticker metadata (pack name,
     * author/publisher, emojis, categories, avatar flag) and splice it into a
     * webp buffer's RIFF container. This is how WA actually reads packname/author —
     * it is NOT a protobuf field on stickerMessage, so options here only work if
     * the metadata is embedded into the image bytes themselves before upload.
     */
    function buildStickerExif(opts) {
        var json = {
            'sticker-pack-id': opts.packId || (0, functions_1.generateMessageIDV2)(),
            'sticker-pack-name': opts.packname || opts.name || '',
            'sticker-pack-publisher': opts.author || opts.publisher || '',
            'emojis': Array.isArray(opts.emojis) ? opts.emojis : (opts.emojis ? [opts.emojis] : ['🔥']),
            'is-avatar-sticker': opts.isAvatar ? 1 : 0
        };
        if (opts.androidAppStoreLink) json['android-app-store-link'] = opts.androidAppStoreLink;
        if (opts.iosAppStoreLink) json['ios-app-store-link'] = opts.iosAppStoreLink;
        var jsonBuffer = Buffer.from(JSON.stringify(json), 'utf-8');
        var exifAttr = Buffer.from([
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
            0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
        ]);
        exifAttr.writeUIntLE(jsonBuffer.length, 14, 4);
        return Buffer.concat([exifAttr, jsonBuffer]);
    }

    /**
     * Splice an EXIF chunk into a WebP RIFF container (replacing any existing
     * EXIF chunk), and convert non-webp input to webp first via sharp if available.
     */
    function tagStickerWebp(buffer, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var sharp, converted, exif, chunks, isRiff, off, id, size, padded, out, riffSize;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        isRiff = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
                        if (isRiff) return [3 /*break*/, 3];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        sharp = require('sharp');
                        return [4 /*yield*/, sharp(buffer, { animated: true })
                                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                                .webp({ quality: 90 })
                                .toBuffer()];
                    case 2:
                        converted = _a.sent();
                        return [2 /*return*/, tagStickerWebp(converted, opts)];
                    case 3: return [3 /*break*/, 5];
                    case 4:
                        _a.sent(); // no sharp available — upload raw bytes, untagged (WA may reject non-webp)
                        return [2 /*return*/, buffer];
                    case 5:
                        exif = buildStickerExif(opts);
                        chunks = [];
                        off = 12;
                        while (off < buffer.length) {
                            id = buffer.toString('ascii', off, off + 4);
                            size = buffer.readUInt32LE(off + 4);
                            padded = size + (size % 2);
                            if (id !== 'EXIF') {
                                chunks.push(buffer.slice(off, off + 8 + padded));
                            }
                            off += 8 + padded;
                        }
                        chunks.push(Buffer.concat([
                            Buffer.from('EXIF'),
                            (function () { var b = Buffer.alloc(4); b.writeUInt32LE(exif.length, 0); return b; })(),
                            exif,
                            exif.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
                        ]));
                        out = Buffer.concat(chunks);
                        riffSize = Buffer.alloc(4);
                        riffSize.writeUInt32LE(4 + out.length, 0);
                        return [2 /*return*/, Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBP'), out])];
                }
            });
        });
    }

    /**
     * Convert arbitrary image/video input to a tagged sticker webp buffer via sharp.
     * Falls back to the raw buffer (untagged) if sharp is unavailable.
     */
    function prepareStickerBuffer(input, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var buf;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, resolveToBuffer(input, 'sendSticker')];
                    case 1:
                        buf = _a.sent();
                        if (!buf) {
                            throw new errors_1.NexrayError('sendSticker: could not resolve media to a buffer', errors_1.ErrorCodes.INVALID_MEDIA);
                        }
                        return [2 /*return*/, tagStickerWebp(buf, opts || {})];
                }
            });
        });
    }

    /**
     * sendSticker(jid, media, quoted?, opts?)
     * opts: { packname/name, author/publisher, emojis, isAvatar, isLottie, isLocked, premium, ... }
     * packname/author are embedded into the webp's EXIF chunk (the only place WA reads them from).
     */
    function sendSticker(jid, sticker, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, messageId, taggedWebp, prepared, stickerMessage, msgContent, msg, isPremium, isAi, isAvatar, isLocked, isLottie;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        isPremium = !!(options.isPremium || options.premium);
                        isAi = !!(options.isAiSticker || options.isAi || options.ai);
                        isAvatar = !!(options.isAvatar || options.avatar);
                        isLocked = !!(options.isLocked || options.locked || options.lock);
                        isLottie = !!(options.isLottie || options.lottie);
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, prepareStickerBuffer(sticker, {
                                packname: options.packname || options.pack,
                                author: options.author,
                                emojis: options.emojis,
                                isAvatar: isAvatar
                            })];
                    case 1:
                        taggedWebp = _a.sent();
                        return [4 /*yield*/, baileys.prepareWAMessageMedia({ sticker: taggedWebp }, { upload: sock.waUploadToServer })];
                    case 2:
                        prepared = _a.sent();
                        stickerMessage = Object.assign({}, prepared.stickerMessage);
                        if (options.isAnimated != null)
                            stickerMessage.isAnimated = !!options.isAnimated;
                        if (isAvatar)
                            stickerMessage.isAvatar = true;
                        if (isAi)
                            stickerMessage.isAiSticker = true;
                        if (isLottie)
                            stickerMessage.isLottie = true;
                        if (options.accessibilityLabel)
                            stickerMessage.accessibilityLabel = options.accessibilityLabel;
                        if (isPremium)
                            stickerMessage.premium = typeof options.premium === 'number' ? options.premium : 1;
                        msgContent = { stickerMessage: stickerMessage };
                        if (isLottie) {
                            msgContent = { lottieStickerMessage: { message: { stickerMessage: stickerMessage } } };
                        }
                        if (isLocked || isPremium) {
                            msgContent.messageContextInfo = {
                                limitSharingV2: {
                                    sharingLimited: true,
                                    trigger: 'CHAT_SETTING',
                                    limitSharingSettingTimestamp: String(Date.now()),
                                    initiatedByMe: true
                                }
                            };
                        }
                        msg = generateWAMessageFromContent(jid, msgContent, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            messageId: messageId
                        });
                        return [4 /*yield*/, relay(jid, msg.message || msgContent, { messageId: msg.key ? msg.key.id : messageId })];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }

    /**
     * sendStickerPack(jid, { name, publisher, cover?, stickers: [{ data, emojis? }] }, quoted?, opts?)
     * Sends every sticker in the pack tagged with the same pack name/publisher,
     * one relayed sticker message per item (WhatsApp has no native multi-sticker-pack
     * bundle message — this mirrors how real bots deliver "packs").
     */
    function sendStickerPack(jid, pack, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, items, packId, results, i, item, res;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        q = resolveQuoted(quoted, options);
                        if (!pack || !Array.isArray(pack.stickers) || !pack.stickers.length) {
                            throw new errors_1.NexrayError('sendStickerPack requires { stickers: [...] }', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        items = pack.stickers;
                        packId = pack.packId || (0, functions_1.generateMessageIDV2)();
                        results = [];
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < items.length)) return [3 /*break*/, 4];
                        item = items[i];
                        return [4 /*yield*/, sendSticker(jid, item.data || item.url || item.buffer || item, q, {
                                packname: pack.name || pack.packname,
                                author: pack.author || pack.publisher,
                                emojis: item.emojis,
                                packId: packId,
                                isAvatar: !!pack.isAvatar
                            }).catch(function (e) {
                                console.error('[@nexray/lib] sendStickerPack item failed:', e && e.message);
                                return null;
                            })];
                    case 2:
                        res = _a.sent();
                        if (res)
                            results.push(res);
                        _a.label = 3;
                    case 3:
                        i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/, results];
                }
            });
        });
    }

    function sendPtv(jid, video, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q;
            return __generator(this, function (_a) {
                options = opts || {};
                if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                    options = quoted;
                    quoted = options.quoted || null;
                }
                q = resolveQuoted(quoted, options);
                return [2 /*return*/, sendVideo(jid, video, options.caption || '', q, Object.assign({}, options, { ptv: true }))];
            });
        });
    };

    /**
     * Shared poll-creation payload builder — used by sendPoll and sendQuiz.
     * pollType 0 = regular poll, 1 = quiz (newsletter only, requires correctAnswer).
     */
    /**
     * Build a pollCreationMessage* proto object directly (bypassing baileys'
     * generateWAMessageContent 'poll' branch, which not every baileys build ships).
     * Returns { key, value } where key is the exact proto field name to use
     * (pollCreationMessage / pollCreationMessageV2 / V3 / V5) and value is the payload.
     */
    /**
     * Build the { poll: {...} } content-key payload baileys' own
     * generateWAMessageContent understands natively (see messages.md:776-828 —
     * this fork handles pollCreationMessage / V2 / V3 / V5 and messageSecret itself).
     */
    function buildPollCreation(name, values, options, pollType) {
        if (!Array.isArray(values) || !values.length) {
            throw new errors_1.NexrayError('poll values must be a non-empty array', errors_1.ErrorCodes.INVALID_OPTIONS);
        }
        var selectableCount = pollType === 1
            ? 1
            : (options.multiselect ? values.length : (options.selectableCount != null ? options.selectableCount : 1));
        if (selectableCount < 0 || selectableCount > values.length) {
            throw new errors_1.NexrayError('selectableCount must be >= 0 and <= values.length', errors_1.ErrorCodes.INVALID_OPTIONS);
        }
        var poll = {
            name: name,
            values: values,
            selectableCount: selectableCount,
            toAnnouncementGroup: !!options.toAnnouncementGroup,
            hideVoter: !!options.hideVoter,
            canAddOption: !!options.canAddOption
        };
        if (hasNonNullishProperty(options, 'endDate')) {
            poll.endDate = new Date(options.endDate);
        }
        if (pollType === 1) {
            if (!hasNonNullishProperty(options, 'correctAnswer')) {
                throw new errors_1.NexrayError('sendQuiz requires options.correctAnswer', errors_1.ErrorCodes.INVALID_OPTIONS);
            }
            poll.pollType = 1;
            poll.correctAnswer = options.correctAnswer;
        }
        return poll;
    }

    /**
     * Shared poll/quiz send path — uses baileys' native `poll` content-key
     * (generateWAMessageContent builds pollCreationMessage variants and messageSecret itself).
     */
    function sendPollCreationNative(jid, name, values, options, quoted, pollType) {
        return __awaiter(this, void 0, void 0, function () {
            var q, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        q = resolveQuoted(quoted, options);
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                poll: buildPollCreation(name, values, options, pollType)
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }

    /**
     * sendPoll(jid, values, message?, opts) — quoted is always the message, positioned
     * right before the trailing options object; never buried inside opts.
     * Baileys-native: sendPoll(chat, ['Yes','No'], m, { name, selectableCount, toAnnouncementGroup, endDate, hideVoter, canAddOption })
     * Neoxr-style:     sendPoll(chat, 'Question?', { options: ['Yes','No'], multiselect: false }, m)
     */
    function sendPoll(jid, name, optsOrValues, quoted) {
        var options;
        var values;
        if (Array.isArray(name)) {
            // sendPoll(jid, [values], m, opts) — 4th positional arg is opts here
            values = name;
            options = quoted || {};
            quoted = optsOrValues;
        }
        else if (Array.isArray(optsOrValues)) {
            // sendPoll(jid, 'Question?', ['Yes','No'], m)
            values = optsOrValues;
            options = {};
        }
        else if (optsOrValues && typeof optsOrValues === 'object') {
            // sendPoll(jid, 'Question?', { options: [...], multiselect }, m)
            options = optsOrValues;
            values = options.options || options.values || [];
        }
        else {
            options = {};
            values = [];
        }
        if (!options.name) options.name = name || options.name || '';
        return sendPollCreationNative(jid, options.name, values, options, quoted, 0);
    }

    /**
     * sendQuiz(jid, values, message?, opts) — newsletter-only quiz poll.
     * opts.correctAnswer is required.
     *   sendQuiz('123@newsletter', ['Yes','No'], m, { name: 'Quiz!', correctAnswer: 'Yes' })
     */
    function sendQuiz(jid, values, quoted, opts) {
        var options = opts || {};
        if (!Array.isArray(values)) {
            throw new errors_1.NexrayError('sendQuiz: values must be an array', errors_1.ErrorCodes.INVALID_OPTIONS);
        }
        return sendPollCreationNative(jid, options.name || '', values, options, quoted, 1);
    }

    /**
     * sendPollResult(jid, name, votes, message?, opts?)
     * Uses baileys' native `pollResult` content-key (message.pollResult = { name, votes,
     * pollType? }) — see messages.md:830-846. votes: [{ name, voteCount }].
     * Quiz result vs regular result is just pollType: 1 on the same payload, so there is
     * no separate raw-proto path for quiz — sendQuizResult below is a thin wrapper.
     *   sendPollResult(jid, '📈 Poll Result', [{ name: '🔥 Fire', voteCount: 133 }], m)
     */
    function sendPollResult(jid, name, votes, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!Array.isArray(votes) || !votes.length) {
                            throw new errors_1.NexrayError('poll result votes must be a non-empty array', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        options = opts || {};
                        q = resolveQuoted(quoted, options);
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                pollResult: {
                                    name: name,
                                    votes: votes.map(function (v) { return ({ name: v.name, voteCount: v.voteCount }); }),
                                    pollType: options.pollType === 1 ? 1 : 0
                                }
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }

    /**
     * sendQuizResult(jid, name, votes, message?, opts?) — sendPollResult with
     * pollType: 1 so WA renders the trophy/quiz result card.
     *   sendQuizResult(jid, '🏆 Quiz Result', [{ name: '🔥 Fire', voteCount: 133 }], m)
     */
    function sendQuizResult(jid, name, votes, quoted, opts) {
        return sendPollResult(jid, name, votes, quoted, Object.assign({}, opts, { pollType: 1 }));
    }

    /**
     * pollResult(jid, { name, votes: [{ name, count }] }, message?, opts?) — neoxr-compatible alias.
     * Translates neoxr's { votes: [{name, count}] } shape into { name, voteCount }.
     */
    function pollResult(jid, payload, quoted, opts) {
        payload = payload || {};
        var votes = (payload.votes || []).map(function (v) {
            return { name: v.name, voteCount: v.voteCount != null ? v.voteCount : v.count };
        });
        return sendPollResult(jid, payload.name || '', votes, quoted, opts);
    }

    /**
     * sendEvent(jid, event, message?, opts?)
     * Uses baileys' native `event` content-key (message.eventMessage — see
     * messages.md:756-775). `event.startDate` MUST be a Date (or ISO/epoch that we
     * coerce to one) since baileys calls .getTime() on it without a null-check.
     *   sendEvent(jid, {
     *     name: 'Community Meetup',
     *     description: 'Monthly sync',
     *     startDate: new Date(Date.now() + 86400000),
     *     endDate: new Date(Date.now() + 90000000),   // optional
     *     location: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: 'Jakarta' }, // optional
     *     call: 'audio' | 'video',        // optional — requires sock to support getCallLink
     *     isCancelled: false,             // optional
     *     extraGuestsAllowed: true,       // optional
     *     isScheduleCall: false           // optional
     *   }, m)
     */
    function sendEvent(jid, event, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, messageId, ev, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!event || !event.name) {
                            throw new errors_1.NexrayError('sendEvent requires { name, startDate, ... }', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        if (!event.startDate) {
                            throw new errors_1.NexrayError('sendEvent requires event.startDate (Date, ISO string, or epoch ms)', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        options = opts || {};
                        q = resolveQuoted(quoted, options);
                        messageId = options.messageId || makeMsgId(sock);
                        ev = Object.assign({}, event, {
                            startDate: event.startDate instanceof Date ? event.startDate : new Date(event.startDate),
                            endDate: event.endDate == null ? undefined : (event.endDate instanceof Date ? event.endDate : new Date(event.endDate))
                        });
                        return [4 /*yield*/, generateWAMessage(jid, { event: ev }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId,
                                getCallLink: options.getCallLink || (typeof sock.getCallLink === 'function' ? sock.getCallLink.bind(sock) : undefined)
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }

    /**
     * Build a WhatsApp-compatible vCard 3.0 string for a single contact.
     * Supports both a regular personal contact card and a business-style card
     * (adds TITLE, ADR, X-WA-BIZ-NAME, X-WA-BIZ-DESCRIPTION) when business fields
     * are present on the contact or in the shared `opts`.
     */
    function buildVcard(c, options) {
        var number = String(c.number || c.phone || c.id || '').replace(/\D/g, '');
        var name = c.name || c.fullName || number;
        var org = c.org || options.org;
        var title = c.title || options.title;
        var isBusiness = !!(c.business || options.business || c.bizName || options.bizName || c.bizDescription || options.bizDescription);
        var lines = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            'N:' + name + ';;;;',
            'FN:' + name
        ];
        if (org) lines.push('ORG:' + org);
        if (title) lines.push('TITLE:' + title);
        lines.push('TEL;TYPE=CELL;waid=' + number + ':+' + number);
        if (c.email || options.email) lines.push('EMAIL' + (isBusiness ? ';type=INTERNET' : '') + ':' + (c.email || options.email));
        if (c.website || options.website) lines.push('URL:' + (c.website || options.website));
        if (isBusiness) {
            lines.push('ADR;TYPE=WORK:;;' + (c.region || options.region || '') + ';;;');
        }
        if (c.about) lines.push('NOTE:' + c.about);
        if (isBusiness) {
            lines.push('X-WA-BIZ-NAME:' + (c.bizName || options.bizName || name));
            if (c.bizDescription || options.bizDescription) {
                lines.push('X-WA-BIZ-DESCRIPTION:' + (c.bizDescription || options.bizDescription));
            }
        }
        lines.push('END:VCARD');
        return { number: number, displayName: name, vcard: lines.join('\n') };
    }

    /**
     * sendContact(jid, contacts, quoted?, opts?)
     * Supports plain personal contacts and WhatsApp Business-style cards.
     * Neoxr:
     *   sendContact(chat, [{ name, number, about }], m, { org, website, email })
     * Business card:
     *   sendContact(chat, [{ name, number, business: true, bizName, bizDescription, title, region }], m)
     */
    function sendContact(jid, contacts, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, list, i, c, built, contextInfo, messageId, content, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid && !Array.isArray(quoted)) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        if (!Array.isArray(contacts))
                            contacts = [contacts];
                        list = [];
                        for (i = 0; i < contacts.length; i++) {
                            c = contacts[i];
                            built = buildVcard(c, options);
                            list.push({ displayName: built.displayName, vcard: built.vcard });
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            mentions: options.mentions || options.mentionedJid,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        content = {
                            contacts: {
                                displayName: list.length === 1 ? list[0].displayName : (options.title || (list.length + ' contacts')),
                                contacts: list
                            },
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        return [4 /*yield*/, generateWAMessage(jid, content, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }


    /**
     * copyNForward(jid, message, forceForward?, opts?)
     * Forward a serialized m / raw WAMessage to jid.
     */
    function copyNForward(jid, message, forceForward, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, msg, content, key, contextInfo, messageId, generated;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (forceForward && typeof forceForward === 'object') {
                            options = forceForward;
                            forceForward = options.forceForward;
                        }
                        msg = message;
                        if (msg && msg.message) {
                            content = msg.message;
                            key = msg.key;
                        }
                        else if (msg && msg.msg && msg.type) {
                            content = {};
                            content[msg.type] = msg.msg;
                            key = msg.key;
                        }
                        else {
                            content = msg;
                            key = null;
                        }
                        // strip viewOnce wrappers for forward convenience
                        if (content && content.viewOnceMessage && content.viewOnceMessage.message) {
                            content = content.viewOnceMessage.message;
                        }
                        if (content && content.viewOnceMessageV2 && content.viewOnceMessageV2.message) {
                            content = content.viewOnceMessageV2.message;
                        }
                        if (content && content.ephemeralMessage && content.ephemeralMessage.message) {
                            content = content.ephemeralMessage.message;
                        }
                        contextInfo = options.contextInfo || {};
                        if (forceForward || options.forceForward) {
                            // keep as-is
                        }
                        messageId = options.messageId || makeMsgId(sock);
                        generated = generateWAMessageFromContent(jid, content, {
                            userJid: sock.user && sock.user.id,
                            messageId: messageId,
                            quoted: (0, context_1.buildQuoted)(options.quoted) || undefined
                        });
                        return [4 /*yield*/, relay(jid, generated.message, { messageId: generated.key.id })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, generated];
                }
            });
        });
    };

    /**
     * sendFromAI(jid, text, quoted?, opts?)
     * Sends text with AI attribution label (WhatsApp Business).
     * Uses messageContextInfo.messageAddOnDurationInSecs / bot stuff when available;
     * fallback: plain text with optional contextInfo flag.
     */
    function sendFromAI(jid, text, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, contextInfo, messageId, content, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            mentions: options.mentions || options.mentionedJid,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        content = {
                            text: text,
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        return [4 /*yield*/, generateWAMessage(jid, content, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        // Mark as AI / bot message if proto supports it
                        try {
                            if (msg.message) {
                                if (!msg.message.messageContextInfo)
                                    msg.message.messageContextInfo = {};
                                // common flag used by business AI label
                                msg.message.messageContextInfo.messageAddOnExpiryType = 1;
                                if (msg.message.extendedTextMessage) {
                                    // some clients look for statusAttributionType / AI
                                }
                            }
                        }
                        catch (_b) { }
                        return [4 /*yield*/, relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalNodes: options.additionalNodes || [{
                                        tag: 'bot',
                                        attrs: { biz_bot: '1' }
                                    }]
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };


    /**
     * sendProduct(jid, product, quoted?, opts?)
     *
     * product: {
     *   title, description, priceAmount1000 | price,
     *   currencyCode?: 'IDR',
     *   productId?, retailerId?, url?,
     *   productImage?: Buffer|path|url,
     *   productImageCount?,
     *   businessOwnerJid?
     * }
     *
     * Sends productMessage via generateWAMessage + relayMessage.
     * Can also be embedded in sendInteractive via opts.product.
     */



    /**
     * sendProduct(jid, opts, quoted?)
     *
     * Flat payload (recommended):
     *   sendProduct(jid, {
     *     image: buffer|path|url,   // alias: productImage
     *     title, productId, description?, price?, currencyCode?,
     *     businessOwnerJid,
     *     caption?, footer?,
     *     interactiveButtons?: [...]
     *   }, message)
     *
     * Still accepts nested { product: { productImage, ... }, businessOwnerJid, ... }
     */
    function sendProduct(jid, productOrPayload, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, raw, product, businessOwnerJid, caption, footer, buttons, imageInput, prepared, imageMessage, productFields, productMessage, processedButtons, i, messageContent, payloadMsg, viewOnce, msg, messageId, contextInfo, additionalNodes, content;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        raw = productOrPayload || {};

                        // Flatten: accept both nested and flat
                        if (raw.product && typeof raw.product === 'object' && (raw.product.productImage || raw.product.image || raw.businessOwnerJid || raw.interactiveButtons)) {
                            product = Object.assign({}, raw.product);
                            businessOwnerJid = raw.businessOwnerJid || product.businessOwnerJid || options.businessOwnerJid;
                            caption = raw.caption || options.caption || options.text || '';
                            footer = raw.footer || options.footer || '';
                            buttons = raw.interactiveButtons || raw.buttons || options.interactiveButtons || [];
                        }
                        else {
                            product = raw;
                            businessOwnerJid = raw.businessOwnerJid || options.businessOwnerJid;
                            caption = raw.caption || options.caption || options.text || '';
                            footer = raw.footer || options.footer || '';
                            buttons = raw.interactiveButtons || raw.buttons || options.interactiveButtons || [];
                        }

                        imageInput = product.image || product.productImage || raw.image || raw.productImage || options.image;
                        businessOwnerJid = businessOwnerJid || (sock.user && sock.user.id) || '';
                        if (!businessOwnerJid) {
                            throw new errors_1.NexrayError('sendProduct requires businessOwnerJid', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        if (!imageInput) {
                            throw new errors_1.NexrayError('sendProduct requires image (or productImage)', errors_1.ErrorCodes.INVALID_MEDIA);
                        }

                        return [4 /*yield*/, prepareMedia(imageInput, 'image', options)];
                    case 1:
                        prepared = _a.sent();
                        imageMessage = prepared && prepared.imageMessage ? prepared.imageMessage : prepared;

                        productFields = {
                            productImage: imageMessage,
                            productId: String(product.productId || product.id || raw.productId || ''),
                            title: product.title || raw.title || 'Product',
                            description: product.description || product.desc || raw.description || '',
                            currencyCode: product.currencyCode || product.currency || raw.currencyCode || undefined,
                            priceAmount1000: (product.priceAmount1000 != null ? parseInt(product.priceAmount1000, 10)
                                : (product.price != null ? Math.round(Number(product.price) * 1000)
                                    : (raw.priceAmount1000 != null ? parseInt(raw.priceAmount1000, 10)
                                        : (raw.price != null ? Math.round(Number(raw.price) * 1000) : undefined)))),
                            retailerId: (product.retailerId != null || raw.retailerId != null)
                                ? String(product.retailerId || raw.retailerId) : undefined,
                            url: product.url || raw.url || undefined,
                            productImageCount: product.productImageCount || raw.productImageCount || 1
                        };
                        Object.keys(productFields).forEach(function (k) {
                            if (productFields[k] === undefined)
                                delete productFields[k];
                        });

                        productMessage = {
                            product: productFields,
                            businessOwnerJid: businessOwnerJid
                        };
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            mentions: options.mentions || options.mentionedJid || raw.mentions,
                            extra: options.contextInfo || raw.contextInfo
                        });
                        messageId = options.messageId || raw.messageId || makeMsgId(sock);

                        if (!(Array.isArray(buttons) && buttons.length)) return [3 /*break*/, 3];
                        processedButtons = [];
                        for (i = 0; i < buttons.length; i++) {
                            processedButtons.push(normalizeButton(buttons[i], i));
                        }
                        messageContent = {
                            header: {
                                title: productFields.title || '',
                                hasMediaAttachment: raw.hasMediaAttachment !== false,
                                productMessage: productMessage
                            },
                            nativeFlowMessage: { buttons: processedButtons }
                        };
                        if (caption)
                            messageContent.body = { text: caption };
                        if (footer)
                            messageContent.footer = { text: footer };
                        if (Object.keys(contextInfo).length)
                            messageContent.contextInfo = contextInfo;
                        if (raw.messageParamsJson || options.messageParamsJson) {
                            var pj = raw.messageParamsJson || options.messageParamsJson;
                            messageContent.nativeFlowMessage.messageParamsJson =
                                typeof pj === 'string' ? pj : JSON.stringify(pj);
                        }
                        payloadMsg = (proto && proto.Message && proto.Message.InteractiveMessage &&
                            typeof proto.Message.InteractiveMessage.create === 'function')
                            ? proto.Message.InteractiveMessage.create(messageContent)
                            : messageContent;
                        viewOnce = {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2
                                    },
                                    interactiveMessage: payloadMsg
                                }
                            }
                        };
                        msg = generateWAMessageFromContent(jid, viewOnce, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            messageId: messageId
                        });
                        additionalNodes = options.additionalNodes || raw.additionalNodes || nodes_1.NODES.mixed;
                        return [4 /*yield*/, relay(jid, msg.message || viewOnce, {
                                messageId: msg.key ? msg.key.id : messageId,
                                additionalNodes: additionalNodes
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, msg];
                    case 3:
                        content = { productMessage: productMessage };
                        if (Object.keys(contextInfo).length)
                            content.productMessage.contextInfo = contextInfo;
                        msg = generateWAMessageFromContent(jid, content, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            messageId: messageId
                        });
                        // product needs biz node so media is not invisible on some clients
                        return [4 /*yield*/, relay(jid, msg.message || content, {
                                messageId: msg.key ? msg.key.id : messageId,
                                additionalNodes: options.additionalNodes || raw.additionalNodes || nodes_1.NODES.catalog_message
                            })];
                    case 4:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };



    /**
     * groupStatus(jid, content, opts?)
     * elrayyxml / WAProto: wraps content in groupStatusMessageV2 + contextInfo.isGroupStatus
     * jid must be @g.us
     *
     * content:
     *   { image|video|audio|media|sticker, caption? }
     *   { text, background?, font? }
     * opts: { background?, font?, messageId? }
     */

    /**
     * groupStatus(jid, content, opts?)
     * Matches neoxr private list + elrayyxml groupStatusMessageV2.
     *
     * content: { image|video|audio|media|sticker, caption? } | { text, background?, font? }
     * opts.private: { name, emoji } → statusAudienceMetadata
     *   audienceType: 2 (custom list), listName, listEmoji
     *
     * Proto uses groupStatusMessageV2 only — additionalNodes is_vsn2 optional
     * (user raw relay works with {}).
     */

    /**
     * groupStatus(jid, content, opts?)
     * Wire matches working raw relay:
     *   groupStatusMessageV2.message.extendedTextMessage.contextInfo.statusAudienceMetadata
     * private: { name, emoji } → listName, listEmoji, audienceType: 2
     * isGroupStatus only if opts.isGroupStatus === true
     * additionalNodes is_vsn2 only if opts.vsn2 === true (default OFF — raw uses {})
     */
    function groupStatus(jid, content, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, messageId, contextInfo, prepared, mediaType, mediaSrc, inner, wrapped, msg, priv, audience, relayOpts, node;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        content = content || {};
                        if (typeof jid !== 'string' || !jid.endsWith('@g.us')) {
                            throw new errors_1.NexrayError('groupStatus requires group JID (@g.us). Use sendStatusMentions for status@broadcast.', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        messageId = options.messageId || makeMsgId(sock);
                        contextInfo = {};
                        if (options.isGroupStatus === true) {
                            contextInfo.isGroupStatus = true;
                        }
                        priv = options.private || content.private;
                        if (priv && typeof priv === 'object') {
                            audience = {
                                audienceType: priv.audienceType != null ? Number(priv.audienceType) : 2,
                                listName: String(priv.name || priv.listName || 'private'),
                                listEmoji: String(priv.emoji || priv.listEmoji || '🙂')
                            };
                            contextInfo.statusAudienceMetadata = audience;
                        }
                        if (!(hasNonNullishProperty(content, 'image') || hasNonNullishProperty(content, 'video') ||
                            hasNonNullishProperty(content, 'audio') || hasNonNullishProperty(content, 'media') ||
                            hasNonNullishProperty(content, 'sticker'))) return [3 /*break*/, 2];
                        if (hasNonNullishProperty(content, 'video') || content.type === 'video' || options.type === 'video') {
                            mediaType = 'video';
                            mediaSrc = content.video || content.media;
                        }
                        else if (hasNonNullishProperty(content, 'audio')) {
                            mediaType = 'audio';
                            mediaSrc = content.audio;
                        }
                        else if (hasNonNullishProperty(content, 'sticker')) {
                            mediaType = 'sticker';
                            mediaSrc = content.sticker;
                        }
                        else {
                            mediaType = 'image';
                            mediaSrc = content.image || content.media;
                        }
                        return [4 /*yield*/, prepareMedia(mediaSrc, mediaType, options)];
                    case 1:
                        prepared = _a.sent();
                        if (mediaType === 'video') {
                            inner = { videoMessage: Object.assign({}, prepared.videoMessage, { caption: content.caption || '', contextInfo: contextInfo }) };
                        }
                        else if (mediaType === 'audio') {
                            inner = { audioMessage: Object.assign({}, prepared.audioMessage, { contextInfo: contextInfo }) };
                        }
                        else if (mediaType === 'sticker') {
                            inner = { stickerMessage: Object.assign({}, prepared.stickerMessage, { contextInfo: contextInfo }) };
                        }
                        else {
                            inner = { imageMessage: Object.assign({}, prepared.imageMessage || prepared, { caption: content.caption || '', contextInfo: contextInfo }) };
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        if (content.text != null) {
                            inner = {
                                extendedTextMessage: {
                                    text: content.text,
                                    backgroundArgb: content.background != null ? content.background : (content.backgroundArgb != null ? content.backgroundArgb : options.background),
                                    font: content.font != null ? content.font : options.font,
                                    contextInfo: contextInfo
                                }
                            };
                        }
                        else if (content.message) {
                            inner = content.message;
                        }
                        else {
                            throw new errors_1.NexrayError('groupStatus requires media or text', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        _a.label = 3;
                    case 3:
                        wrapped = { groupStatusMessageV2: { message: inner } };
                        // Prefer raw relay shape — inject after generate so fields are not stripped
                        msg = generateWAMessageFromContent(jid, wrapped, {
                            userJid: sock.user && sock.user.id,
                            messageId: messageId
                        });
                        // re-assert audience metadata on generated tree
                        try {
                            node = msg.message && msg.message.groupStatusMessageV2 && msg.message.groupStatusMessageV2.message;
                            if (node) {
                                var leaf = node.extendedTextMessage || node.imageMessage || node.videoMessage || node.audioMessage || node.stickerMessage;
                                if (leaf) {
                                    leaf.contextInfo = leaf.contextInfo || {};
                                    if (audience) {
                                        leaf.contextInfo.statusAudienceMetadata = {
                                            audienceType: audience.audienceType,
                                            listName: audience.listName,
                                            listEmoji: audience.listEmoji
                                        };
                                    }
                                    if (options.isGroupStatus === true) {
                                        leaf.contextInfo.isGroupStatus = true;
                                    }
                                    else {
                                        delete leaf.contextInfo.isGroupStatus;
                                    }
                                }
                            }
                        }
                        catch (_b) { }
                        relayOpts = { messageId: msg.key ? msg.key.id : messageId };
                        // default: no additionalNodes (matches working raw {}). Set vsn2:true to add meta.
                        if (options.vsn2 === true) {
                            relayOpts.additionalNodes = [{
                                    tag: 'meta',
                                    attrs: { is_vsn2: '1' },
                                    content: undefined
                                }];
                        }
                        if (options.additionalNodes) {
                            relayOpts.additionalNodes = options.additionalNodes;
                        }
                        return [4 /*yield*/, sock.relayMessage(jid, msg.message || wrapped, relayOpts)];
                    case 4:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };

    function sendStatusMentions(jids, content, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, STORIES_JID, targets, payload, msg, statusJidList, i, jid, meta, participants, type, mentionMsg, t;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        content = content || {};
                        STORIES_JID = baileys.STORIES_JID || 'status@broadcast';
                        targets = Array.isArray(jids) ? jids : [jids];
                        payload = {};
                        if (hasNonNullishProperty(content, 'video') || content.type === 'video')
                            payload.video = normalizeMediaInput(content.video || content.media);
                        else if (hasNonNullishProperty(content, 'audio'))
                            payload.audio = normalizeMediaInput(content.audio);
                        else if (hasNonNullishProperty(content, 'image') || hasNonNullishProperty(content, 'media'))
                            payload.image = normalizeMediaInput(content.image || content.media);
                        else if (hasNonNullishProperty(content, 'text'))
                            payload.text = content.text;
                        else
                            throw new errors_1.NexrayError('sendStatusMentions requires media or text', errors_1.ErrorCodes.INVALID_OPTIONS);
                        if (content.caption)
                            payload.caption = content.caption;
                        return [4 /*yield*/, generateWAMessage(STORIES_JID, payload, {
                                upload: sock.waUploadToServer,
                                userJid: sock.user && sock.user.id,
                                backgroundColor: content.background || options.background,
                                font: content.font != null ? content.font : options.font
                            })];
                    case 1:
                        msg = _a.sent();
                        statusJidList = [];
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < targets.length)) return [3 /*break*/, 6];
                        jid = targets[i];
                        if (!(typeof jid === 'string' && jid.endsWith('@g.us'))) return [3 /*break*/, 4];
                        return [4 /*yield*/, sock.groupMetadata(jid)];
                    case 3:
                        meta = _a.sent();
                        participants = (meta && meta.participants) || [];
                        participants.forEach(function (p) { statusJidList.push(p.id || p); });
                        return [3 /*break*/, 5];
                    case 4:
                        statusJidList.push(jid);
                        _a.label = 5;
                    case 5:
                        i++;
                        return [3 /*break*/, 2];
                    case 6:
                        statusJidList = Array.from(new Set(statusJidList.filter(Boolean)));
                        return [4 /*yield*/, sock.relayMessage(msg.key.remoteJid, msg.message, {
                                messageId: msg.key.id,
                                statusJidList: statusJidList,
                                additionalNodes: [{
                                        tag: 'meta',
                                        attrs: {},
                                        content: [{
                                                tag: 'mentioned_users',
                                                attrs: {},
                                                content: targets.map(function (j) {
                                                    return { tag: 'to', attrs: { jid: j }, content: undefined };
                                                })
                                            }]
                                    }]
                            })];
                    case 7:
                        _a.sent();
                        i = 0;
                        _a.label = 8;
                    case 8:
                        if (!(i < targets.length)) return [3 /*break*/, 11];
                        t = targets[i];
                        type = (typeof t === 'string' && t.endsWith('@g.us'))
                            ? 'groupStatusMentionMessage'
                            : 'statusMentionMessage';
                        mentionMsg = {};
                        mentionMsg[type] = {
                            message: {
                                protocolMessage: {
                                    key: msg.key,
                                    type: 25
                                }
                            }
                        };
                        return [4 /*yield*/, sock.relayMessage(t, mentionMsg, {
                                additionalNodes: [{
                                        tag: 'meta',
                                        attrs: { is_status_mention: 'true' },
                                        content: undefined
                                    }]
                            })];
                    case 9:
                        _a.sent();
                        _a.label = 10;
                    case 10:
                        i++;
                        return [3 /*break*/, 8];
                    case 11: return [2 /*return*/, msg];
                }
            });
        });
    };


    /**
     * sendLivePhoto(jid, { video, image? }, quoted?, opts?)
     * image optional — thumb from baileys extractVideoThumb(path, time, size)
     */
    /**
     * Extract a usable video frame for sendLivePhoto's thumbnail.
     *
     * Prefers baileys.extractVideoThumb directly when it's exported (better quality —
     * we control size and can retry at multiple seek offsets, since seeking to the
     * exact start '00:00:00' frequently lands before the first keyframe on many
     * encodes and returns an empty/corrupt buffer). Not every baileys build re-exports
     * extractVideoThumb on its main barrel though (it lives in messages-media.js and
     * isn't always re-exported directly) — when it's missing, falls back to
     * baileys.generateThumbnail(path, 'video', {}), which IS always exported (it's
     * used internally for every video upload) and returns a small base64 JPEG thumb.
     */
    function extractLiveThumb(inputPath) {
        return __awaiter(this, void 0, void 0, function () {
            var extractVideoThumb, offsets, i, buf, result, thumbBuf;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        extractVideoThumb = baileys.extractVideoThumb;
                        if (!(typeof extractVideoThumb === 'function')) return [3 /*break*/, 5];
                        offsets = ['00:00:01', '00:00:00.5', '00:00:00'];
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < offsets.length)) return [3 /*break*/, 4];
                        return [4 /*yield*/, extractVideoThumb(inputPath, offsets[i], { width: 640, height: 640 }).catch(function () { return null; })];
                    case 2:
                        buf = _a.sent();
                        // require a real JPEG (SOI marker 0xFFD8) — an empty/corrupt ffmpeg
                        // frame is worse than no frame at all, never treat it as usable
                        if (buf && Buffer.isBuffer(buf) && buf.length > 100 && buf[0] === 0xFF && buf[1] === 0xD8)
                            return [2 /*return*/, buf];
                        _a.label = 3;
                    case 3:
                        i++;
                        return [3 /*break*/, 1];
                    case 4: return [3 /*break*/, 5];
                    case 5:
                        if (typeof baileys.generateThumbnail !== 'function')
                            return [2 /*return*/, null];
                        return [4 /*yield*/, baileys.generateThumbnail(inputPath, 'video', {}).catch(function () { return null; })];
                    case 6:
                        result = _a.sent();
                        if (!(result && result.thumbnail)) return [3 /*break*/, 7];
                        thumbBuf = Buffer.from(result.thumbnail, 'base64');
                        return [2 /*return*/, (thumbBuf.length > 50 && thumbBuf[0] === 0xFF && thumbBuf[1] === 0xD8) ? thumbBuf : null];
                    case 7: return [2 /*return*/, null];
                }
            });
        });
    }

    /**
     * sendLivePhoto(jid, { video, image? }, quoted?, opts?)
     * image is optional — when omitted, a still frame is extracted from the video,
     * downloading remote video URLs to a temp file first if needed so ffmpeg can seek it.
     * If no real frame can be extracted, this throws instead of silently uploading the
     * video's own bytes mislabeled as an image (the previous "corrupt image" bug).
     */
    async function sendLivePhoto(jid, media, quoted, opts) {
        var options = opts || {};
        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
            options = quoted;
            quoted = options.quoted || null;
        }
        var q = resolveQuoted(quoted, options);
        if (!hasNonNullishProperty(media, 'video')) {
            throw new errors_1.NexrayError('sendLivePhoto requires { video, image? }', errors_1.ErrorCodes.INVALID_MEDIA);
        }

        var imageInput = null;
        if (hasNonNullishProperty(media, 'image')) {
            imageInput = media.image;
        }
        else {
            var fs = require('fs');
            var pathMod = require('path');
            var os = require('os');
            var inputPath = null;
            var needCleanup = false;
            if (Buffer.isBuffer(media.video)) {
                inputPath = pathMod.join(os.tmpdir(), 'nexray_live_' + Date.now() + '.mp4');
                fs.writeFileSync(inputPath, media.video);
                needCleanup = true;
            }
            else if (typeof media.video === 'string' && !/^https?:\/\//i.test(media.video)) {
                inputPath = media.video;
            }
            else if (typeof media.video === 'string' && /^https?:\/\//i.test(media.video)) {
                // remote url — download to a temp file first so we can seek/thumb it locally
                var downloaded = await resolveToBuffer(media.video, 'sendLivePhoto');
                inputPath = pathMod.join(os.tmpdir(), 'nexray_live_' + Date.now() + '.mp4');
                fs.writeFileSync(inputPath, downloaded);
                needCleanup = true;
            }

            var frameBuf = inputPath ? await extractLiveThumb(inputPath) : null;
            if (needCleanup && inputPath) {
                try { fs.unlinkSync(inputPath); } catch (_ignored) { /* best-effort cleanup */ }
            }
            if (!frameBuf) {
                throw new errors_1.NexrayError('sendLivePhoto: could not extract a valid frame from the video (baileys.extractVideoThumb / generateThumbnail both unavailable or failed) — pass { image } explicitly instead', errors_1.ErrorCodes.MEDIA_PROCESS);
            }
            imageInput = frameBuf;
        }

        var imgPrepared = await prepareMedia(imageInput, 'image', options);
        var vidPrepared = await prepareMedia(media.video, 'video', options);

        var imgMsg = generateWAMessageFromContent(jid, {
            imageMessage: Object.assign({}, imgPrepared.imageMessage, {
                contextInfo: { pairedMediaType: 5, statusSourceType: 0 }
            })
        }, {
            userJid: sock.user && sock.user.id,
            quoted: (0, context_1.buildQuoted)(q) || undefined,
            messageId: makeMsgId(sock)
        });
        await relay(jid, imgMsg.message, { messageId: imgMsg.key.id });

        var vidContent = {
            videoMessage: Object.assign({}, vidPrepared.videoMessage, {
                contextInfo: { pairedMediaType: 6, statusSourceType: 0 }
            }),
            messageContextInfo: {
                messageAssociation: {
                    associationType: 12,
                    parentMessageKey: imgMsg.key
                }
            }
        };
        await relay(jid, vidContent, { messageId: makeMsgId(sock) });

        return imgMsg;
    }


    function previewDimension(ratio) {
        var map = {
            landscape: { height: 1080, width: 1920 },
            portrait: { height: 1920, width: 1080 },
            square: { height: 1080, width: 1080 }
        };
        return map[String(ratio || 'landscape').toLowerCase()] || map.landscape;
    }

    /**
     * Resolve Buffer | http(s) url | local path into a Buffer.
     * Unlike the previous version, network/file failures are NOT swallowed into
     * `null` — they throw a clear NexrayError so callers (e.g. sendThumbnailPreview)
     * can report *why* a thumbnail failed instead of a generic "required" message.
     */
    function resolveToBuffer(input, label) {
        return __awaiter(this, void 0, void 0, function () {
            var fs, res, err_1, urlOrPath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (input == null) return [2 /*return*/, null];
                        if (Buffer.isBuffer(input)) return [2 /*return*/, input];
                        // accept both raw strings and { url } / { path } wrapped objects
                        // (normalizeMediaInput wraps strings into { url } for baileys' own
                        // getStream — resolveToBuffer must unwrap that back to a string)
                        urlOrPath = typeof input === 'string' ? input
                            : (input && typeof input === 'object' ? (input.url || input.path) : null);
                        if (typeof urlOrPath !== 'string') return [2 /*return*/, null];
                        if (!/^https?:\/\//i.test(urlOrPath)) return [3 /*break*/, 5];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, fetch(urlOrPath)];
                    case 2:
                        res = _a.sent();
                        if (!res.ok) {
                            throw new errors_1.NexrayError(
                                (label || 'resolveToBuffer') + ': fetch failed for "' + urlOrPath + '" — HTTP ' + res.status + ' ' + res.statusText,
                                errors_1.ErrorCodes.MEDIA_DOWNLOAD
                            );
                        }
                        return [4 /*yield*/, res.arrayBuffer()];
                    case 3:
                        return [2 /*return*/, Buffer.from(_a.sent())];
                    case 4:
                        err_1 = _a.sent();
                        if (err_1 instanceof errors_1.NexrayError) throw err_1;
                        throw new errors_1.NexrayError(
                            (label || 'resolveToBuffer') + ': failed to fetch "' + urlOrPath + '" — ' + (err_1 && err_1.message),
                            errors_1.ErrorCodes.MEDIA_DOWNLOAD
                        );
                    case 5:
                        fs = require('fs');
                        if (!fs.existsSync(urlOrPath)) {
                            throw new errors_1.NexrayError((label || 'resolveToBuffer') + ': local file not found — ' + urlOrPath, errors_1.ErrorCodes.INVALID_MEDIA);
                        }
                        return [2 /*return*/, fs.readFileSync(urlOrPath)];
                }
            });
        });
    }

    /**
     * sendThumbnailPreview(jid, text, opts?, message?)
     */
    /**
     * sendThumbnailPreview(jid, text, quoted?, opts) — quoted positioned right before
     * the trailing options object, consistent with every other send helper.
     * Also accepts sendThumbnailPreview(jid, text, opts, quoted) since opts here is
     * commonly a large inline object that reads more naturally before the quoted `m`.
     * opts: { title, body, url, thumbnail, largeThumb, ratio, icon, duration, postType }
     */
    async function sendThumbnailPreview(jid, text, quoted, opts) {
        var options = opts;
        // detect (jid, text, opts, quoted) — 3rd arg looks like an options object
        // (has title/body/url/thumbnail) while the 4th looks like a message/quoted key
        var thirdIsOptions = quoted && typeof quoted === 'object' && !Array.isArray(quoted) &&
            (hasNonNullishProperty(quoted, 'title') || hasNonNullishProperty(quoted, 'thumbnail') ||
                hasNonNullishProperty(quoted, 'url') || hasNonNullishProperty(quoted, 'body') ||
                hasNonNullishProperty(quoted, 'largeThumb'));
        if (thirdIsOptions) {
            options = quoted;
            quoted = opts;
        }
        options = options || {};
        var q = resolveQuoted(quoted, options);
        var title = options.title || '';
        var body = options.body || options.description || '';
        var largeThumb = !!options.largeThumb;
        var ratio = options.ratio || 'landscape';
        var url = options.url || '';
        var duration = options.duration || 0;
        var postType = options.postType != null ? options.postType : 1;
        var messageId = options.messageId || makeMsgId(sock);

        var thumbBuffer = await resolveToBuffer(options.thumbnail, 'sendThumbnailPreview');

        var linkPreview = {
            'matched-text': url,
            title: title,
            description: body,
            previewType: 0
        };
        if (thumbBuffer) linkPreview.jpegThumbnail = thumbBuffer;

        var content;
        if (largeThumb) {
            if (!thumbBuffer) {
                throw new errors_1.NexrayError('sendThumbnailPreview: largeThumb requires a valid options.thumbnail', errors_1.ErrorCodes.INVALID_MEDIA);
            }
            var prepared = await baileys.prepareWAMessageMedia({ image: thumbBuffer }, {
                upload: sock.waUploadToServer,
                mediaTypeOverride: 'thumbnail-link'
            });
            var imageMsg = prepared.imageMessage;
            var dims = previewDimension(ratio);
            if (imageMsg) {
                imageMsg.height = dims.height;
                imageMsg.width = dims.width;
            }
            linkPreview.highQualityThumbnail = imageMsg;
            linkPreview.linkPreviewMetadata = {
                linkMediaDuration: duration,
                socialMediaPostType: postType
            };
            var iconBuffer = await resolveToBuffer(options.icon, 'sendThumbnailPreview icon');
            content = { text: text, linkPreview: linkPreview };
            if (iconBuffer) content.favicon = iconBuffer;
        }
        else {
            content = { text: text, linkPreview: linkPreview };
        }

        var msg = await generateWAMessage(jid, content, {
            userJid: sock.user && sock.user.id,
            quoted: (0, context_1.buildQuoted)(q) || undefined,
            messageId: messageId,
            upload: sock.waUploadToServer
        });
        await relay(jid, msg.message, { messageId: msg.key.id });
        return msg;
    }

    // AIRich / sendMetaMsg (neoxr payload style, ryuu richResponseMessage wire format)
    (0, airich_1.attachAIRich)(sock, {
        relay: relay,
        makeMsgId: function () { return makeMsgId(sock); },
        generateWAMessageFromContent: generateWAMessageFromContent
    });

    // Single attach point — every send helper above is a plain named function;
    // this is the only place `sock.<name> = ...` happens.
    Object.assign(sock, {
        sendText: sendText,
        reply: reply,
        sendReact: sendReact,
        sendImage: sendImage,
        sendVideo: sendVideo,
        sendAudio: sendAudio,
        sendFile: sendFile,
        sendLocation: sendLocation,
        sendAlbum: sendAlbum,
        sendAlbumMessage: sendAlbumMessage,
        sendInteractive: sendInteractive,
        sendIAMessage: sendIAMessage,
        sendButton: sendButton,
        sendCarousel: sendCarousel,
        sendSticker: sendSticker,
        sendStickerPack: sendStickerPack,
        sendPtv: sendPtv,
        sendPoll: sendPoll,
        sendQuiz: sendQuiz,
        sendPollResult: sendPollResult,
        sendQuizResult: sendQuizResult,
        pollResult: pollResult,
        sendEvent: sendEvent,
        sendContact: sendContact,
        copyNForward: copyNForward,
        sendFromAI: sendFromAI,
        sendProduct: sendProduct,
        groupStatus: groupStatus,
        sendStatusMentions: sendStatusMentions,
        sendLivePhoto: sendLivePhoto,
        sendThumbnailPreview: sendThumbnailPreview
    });

    return sock;
}

exports.attachSendHelpers = attachSendHelpers;
