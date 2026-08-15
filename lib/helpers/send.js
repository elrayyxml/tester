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
var airich_1 = require("./airich");

/**
 * Resolve baileys helpers from sock.engine / global require
 * Consumer must have baileys installed (peerDep).
 */
function getBaileys(sock) {
    // Optional override only — normal path: require peerDependency "baileys"
    if (sock && sock.__nexray && sock.__nexray.baileys)
        return sock.__nexray.baileys;
    try {
        return require('baileys');
    }
    catch (_a) {
        throw new errors_1.NexrayError(
            'Peer dependency "baileys" not found. Install it in your project: npm i baileys',
            errors_1.ErrorCodes.INVALID_OPTIONS
        );
    }
}

/**
 * Generate message id with optional prefix from Client options
 */
function makeMsgId(sock) {
    var prefix = (sock.__nexray && sock.__nexray.messageIdPrefix) || '';
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
    var baileys = getBaileys(sock);
    var generateWAMessage = baileys.generateWAMessage;
    var generateWAMessageFromContent = baileys.generateWAMessageFromContent;
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
    sock.sendText = function (jid, text, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, mentions, contextInfo, content, msg, messageId;
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
                        mentions = options.mentions || options.mentionedJid || [];
                        if (options.mentionAll && sock.groupMetadata) {
                            // best-effort: caller should pass mentions themselves for reliability
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: quoted || options.quoted,
                            mentions: mentions,
                            expiration: options.expiration,
                            extra: options.contextInfo
                        });
                        content = {
                            text: text,
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        if (options.linkPreview === false) {
                            // no preview
                        }
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
    };

    /**
     * sock.reply(jid, text, quoted, opts) — neoxr style
     */
    sock.reply = function (jid, text, quoted, opts) {
        return sock.sendText(jid, text, quoted, opts);
    };

    /**
     * sendReact(jid, emoji, key)
     */
    sock.sendReact = function (jid, emoji, key) {
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
            var prepareWAMessageMedia, mediaObj;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prepareWAMessageMedia = baileys.prepareWAMessageMedia;
                        if (!prepareWAMessageMedia) {
                            throw new errors_1.NexrayError('prepareWAMessageMedia not available in baileys', errors_1.ErrorCodes.NOT_IMPLEMENTED);
                        }
                        mediaObj = {};
                        if (typeof mediaInput === 'string' && /^https?:\/\//i.test(mediaInput)) {
                            mediaObj[type] = { url: mediaInput };
                        }
                        else if (Buffer.isBuffer(mediaInput)) {
                            mediaObj[type] = mediaInput;
                        }
                        else if (typeof mediaInput === 'string') {
                            mediaObj[type] = { url: mediaInput }; // local path also accepted by many baileys builds as url/path
                        }
                        else {
                            mediaObj[type] = mediaInput;
                        }
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
     * sendImage(jid, image, caption?, quoted?, opts?)
     * image: Buffer | path | url
     */
    sock.sendImage = function (jid, image, caption, quoted, opts) {
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
    sock.sendVideo = function (jid, video, caption, quoted, opts) {
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
    sock.sendAudio = function (jid, audio, quoted, opts) {
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
    sock.sendFile = function (jid, file, fileName, caption, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, name, cap, q, mimeGuess, media_util, lower;
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
                if (options.ptt || options.audio) {
                    return [2 /*return*/, sock.sendAudio(jid, file, q, Object.assign({}, options, { ptt: options.ptt !== false || !!options.ptt }))];
                }
                if (options.document) {
                    return [2 /*return*/, sendDocumentInternal(jid, file, name || 'file', cap, q, options)];
                }
                mimeGuess = options.mimetype || '';
                try {
                    media_util = require('../utils/media');
                    if (!mimeGuess && typeof file === 'string')
                        mimeGuess = media_util.getMimeType(file) || media_util.getMimeType(name) || '';
                }
                catch (_b) { }
                lower = (mimeGuess + ' ' + name).toLowerCase();
                if (options.image || /^image\//.test(mimeGuess) || /\.(jpe?g|png|gif|webp)$/i.test(name) || /\.(jpe?g|png|gif|webp)$/i.test(String(file))) {
                    return [2 /*return*/, sock.sendImage(jid, file, cap, q, options)];
                }
                if (options.video || options.ptv || /^video\//.test(mimeGuess) || /\.(mp4|mkv|mov|webm|3gp)$/i.test(name) || /\.(mp4|mkv|mov|webm|3gp)$/i.test(String(file))) {
                    return [2 /*return*/, sock.sendVideo(jid, file, cap, q, Object.assign({}, options, { ptv: options.ptv }))];
                }
                if (/^audio\//.test(mimeGuess) || /\.(mp3|ogg|opus|wav|m4a)$/i.test(name) || /\.(mp3|ogg|opus|wav|m4a)$/i.test(String(file))) {
                    return [2 /*return*/, sock.sendAudio(jid, file, q, options)];
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
    sock.sendLocation = function (jid, coords, quoted, opts) {
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
    sock.sendAlbum = function (jid, items, quoted, opts) {
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
                            if (it.image != null)
                                return { image: normalizeMediaInput(it.image), caption: caption };
                            if (it.video != null)
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
                            if (it && it.video)
                                videoCount++;
                            else if (it && it.image)
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
        if (!btn || typeof btn !== 'object')
            throw new errors_1.NexrayError('button must be object', errors_1.ErrorCodes.INVALID_OPTIONS);
        // Raw native-flow shape — pass through (messages.md interactiveButtons escape hatch)
        if (btn.name && (btn.buttonParamsJson != null || btn.paramsJson != null)) {
            var rawParams = btn.buttonParamsJson != null ? btn.buttonParamsJson : btn.paramsJson;
            return {
                name: btn.name,
                buttonParamsJson: typeof rawParams === 'string' ? rawParams : JSON.stringify(rawParams)
            };
        }
        var display = btn.text || btn.displayText || btn.display_text || ('Button ' + (index + 1));
        var id = btn.id || btn.buttonId || ('btn_' + (index + 1));

        // Explicit name from caller
        var name = btn.name || null;

        // ---- detect by fields / name ----
        // quick_reply
        if (name === 'quick_reply' || ((btn.id || btn.text || btn.displayText) && !btn.url && !btn.copy && !btn.copy_code && !btn.phone && !btn.phone_number && !btn.sections && !btn.reminder && !btn.address && !btn.location && name !== 'cta_call' && name !== 'cta_url' && name !== 'cta_copy' && name !== 'single_select' && name !== 'cta_reminder' && name !== 'cta_cancel_reminder' && name !== 'address_message' && name !== 'send_location')) {
            if (!name || name === 'quick_reply') {
                return {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify(Object.assign({ display_text: display, id: id }, btn.params || {}))
                };
            }
        }
        // cta_url
        if (name === 'cta_url' || btn.url || btn.cta_url) {
            return {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify(Object.assign({
                    display_text: display,
                    url: btn.url || btn.cta_url,
                    merchant_url: btn.merchant_url || btn.url || btn.cta_url,
                    webview_interaction: !!btn.webview_interaction
                }, btn.params || {}))
            };
        }
        // cta_copy
        if (name === 'cta_copy' || btn.copy || btn.copy_code) {
            return {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify(Object.assign({
                    display_text: display,
                    copy_code: btn.copy || btn.copy_code
                }, btn.params || {}))
            };
        }
        // cta_call
        if (name === 'cta_call' || btn.phone || btn.phone_number || btn.call) {
            return {
                name: 'cta_call',
                buttonParamsJson: JSON.stringify(Object.assign({
                    display_text: display,
                    phone_number: btn.phone || btn.phone_number || btn.call,
                    id: id
                }, btn.params || {}))
            };
        }
        // cta_reminder
        if (name === 'cta_reminder' || btn.reminder) {
            return {
                name: 'cta_reminder',
                buttonParamsJson: JSON.stringify(Object.assign({
                    display_text: display,
                    id: id
                }, typeof btn.reminder === 'object' ? btn.reminder : {}, btn.params || {}))
            };
        }
        // cta_cancel_reminder
        if (name === 'cta_cancel_reminder' || btn.cancel_reminder) {
            return {
                name: 'cta_cancel_reminder',
                buttonParamsJson: JSON.stringify(Object.assign({
                    display_text: display,
                    id: id
                }, btn.params || {}))
            };
        }
        // address_message
        if (name === 'address_message' || btn.address) {
            return {
                name: 'address_message',
                buttonParamsJson: JSON.stringify(Object.assign({
                    display_text: display,
                    id: id
                }, typeof btn.address === 'object' ? btn.address : {}, btn.params || {}))
            };
        }
        // send_location
        if (name === 'send_location' || btn.location === true || (btn.location && typeof btn.location === 'object' && !btn.lat)) {
            return {
                name: 'send_location',
                buttonParamsJson: JSON.stringify(Object.assign({}, typeof btn.location === 'object' ? btn.location : {}, btn.params || {}))
            };
        }
        // single_select / list
        if (name === 'single_select' || btn.sections) {
            return {
                name: 'single_select',
                buttonParamsJson: JSON.stringify({
                    title: btn.title || 'Tap!',
                    sections: btn.sections || []
                })
            };
        }
        // Fallback: if name provided with params object
        if (name) {
            return {
                name: name,
                buttonParamsJson: JSON.stringify(btn.params || btn.buttonParams || {
                    display_text: display,
                    id: id
                })
            };
        }
        // default quick_reply
        return {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: display, id: id })
        };
    }

    /**
     * sendInteractive(jid, buttons, quoted?, opts?)
     * Unified interactive / nativeFlow / carousel.
     */
    sock.sendInteractive = function (jid, buttons, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, processedButtons, i, messageContent, bodyText, prepared, headerMedia, cards, c, imgPrepared, card, nativeFlow, payload, viewOnce, msg, additionalNodes, ctx;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && !quoted.key && !quoted.id && !quoted.chat && typeof quoted === 'object') {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        if (!Array.isArray(buttons))
                            buttons = options.buttons || [];
                        processedButtons = [];
                        for (i = 0; i < buttons.length; i++) {
                            processedButtons.push(normalizeButton(buttons[i], i));
                        }
                        messageContent = {};
                        bodyText = options.text || options.content || options.body || options.caption || '';
                        if (!(options.image || options.media || options.video)) return [3 /*break*/, 2];
                        return [4 /*yield*/, prepareMedia(options.image || options.media || options.video, options.video ? 'video' : 'image', options)];
                    case 1:
                        prepared = _a.sent();
                        headerMedia = prepared;
                        messageContent.header = Object.assign({
                            title: options.title || options.header || '',
                            hasMediaAttachment: true
                        }, headerMedia.imageMessage ? { imageMessage: headerMedia.imageMessage } : {}, headerMedia.videoMessage ? { videoMessage: headerMedia.videoMessage } : {});
                        return [3 /*break*/, 3];
                    case 2:
                        if (options.title || options.header) {
                            messageContent.header = {
                                title: options.title || options.header || '',
                                hasMediaAttachment: false
                            };
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
    sock.sendIAMessage = sock.sendInteractive;
    sock.sendButton = sock.sendInteractive;
    sock.sendAlbumMessage = sock.sendAlbum;

    /**
     * sendCarousel(jid, cards, quoted?, opts?)
     * Neoxr style:
     *   cards = [{ header: { imageMessage|hasMediaAttachment }, body: { text }, nativeFlowMessage: { buttons } }]
     *   opts = { content: 'Hi!' }
     */
    sock.sendCarousel = function (jid, cards, quoted, opts) {
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
                return [2 /*return*/, sock.sendInteractive(jid, [], quoted, Object.assign({}, options, {
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
    sock.sendSticker = function (jid, sticker, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, contextInfo, messageId, msg;
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
                        return [4 /*yield*/, generateWAMessage(jid, {
                                sticker: normalizeMediaInput(sticker),
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId,
                                upload: sock.waUploadToServer
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
     * sendPtv(jid, video, quoted?, opts?) — video note (ptv)
     * Neoxr: sendPtv(chat, path)
     */
    sock.sendPtv = function (jid, video, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q;
            return __generator(this, function (_a) {
                options = opts || {};
                if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                    options = quoted;
                    quoted = options.quoted || null;
                }
                q = resolveQuoted(quoted, options);
                return [2 /*return*/, sock.sendVideo(jid, video, options.caption || '', q, Object.assign({}, options, { ptv: true }))];
            });
        });
    };

    /**
     * sendPoll(jid, name, options?)
     * Neoxr: sendPoll(chat, 'Question?', { options: ['Yes','No'], multiselect: false })
     * Also: sendPoll(chat, 'Q?', ['Yes','No'], quoted)
     */
    sock.sendPoll = function (jid, name, optsOrValues, quoted) {
        return __awaiter(this, void 0, void 0, function () {
            var options, values, selectableCount, q, contextInfo, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = {};
                        values = [];
                        if (Array.isArray(optsOrValues)) {
                            values = optsOrValues;
                            options = {};
                        }
                        else if (optsOrValues && typeof optsOrValues === 'object') {
                            options = optsOrValues;
                            values = options.options || options.values || [];
                            if (options.quoted)
                                quoted = options.quoted;
                        }
                        selectableCount = options.multiselect ? values.length : (options.selectableCount != null ? options.selectableCount : 1);
                        q = resolveQuoted(quoted, options);
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            mentions: options.mentions || options.mentionedJid,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        return [4 /*yield*/, generateWAMessage(jid, {
                                poll: {
                                    name: name,
                                    values: values,
                                    selectableCount: selectableCount
                                },
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
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
    };

    /**
     * sendContact(jid, contacts, quoted?, opts?)
     * Neoxr:
     *   sendContact(chat, [{ name, number, about }], m, { org, website, email })
     */
    sock.sendContact = function (jid, contacts, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, list, i, c, number, vcard, displayName, contextInfo, messageId, content, msg;
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
                            number = String(c.number || c.phone || c.id || '').replace(/\D/g, '');
                            displayName = c.name || c.fullName || number;
                            vcard = 'BEGIN:VCARD\n' +
                                'VERSION:3.0\n' +
                                'FN:' + displayName + '\n' +
                                (c.org || options.org ? ('ORG:' + (c.org || options.org) + '\n') : '') +
                                'TEL;type=CELL;type=VOICE;waid=' + number + ':+' + number + '\n' +
                                (c.about ? ('NOTE:' + c.about + '\n') : '') +
                                (options.email || c.email ? ('EMAIL:' + (c.email || options.email) + '\n') : '') +
                                (options.website || c.website ? ('URL:' + (c.website || options.website) + '\n') : '') +
                                'END:VCARD';
                            list.push({
                                displayName: displayName,
                                vcard: vcard
                            });
                        }
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            mentions: options.mentions || options.mentionedJid,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        content = list.length === 1
                            ? {
                                contacts: {
                                    displayName: list[0].displayName,
                                    contacts: list
                                },
                                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                            }
                            : {
                                contacts: {
                                    displayName: (options.title || (list.length + ' contacts')),
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
    };


    /**
     * copyNForward(jid, message, forceForward?, opts?)
     * Forward a serialized m / raw WAMessage to jid.
     */
    sock.copyNForward = function (jid, message, forceForward, opts) {
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
    sock.sendFromAI = function (jid, text, quoted, opts) {
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
    sock.sendProduct = function (jid, product, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, contextInfo, messageId, productImageMessage, mediaInput, prepared, price, body, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        if (!product || typeof product !== 'object') {
                            throw new errors_1.NexrayError('sendProduct expects a product object', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        productImageMessage = null;
                        if (!(product.productImage || product.image)) return [3 /*break*/, 2];
                        mediaInput = { image: normalizeMediaInput(product.productImage || product.image) };
                        return [4 /*yield*/, prepareMedia(product.productImage || product.image, 'image', options)];
                    case 1:
                        prepared = _a.sent();
                        productImageMessage = (prepared && prepared.imageMessage) ? prepared.imageMessage : prepared;
                        _a.label = 2;
                    case 2:
                        price = product.priceAmount1000 != null
                            ? parseInt(product.priceAmount1000, 10)
                            : (product.price != null ? Math.round(Number(product.price) * 1000) : 0);
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            mentions: options.mentions || options.mentionedJid,
                            extra: options.contextInfo
                        });
                        messageId = options.messageId || makeMsgId(sock);
                        body = {
                            productMessage: {
                                product: {
                                    productImage: productImageMessage,
                                    productId: product.productId || product.id || '',
                                    title: product.title || options.title || 'Product',
                                    description: product.description || product.desc || '',
                                    currencyCode: product.currencyCode || product.currency || 'IDR',
                                    priceAmount1000: price,
                                    retailerId: product.retailerId || product.retailer || '',
                                    url: product.url || '',
                                    productImageCount: product.productImageCount || (productImageMessage ? 1 : 0)
                                },
                                businessOwnerJid: product.businessOwnerJid || options.businessOwnerJid || (sock.user && sock.user.id) || ''
                            }
                        };
                        if (Object.keys(contextInfo).length) {
                            body.productMessage.contextInfo = contextInfo;
                        }
                        return [4 /*yield*/, generateWAMessage(jid, body, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId,
                                upload: sock.waUploadToServer
                            })];
                    case 3:
                        msg = _a.sent();
                        // ensure productMessage shape if generateWAMessage rewrote it
                        if (!msg.message)
                            msg.message = body;
                        return [4 /*yield*/, relay(jid, msg.message, { messageId: msg.key.id })];
                    case 4:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };


    /**
     * sendStickerPack(jid, packData, quoted?, opts?)
     * packData: {
     *   name, publisher, description?,
     *   cover: Buffer|path|url (webp/image for tray),
     *   stickers: [{ data: Buffer, emojis?: string[] }]
     * }
     * Based on ryuu stickerPackMessage relay pattern.
     */
    sock.sendStickerPack = function (jid, packData, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, name, publisher, description, cover, stickers, prepareWAMessageMedia, mediaMessage, docInfo, crypto, formattedStickers, i, s, hash, safeFileName, stickerPackId, stickerPackMessage, contextInfo;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = resolveQuoted(quoted, options);
                        if (!packData || typeof packData !== 'object') {
                            throw new errors_1.NexrayError('sendStickerPack expects packData object', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        name = packData.name || 'Sticker Pack';
                        publisher = packData.publisher || packData.author || '';
                        description = packData.description || '';
                        cover = packData.cover;
                        stickers = packData.stickers || [];
                        if (!cover) {
                            throw new errors_1.NexrayError('sendStickerPack requires packData.cover', errors_1.ErrorCodes.INVALID_MEDIA);
                        }
                        if (!Array.isArray(stickers) || stickers.length === 0) {
                            throw new errors_1.NexrayError('sendStickerPack requires packData.stickers[]', errors_1.ErrorCodes.INVALID_OPTIONS);
                        }
                        prepareWAMessageMedia = baileys.prepareWAMessageMedia;
                        return [4 /*yield*/, prepareWAMessageMedia({
                                document: normalizeMediaInput(cover),
                                mimetype: 'image/webp',
                                fileName: 'cover.webp'
                            }, { upload: sock.waUploadToServer })];
                    case 1:
                        mediaMessage = _a.sent();
                        docInfo = mediaMessage.documentMessage || mediaMessage.imageMessage;
                        if (!docInfo) {
                            throw new errors_1.NexrayError('Failed to upload sticker pack cover', errors_1.ErrorCodes.MEDIA_PROCESS);
                        }
                        crypto = require('crypto');
                        formattedStickers = [];
                        for (i = 0; i < stickers.length; i++) {
                            s = stickers[i];
                            hash = crypto.createHash('sha256').update(s.data || s.buffer || s).digest('base64');
                            safeFileName = hash.replace(/\+/g, '-').replace(/\//g, '_') + '.webp';
                            formattedStickers.push({
                                fileName: safeFileName,
                                isAnimated: !!s.isAnimated,
                                emojis: s.emojis || ['🎨'],
                                accessibilityLabel: s.accessibilityLabel || '',
                                isLottie: !!s.isLottie,
                                mimetype: s.mimetype || 'image/webp'
                            });
                        }
                        stickerPackId = makeMsgId(sock);
                        contextInfo = (0, context_1.buildContextInfo)({
                            quoted: q,
                            extra: options.contextInfo
                        });
                        stickerPackMessage = {
                            stickerPackId: stickerPackId,
                            name: name,
                            publisher: publisher,
                            packDescription: description,
                            stickers: formattedStickers,
                            fileLength: docInfo.fileLength,
                            fileSha256: docInfo.fileSha256,
                            fileEncSha256: docInfo.fileEncSha256,
                            mediaKey: docInfo.mediaKey,
                            directPath: docInfo.directPath,
                            mediaKeyTimestamp: docInfo.mediaKeyTimestamp || Math.floor(Date.now() / 1000).toString(),
                            trayIconFileName: stickerPackId + '.webp',
                            imageDataHash: docInfo.fileSha256 ? (Buffer.isBuffer(docInfo.fileSha256) ? docInfo.fileSha256.toString('base64') : docInfo.fileSha256) : '',
                            stickerPackSize: docInfo.fileLength,
                            stickerPackOrigin: 'THIRD_PARTY',
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        return [4 /*yield*/, relay(jid, { stickerPackMessage: stickerPackMessage }, {
                                messageId: options.messageId || stickerPackId
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, { key: { remoteJid: jid, id: stickerPackId }, message: { stickerPackMessage: stickerPackMessage } }];
                }
            });
        });
    };

    // AIRich / sendMetaMsg (neoxr payload style, ryuu richResponseMessage wire format)
    (0, airich_1.attachAIRich)(sock, {
        relay: relay,
        makeMsgId: function () { return makeMsgId(sock); },
        generateWAMessageFromContent: generateWAMessageFromContent
    });

    return sock;
}

exports.attachSendHelpers = attachSendHelpers;
