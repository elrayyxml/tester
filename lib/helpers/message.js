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
var engine_1 = require("../core/engine");
var generic_1 = require("./generic");
var sticker_1 = require("./sticker");
var hasNonNullishProperty = functions_1.hasNonNullishProperty;

/** Generate message id, honoring `custom_id` (readable prefix) and `stealth` */
/** Inject sticker-pack paths into baileys Defaults when missing (upstream forks often omit them). */
/** Normalize media input for baileys generateWAMessage / prepareWAMessageMedia. */
function normalizeMediaInput(input) {
    if (input == null) return input;
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === 'object') {
        if (input.url != null) return { url: String(input.url) };
        if (input.stream) return input;
        return input;
    }
    if (typeof input === 'string') {
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
    return null;
}

/** Attach all stage-2 send helpers onto the socket (mutate in-place). */
function attachSendHelpers(sock) {
    var baileys = engine_1.getEngine(sock);
    function generateWAMessage() {
        return engine_1.fn(sock, 'generateWAMessage').apply(null, arguments);
    }
    function generateWAMessageFromContent() {
        return engine_1.fn(sock, 'generateWAMessageFromContent').apply(null, arguments);
    }
    var proto = baileys.proto;

    /** Core relay path — prefer relayMessage over sendMessage. */
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
                return [2 , sock.relayMessage(jid, message, options || {})];
            });
        });
    }

    /** sendText(jid, text, quoted?, opts?) */
    /** sendText(jid, text, quoted?, opts) */
    function sendText(jid, text, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, contextInfo, content, msg, messageId;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!jid)
                            throw new errors_1.NexrayError('sendText: jid required', errors_1.ErrorCodes.INVALID_JID);
                        options = opts || {};
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
                            mentions: options.mentions || options.mentionedJid || undefined,
                            mentionAll: !!options.mentionAll,
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        return [4 , generateWAMessage(jid, content, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(quoted || options.quoted) || undefined,
                                messageId: messageId,
                                ephemeralExpiration: options.expiration
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 , relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalAttributes: options.additionalAttributes,
                                additionalNodes: options.additionalNodes
                            })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
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
                        messageId = generic_1.makeMsgId(sock);
                        return [4 , generateWAMessage(jid, {
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
                        return [4 , relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
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
                        if (typeof mediaInput === 'object' && !Buffer.isBuffer(mediaInput) && !mediaInput.url && !mediaInput.stream &&
                            (mediaInput.location || mediaInput.degreesLatitude != null || mediaInput.productImage)) {
                            throw new errors_1.NexrayError('prepareMedia: invalid media input (location/product object). Use dedicated header path.', errors_1.ErrorCodes.INVALID_MEDIA);
                        }
                        mediaObj = {};
                        normalized = normalizeMediaInput(mediaInput);
                        mediaObj[type] = normalized;
                        return [4 , prepareWAMessageMedia(mediaObj, {
                                upload: sock.waUploadToServer,
                                mediaTypeOverride: options && options.mediaTypeOverride
                            })];
                    case 1: return [2 , _a.sent()];
                }
            });
        });
    }

    function normalizeQuotedOptions(quoted, opts) {
        var options = opts || {};

        if (
            quoted &&
            typeof quoted === 'object' &&
            !quoted.key &&
            !quoted.id &&
            !quoted.chat &&
            !quoted.remoteJid
        ) {
            options = Object.assign({}, quoted, options);
            quoted = options.quoted || null;
        }

        return {
            quoted: resolveQuoted(quoted, options),
            options: options
        };
    }

    function sendGenerated(jid, content, quoted, options) {
        return __awaiter(this, void 0, void 0, function () {
            var normalized, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        normalized = normalizeQuotedOptions(quoted, options);
                messageId = normalized.options.messageId || generic_1.makeMsgId(sock);

                return [4, generateWAMessage(jid, content, {
                    userJid: sock.user && sock.user.id,
                    quoted: (0, context_1.buildQuoted)(normalized.quoted) || undefined,
                    messageId: messageId,
                    upload: sock.waUploadToServer,
                    ephemeralExpiration: normalized.options.expiration
                })];
            case 1:
                msg = _a.sent();
                return [4, relay(jid, msg.message, {
                    messageId: msg.key.id,
                    additionalAttributes: normalized.options.additionalAttributes,
                    additionalNodes: normalized.options.additionalNodes
                })];
            case 2:
                _a.sent();
                return [2, msg];
            }
        });
        });
    }

    function sendImage(jid, image, caption, quoted, opts) {
        var options = opts || {};
        return sendGenerated(jid, {
            image: normalizeMediaInput(image),
            caption: caption || options.caption,
            mentions: options.mentions || options.mentionedJid,
            contextInfo: options.contextInfo
        }, quoted, options);
    }

    function sendVideo(jid, video, caption, quoted, opts) {
        var options = opts || {};
        return sendGenerated(jid, {
            video: normalizeMediaInput(video),
            caption: caption || options.caption,
            ptv: Boolean(options.ptv),
            gifPlayback: Boolean(options.gifPlayback),
            mentions: options.mentions || options.mentionedJid,
            contextInfo: options.contextInfo
        }, quoted, options);
    }

    function sendAudio(jid, audio, quoted, opts) {
        var options = opts || {};
        return sendGenerated(jid, {
            audio: normalizeMediaInput(audio),
            ptt: Boolean(options.ptt),
            mimetype: options.mimetype,
            seconds: options.seconds
        }, quoted, options);
    }

    function sendFile(jid, file, fileName, quoted, opts) {
        var options = opts || {};

        if (fileName && typeof fileName === 'object') {
            options = Object.assign({}, fileName, options);
            fileName = options.fileName;
            quoted = options.quoted || quoted;
        }

        return sendGenerated(jid, {
            document: normalizeMediaInput(file),
            fileName: fileName || options.fileName || 'file',
            mimetype: options.mimetype || 'application/octet-stream',
            caption: options.caption
        }, quoted, options);
    }

    function sendLocation(jid, location, quoted, opts) {
        var options = opts || {};
        if (!location || typeof location !== 'object') {
            throw new errors_1.NexrayError(
                'sendLocation requires a location object.',
                errors_1.ErrorCodes.INVALID_OPTIONS
            );
        }

        return sendGenerated(jid, {
            location: {
                degreesLatitude: Number(location.degreesLatitude ?? location.lat ?? 0),
                degreesLongitude: Number(location.degreesLongitude ?? location.lng ?? 0),
                name: location.name || '',
                address: location.address || '',
                jpegThumbnail: location.jpegThumbnail || location.thumbnail
            }
        }, quoted, options);
    }

    function sendAlbum(jid, items, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var normalized, options, mediaItems, imageCount, videoCount, parent, parentMessage, index, item, content, mediaMessage, message, messageSecret, albumContext;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        normalized = normalizeQuotedOptions(quoted, opts);
                        options = normalized.options;
                        mediaItems = Array.isArray(items) ? items : [];

                        if (mediaItems.length < 2) {
                            throw new errors_1.NexrayError(
                                'sendAlbum requires at least two media items.',
                                errors_1.ErrorCodes.INVALID_OPTIONS
                            );
                        }

                        imageCount = mediaItems.filter(function (item) {
                            return hasNonNullishProperty(item, 'image');
                        }).length;

                        videoCount = mediaItems.filter(function (item) {
                            return hasNonNullishProperty(item, 'video');
                        }).length;

                        if (imageCount + videoCount !== mediaItems.length) {
                            throw new errors_1.NexrayError(
                                'sendAlbum accepts image and video items only.',
                                errors_1.ErrorCodes.INVALID_MEDIA
                            );
                        }

                        return [4, generateWAMessage(jid, {
                            album: {
                                expectedImageCount: imageCount,
                                expectedVideoCount: videoCount
                            }
                        }, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(normalized.quoted) || undefined,
                            messageId: options.messageId || generic_1.makeMsgId(sock)
                        })];

                    case 1:
                        parent = _a.sent();
                        parentMessage = parent.message;
                        return [4, relay(jid, parentMessage, {
                            messageId: parent.key.id,
                            additionalNodes: options.additionalNodes
                        })];

                    case 2:
                        _a.sent();
                        index = 0;
                        _a.label = 3;

                    case 3:
                        if (!(index < mediaItems.length)) return [3, 8];

                        item = mediaItems[index];
                        content = Object.assign({}, item, {
                            albumParentKey: parent.key
                        });
                        messageSecret = randomMediaSecret();
                        return [4, generateWAMessage(jid, content, {
                            userJid: sock.user && sock.user.id,
                            upload: sock.waUploadToServer,
                            ephemeralExpiration: options.expiration
                        })];

                    case 4:
                        mediaMessage = _a.sent();
                        message = mediaMessage.message || {};
                        albumContext = Object.assign({}, message.messageContextInfo || {}, {
                            messageSecret: messageSecret,
                            messageAssociation: {
                                associationType: 1,
                                parentMessageKey: parent.key
                            }
                        });
                        message.messageContextInfo = albumContext;
                        return [4, relay(jid, message, {
                            messageId: mediaMessage.key.id,
                            additionalNodes: options.additionalNodes
                        })];

                    case 5:
                        _a.sent();
                        index++;
                        return [3, 3];

                    case 8:
                        return [2, parent];
                }
            });
        });
    }

    function randomMediaSecret() {
        var secret = new Uint8Array(32);
        require('crypto').randomFillSync(secret);
        return secret;
    }

    /**
     * Build a native-flow header.
     *
     * Interactive headers support media messages such as image/video. A
     * location object is not a valid interactive header media type, so when
     * `media.location.jpegThumbnail` is supplied, its thumbnail is promoted
     * to an image header instead of being inserted as `locationMessage`.
     */
    /**
     * Build a native-flow interactive header.
     *
     * Location headers intentionally keep `media.location` as a location
     * payload. The location may carry a JPEG thumbnail, image/video media,
     * and contextInfo. Do not promote the thumbnail to a standalone image
     * header because that changes the semantic type of the header.
     */
    function buildInteractiveHeader(options) {
        return __awaiter(this, void 0, void 0, function () {
            var title, media, location, thumbnail, thumbBuffer, locationMessage, ctx, prepared, header;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        title =
                            (typeof options.title === 'string' ? options.title : '') ||
                            (typeof options.header === 'string' ? options.header : '') ||
                            (options.header && options.header.title) ||
                            '';

                        media = options.media;

                        if (media && typeof media === 'object' && media.location) {
                            location = media.location;
                        } else if (
                            options.header &&
                            typeof options.header === 'object' &&
                            options.header.location
                        ) {
                            location = options.header.location;
                        } else if (options.location && typeof options.location === 'object') {
                            location = options.location;
                        }

                        if (!location) {
                            if (
                                options.video ||
                                options.image ||
                                typeof media === 'string' ||
                                Buffer.isBuffer(media) ||
                                (media && typeof media === 'object' && (media.url || media.stream))
                            ) {
                                return [4, prepareMedia(
                                    options.video || options.image || media,
                                    options.video ? 'video' : 'image',
                                    options
                                )];
                            }

                            return [3, 3];
                        }

                        thumbnail =
                            location.jpegThumbnail ||
                            location.thumbnail ||
                            location.thumb ||
                            null;

                        return [4, resolveHeaderThumbnail(thumbnail)];

                    case 1:
                        thumbBuffer = _a.sent();

                        locationMessage = {
                            degreesLatitude: location.degreesLatitude != null
                                ? location.degreesLatitude
                                : (location.lat || 0),
                            degreesLongitude: location.degreesLongitude != null
                                ? location.degreesLongitude
                                : (location.lng || 0),
                            name: location.name || title || '',
                            address: location.address || '',
                            url: location.url || ''
                        };

                        if (thumbBuffer) {
                            locationMessage.jpegThumbnail = thumbBuffer;
                        }

                        if (location.accuracyInMeters != null) {
                            locationMessage.accuracyInMeters = location.accuracyInMeters;
                        }

                        if (location.speedInMps != null) {
                            locationMessage.speedInMps = location.speedInMps;
                        }

                        if (location.degreesClockwiseFromMagneticNorth != null) {
                            locationMessage.degreesClockwiseFromMagneticNorth =
                                location.degreesClockwiseFromMagneticNorth;
                        }

                        if (location.comment) {
                            locationMessage.comment = location.comment;
                        }

                        if (location.contextInfo || options.contextInfo) {
                            ctx = (0, context_1.buildContextInfo)({
                                mentions: options.mentions || options.mentionedJid,
                                extra: Object.assign(
                                    {},
                                    options.contextInfo || {},
                                    location.contextInfo || {}
                                )
                            });

                            if (Object.keys(ctx).length) {
                                locationMessage.contextInfo = ctx;
                            }
                        }

                        if (location.image || location.video) {
                            return [4, prepareMedia(
                                location.video || location.image,
                                location.video ? 'video' : 'image',
                                options
                            )];
                        }

                        header = {
                            title: title,
                            hasMediaAttachment: true,
                            locationMessage: locationMessage
                        };

                        return [2, header];

                    case 2:
                        prepared = _a.sent();
                        header = {
                            title: title,
                            hasMediaAttachment: true,
                            locationMessage: locationMessage
                        };

                        if (prepared.imageMessage) {
                            header.imageMessage = prepared.imageMessage;
                        }

                        if (prepared.videoMessage) {
                            header.videoMessage = prepared.videoMessage;
                        }

                        return [2, header];

                    case 3:
                        return [2, title ? {
                            title: title,
                            hasMediaAttachment: false
                        } : null];
                }
            });
        });
    }

    /**
     * Resolve location thumbnails without changing the public payload shape.
     */
    async function resolveHeaderThumbnail(input) {
        if (input == null) return null;
        if (Buffer.isBuffer(input)) return input;

        var value = typeof input === 'object'
            ? (input.url || input.path)
            : input;

        if (typeof value !== 'string') return null;

        if (/^https?:\/\//i.test(value)) {
            return resolveToBuffer(value, 'sendInteractive location thumbnail');
        }

        try {
            var fs = require('fs');
            if (fs.existsSync(value)) {
                return fs.readFileSync(value);
            }
        } catch (_e) {
            return null;
        }

        return null;
    }

    function serializeJsonOption(value, fieldName) {
        if (value == null) return '';
        if (typeof value === 'string') {
            try {
                JSON.parse(value);
                return value;
            } catch (_e) {
                throw new errors_1.NexrayError(
                    fieldName + ' must contain valid JSON.',
                    errors_1.ErrorCodes.INVALID_OPTIONS
                );
            }
        }

        try {
            return JSON.stringify(value);
        } catch (_e) {
            throw new errors_1.NexrayError(
                fieldName + ' must be JSON serializable.',
                errors_1.ErrorCodes.INVALID_OPTIONS
            );
        }
    }

    /**
     * Normalize button entry to nativeFlow shape { name, buttonParamsJson }
     */

    function normalizeButton(btn, index) {
        if (!btn || typeof btn !== 'object') {
            throw new errors_1.NexrayError(
                'Interactive button ' + (index + 1) + ' must be an object.',
                errors_1.ErrorCodes.INVALID_OPTIONS
            );
        }

        if (!btn.name) {
            throw new errors_1.NexrayError(
                'Interactive button ' + (index + 1) + ' requires a name.',
                errors_1.ErrorCodes.INVALID_OPTIONS
            );
        }

        var params = btn.buttonParamsJson;
        if (params == null) {
            params = btn.paramsJson != null ? btn.paramsJson : btn.params;
        }

        return {
            name: String(btn.name),
            buttonParamsJson: serializeJsonOption(params || {}, 'Interactive button parameters')
        };
    }



    /** sendInteractive(jid, buttons, quoted?, opts?) */
    function sendInteractive(jid, buttons, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {

            var options, processedButtons, i, messageContent, bodyText, prepared, headerMedia, cards, c, imgPrepared, card, nativeFlow, payload, viewOnce, msg, additionalNodes, ctx;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!jid)
                            throw new errors_1.NexrayError('sendInteractive requires a destination JID.', errors_1.ErrorCodes.INVALID_JID);
                        options = opts || {};
                        (function normalizeInteractiveArgs() {
                            function isMsg(o) {
                                return !!(o && typeof o === 'object' && !Array.isArray(o) && (o.key || o.message));
                            }
                            function isContent(o) {
                                return !!(o && typeof o === 'object' && !Array.isArray(o) && (
                                    o.interactiveButtons || o.buttons || o.text || o.content ||
                                    o.header || o.media || o.messageParamsJson || o.footer || o.title
                                ));
                            }
                            // (jid, message, content)
                            if (isMsg(buttons) && isContent(quoted)) {
                                options = Object.assign({}, quoted, options);
                                quoted = buttons;
                                buttons = options.interactiveButtons || options.buttons || [];
                                return;
                            }
                            // (jid, content, message?)
                            if (isContent(buttons)) {
                                options = Object.assign({}, buttons, options);
                                buttons = options.interactiveButtons || options.buttons || [];
                                if (!isMsg(quoted))
                                    quoted = options.quoted || null;
                                return;
                            }
                            // (jid, buttons[], message, opts) — visible form
                            if (Array.isArray(buttons)) {
                                if (isMsg(quoted)) {
                                    options = Object.assign({}, options, opts || {});
                                }
                                else if (isContent(quoted)) {
                                    options = Object.assign({}, quoted, opts || {});
                                    quoted = options.quoted || null;
                                }
                                return;
                            }
                        })();
                        quoted = resolveQuoted(quoted, options);
                        if (!Array.isArray(buttons) || buttons.length === 0)
                            buttons = options.interactiveButtons || options.buttons || [];
                        processedButtons = [];
                        for (i = 0; i < buttons.length; i++) {
                            processedButtons.push(normalizeButton(buttons[i], i));
                        }
                        messageContent = {};
                        bodyText = options.text || options.content || options.body || options.caption || '';
                        return [4 , buildInteractiveHeader(options)];
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
                        if (!(options.carousel && Array.isArray(options.carousel) && options.carousel.length)) return [3 , 8];
                        cards = [];
                        i = 0;
                        _a.label = 4;
                    case 4:
                        if (!(i < options.carousel.length)) return [3 , 7];
                        c = options.carousel[i];
                        return [4 , prepareMedia(c.image || c.media, 'image', options)];
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
                        return [3 , 4];
                    case 7:
                        messageContent.carouselMessage = { cards: cards };
                        _a.label = 8;
                    case 8:
                        if (processedButtons.length && !messageContent.carouselMessage) {
                            nativeFlow = { buttons: processedButtons };
                            var params = {};
                            if (options.messageParamsJson) {
                                var rawParams = serializeJsonOption(
                                    options.messageParamsJson,
                                    'messageParamsJson'
                                );
                                params = rawParams ? JSON.parse(rawParams) : {};
                            }
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
                            messageId: options.messageId || generic_1.makeMsgId(sock)
                        });
                        additionalNodes = options.additionalNodes || nodes_1.NODES.mixed;
                        return [4 , relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalNodes: additionalNodes
                            })];
                    case 9:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    };

    var sendIAMessage = sendInteractive;
    var sendButton = sendInteractive;
    var sendAlbumMessage = sendAlbum;

    /** sendCarousel(jid, cards, quoted?, opts?) */
    function sendCarousel(jid, cards, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, normalized;
            return __generator(this, function (_a) {
                options = opts || {};
                if (quoted && !quoted.key && !quoted.id && !quoted.chat && typeof quoted === 'object') {
                    options = quoted;
                    quoted = options.quoted || null;
                }
                normalized = (cards || []).map(function (c) {
                    if (c.image || c.media) return c;
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
                return [2 , sendInteractive(jid, [], quoted, Object.assign({}, options, {
                        text: options.content || options.text || options.body || '',
                        content: options.content || options.text,
                        carousel: normalized
                    }))];
            });
        });
    };

    /** sendSticker(jid, sticker, quoted?, opts?) */

    /** sendSticker(jid, sticker, quoted?, opts?) */

    /** sendSticker(jid, sticker, quoted?, opts?) */
    /** sendSticker(jid, media, quoted?, opts?) */
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
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        return [4 , sticker_1.prepareStickerBuffer(sticker, {
                                packname: String(options.packname || options.pack || options.name).trim() || '',
                                author: String(options.author || options.publisher).trim() || '',
                                emojis: options.emojis,
                                isAvatar: isAvatar,
                                isAi: isAi,
                                isPremium: isPremium
                            }, resolveToBuffer)];
                    case 1:
                        taggedWebp = _a.sent();
                        return [4 , baileys.prepareWAMessageMedia({ sticker: taggedWebp }, { upload: sock.waUploadToServer })];
                    case 2:
                        prepared = _a.sent();
                        stickerMessage = Object.assign({}, prepared.stickerMessage || {});
                        if (options.isAnimated != null)
                            stickerMessage.isAnimated = !!options.isAnimated;
                        if (isAvatar)
                            stickerMessage.isAvatar = true;
                        if (isAi)
                            stickerMessage.isAiSticker = true;
                        if (isLottie)
                            stickerMessage.isLottie = true;
                        if (options.accessibilityLabel)
                            stickerMessage.accessibilityLabel = String(options.accessibilityLabel);
                        if (isPremium)
                            stickerMessage.premium = typeof options.premium === 'number' ? options.premium : 1;
                        if (options.emojis != null) {
                            stickerMessage.emojis = Array.isArray(options.emojis)
                                ? options.emojis.join('')
                                : String(options.emojis);
                        }
                        msgContent = { stickerMessage: stickerMessage };
                        if (isLottie) {
                            msgContent = { lottieStickerMessage: { message: { stickerMessage: stickerMessage } } };
                        }
                        if (isLocked || isPremium) {
                            msgContent.messageContextInfo = {
                                limitSharingV2: {
                                    sharingLimited: true,
                                    trigger: 1,
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
                        (function reapply() {
                            try {
                                var root = msg.message || msgContent;
                                var sm = root.stickerMessage
                                    || (root.lottieStickerMessage && root.lottieStickerMessage.message && root.lottieStickerMessage.message.stickerMessage);
                                if (!sm)
                                    return;
                                if (isAvatar)
                                    sm.isAvatar = true;
                                if (isAi)
                                    sm.isAiSticker = true;
                                if (isLottie)
                                    sm.isLottie = true;
                                if (isPremium)
                                    sm.premium = typeof options.premium === 'number' ? options.premium : 1;
                                if (options.emojis != null)
                                    sm.emojis = Array.isArray(options.emojis) ? options.emojis.join('') : String(options.emojis);
                                if (options.isAnimated != null)
                                    sm.isAnimated = !!options.isAnimated;
                                if (options.accessibilityLabel)
                                    sm.accessibilityLabel = String(options.accessibilityLabel);
                            }
                            catch (_e) { }
                        })();
                        if ((isLocked || isPremium) && msg.message) {
                            if (!msg.message.messageContextInfo)
                                msg.message.messageContextInfo = {};
                            msg.message.messageContextInfo.limitSharingV2 = {
                                sharingLimited: true,
                                trigger: 1,
                                limitSharingSettingTimestamp: String(Date.now()),
                                initiatedByMe: true
                            };
                        }
                        return [4 , relay(jid, msg.message || msgContent, { messageId: msg.key ? msg.key.id : messageId })];
                    case 3:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    }

    /** sendStickerPack(jid, { name, publisher, cover?, stickers: [{ data, emojis? }] }, quoted?, opts?) */

    /** sendStickerPack — native stickerPackMessage (zip + mediaType sticker-pack). */

    function sendStickerPack(jid, pack, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, messageId, name, publisher, packMsg, msgContent, msg, e_1, results, i, item;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        q = resolveQuoted(quoted, options);
                        if (!pack || !Array.isArray(pack.stickers) || !pack.stickers.length) {
                            throw new errors_1.NexrayError('sendStickerPack requires a non-empty stickers array');
                        }
                        name = pack.name || pack.packname || 'Sticker Pack';
                        publisher = pack.publisher || pack.author || name;
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 9]);
                        return [4 /*yield*/, sticker_1.buildNativeStickerPack(sock, baileys, Object.assign({}, pack, { name: name, publisher: publisher }))];
                    case 2:
                        packMsg = _a.sent();
                        msgContent = {
                            messageContextInfo: { messageSecret: require('crypto').randomBytes(32) },
                            stickerPackMessage: packMsg
                        };
                        msg = generateWAMessageFromContent(jid, msgContent, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            messageId: messageId
                        });
                        return [4 /*yield*/, relay(jid, msg.message || msgContent, { messageId: msg.key ? msg.key.id : messageId })];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, msg];
                    case 4:
                        e_1 = _a.sent();
                        results = [];
                        i = 0;
                        _a.label = 5;
                    case 5:
                        if (!(i < pack.stickers.length)) return [3 /*break*/, 8];
                        item = pack.stickers[i];
                        return [4 /*yield*/, sendSticker(jid, item.data || item.url || item.buffer || item, q, {
                                packname: name,
                                author: publisher,
                                emojis: item.emojis,
                                isAvatar: !!pack.isAvatar
                            })];
                    case 6:
                        results.push(_a.sent());
                        _a.label = 7;
                    case 7:
                        i++;
                        return [3 /*break*/, 5];
                    case 8: return [2 /*return*/, results];
                    case 9: return [2 /*return*/];
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
                return [2 , sendVideo(jid, video, options.caption || '', q, Object.assign({}, options, { ptv: true }))];
            });
        });
    };

    /** Shared poll-creation payload builder — used by sendPoll and sendQuiz. */
    /** Build a pollCreationMessage* proto object directly (bypassing baileys' */
    /** Build the { poll: {...} } content-key payload baileys' own */
    function buildPollCreation(name, values, options, pollType) {
        if (!Array.isArray(values) || !values.length) {
            throw new errors_1.NexrayError('poll values must be a non-empty array');
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

    /** Shared poll/quiz send path — uses baileys' native `poll` content-key */
    function sendPollCreationNative(jid, name, values, options, quoted, pollType) {
        return __awaiter(this, void 0, void 0, function () {
            var q, messageId, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        q = resolveQuoted(quoted, options);
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        return [4 , generateWAMessage(jid, {
                                poll: buildPollCreation(name, values, options, pollType)
                            }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 , relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalNodes: (options && options.additionalNodes) || (pollType === 1 ? nodes_1.NODES.quiz_creation : nodes_1.NODES.poll_creation)
                            })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    }

    /** sendPoll(jid, values, message?, opts) — quoted is always the message, positioned */
    function sendPoll(jid, name, optsOrValues, quoted) {
        var options;
        var values;
        if (Array.isArray(name)) {
            values = name;
            options = quoted || {};
            quoted = optsOrValues;
        }
        else if (Array.isArray(optsOrValues)) {
            values = optsOrValues;
            options = {};
        }
        else if (optsOrValues && typeof optsOrValues === 'object') {
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

    /** sendQuiz(jid, values, message?, opts) — newsletter-only quiz poll. */
    function sendQuiz(jid, values, quoted, opts) {
        var options = opts || {};
        if (!Array.isArray(values)) {
            throw new errors_1.NexrayError('sendQuiz: values must be an array', errors_1.ErrorCodes.INVALID_OPTIONS);
        }
        return sendPollCreationNative(jid, options.name || '', values, options, quoted, 1);
    }

    /** sendPollResult(jid, name, votes, message?, opts?) */
    function sendPollResult(jid, name, votes, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, messageId, pollType, snapshot, msgContent, msg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!Array.isArray(votes) || !votes.length) {
                            throw new errors_1.NexrayError('poll result requires a non-empty votes array');
                        }
                        options = opts || {};
                        q = resolveQuoted(quoted, options);
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        pollType = options.pollType === 1 ? 1 : 0;
                        snapshot = {
                            name: name || '',
                            pollVotes: votes.map(function (v) {
                                return {
                                    optionName: v.name || v.optionName || '',
                                    optionVoteCount: parseInt(v.voteCount != null ? v.voteCount : (v.count || 0), 10) || 0
                                };
                            }),
                            pollType: pollType
                        };
                        msgContent = pollType === 1
                            ? { pollResultSnapshotMessageV3: snapshot }
                            : { pollResultSnapshotMessage: snapshot };
                        msg = generateWAMessageFromContent(jid, msgContent, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            messageId: messageId
                        });
                        return [4 /*yield*/, relay(jid, msg.message || msgContent, {
                                messageId: msg.key ? msg.key.id : messageId,
                                additionalNodes: options.additionalNodes || (pollType === 1 ? nodes_1.NODES.quiz_creation : nodes_1.NODES.poll_creation)
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    }

    function sendQuizResult(jid, name, votes, quoted, opts) {
        return sendPollResult(jid, name, votes, quoted, Object.assign({}, opts, { pollType: 1 }));
    }

    /** pollResult(jid, { name, votes: [{ name, count }] }, message?, opts?) — neoxr-compatible alias. */
    function pollResult(jid, payload, quoted, opts) {
        payload = payload || {};
        var votes = (payload.votes || []).map(function (v) {
            return { name: v.name, voteCount: v.voteCount != null ? v.voteCount : v.count };
        });
        return sendPollResult(jid, payload.name || '', votes, quoted, opts);
    }

    /** sendEvent(jid, event, message?, opts?) */
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
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        ev = Object.assign({}, event, {
                            startDate: event.startDate instanceof Date ? event.startDate : new Date(event.startDate),
                            endDate: event.endDate == null ? undefined : (event.endDate instanceof Date ? event.endDate : new Date(event.endDate))
                        });
                        return [4 , generateWAMessage(jid, { event: ev }, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId,
                                getCallLink: options.getCallLink || (typeof sock.getCallLink === 'function' ? sock.getCallLink.bind(sock) : undefined)
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 , relay(jid, msg.message, { messageId: msg.key.id, additionalNodes: (options && options.additionalNodes) || nodes_1.NODES.event_creation })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    }

    /** Build a WhatsApp-compatible vCard 3.0 string for a single contact. */
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

    /** sendContact(jid, contacts, quoted?, opts?) */
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
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        content = {
                            contacts: {
                                displayName: list.length === 1 ? list[0].displayName : (options.title || (list.length + ' contacts')),
                                contacts: list
                            },
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        return [4 , generateWAMessage(jid, content, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        return [4 , relay(jid, msg.message, { messageId: msg.key.id })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    }

    /** copyNForward(jid, message, forceForward?, opts?) */
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
                        }
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        generated = generateWAMessageFromContent(jid, content, {
                            userJid: sock.user && sock.user.id,
                            messageId: messageId,
                            quoted: (0, context_1.buildQuoted)(options.quoted) || undefined
                        });
                        return [4 , relay(jid, generated.message, { messageId: generated.key.id })];
                    case 1:
                        _a.sent();
                        return [2 , generated];
                }
            });
        });
    };

    /** sendFromAI(jid, text, quoted?, opts?) */
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
                        messageId = options.messageId || generic_1.makeMsgId(sock);
                        content = {
                            text: text,
                            contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
                        };
                        return [4 , generateWAMessage(jid, content, {
                                userJid: sock.user && sock.user.id,
                                quoted: (0, context_1.buildQuoted)(q) || undefined,
                                messageId: messageId
                            })];
                    case 1:
                        msg = _a.sent();
                        try {
                            if (msg.message) {
                                if (!msg.message.messageContextInfo)
                                    msg.message.messageContextInfo = {};
                                msg.message.messageContextInfo.messageAddOnExpiryType = 1;
                                if (msg.message.extendedTextMessage) {
                                }
                            }
                        }
                        catch (_b) { }
                        return [4 , relay(jid, msg.message, {
                                messageId: msg.key.id,
                                additionalNodes: options.additionalNodes || [{
                                        tag: 'bot',
                                        attrs: { biz_bot: '1' }
                                    }]
                            })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    };

    /** sendProduct(jid, product, quoted?, opts?) */

    /** sendProduct(jid, opts, quoted?) */
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

                        return [4 , prepareMedia(imageInput, 'image', options)];
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
                        messageId = options.messageId || raw.messageId || generic_1.makeMsgId(sock);

                        if (!(Array.isArray(buttons) && buttons.length)) return [3 , 3];
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
                        return [4 , relay(jid, msg.message || viewOnce, {
                                messageId: msg.key ? msg.key.id : messageId,
                                additionalNodes: additionalNodes
                            })];
                    case 2:
                        _a.sent();
                        return [2 , msg];
                    case 3:
                        content = { productMessage: productMessage };
                        if (Object.keys(contextInfo).length)
                            content.productMessage.contextInfo = contextInfo;
                        msg = generateWAMessageFromContent(jid, content, {
                            userJid: sock.user && sock.user.id,
                            quoted: (0, context_1.buildQuoted)(q) || undefined,
                            messageId: messageId
                        });
                        return [4 , relay(jid, msg.message || content, {
                                messageId: msg.key ? msg.key.id : messageId,
                                additionalNodes: options.additionalNodes || raw.additionalNodes || nodes_1.NODES.catalog_message
                            })];
                    case 4:
                        _a.sent();
                        return [2 , msg];
                }
            });
        });
    };

    /** groupStatus(jid, content, opts?) */

    /** groupStatus(jid, content, opts?) */

    /** groupStatus(jid, content, opts?) */
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
                        messageId = options.messageId || generic_1.makeMsgId(sock);
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
                            hasNonNullishProperty(content, 'sticker'))) return [3 , 2];
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
                        return [4 , prepareMedia(mediaSrc, mediaType, options)];
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
                        return [3 , 3];
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
                        msg = generateWAMessageFromContent(jid, wrapped, {
                            userJid: sock.user && sock.user.id,
                            messageId: messageId
                        });
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
                        return [4 , sock.relayMessage(jid, msg.message || wrapped, relayOpts)];
                    case 4:
                        _a.sent();
                        return [2 , msg];
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
                        return [4 , generateWAMessage(STORIES_JID, payload, {
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
                        if (!(i < targets.length)) return [3 , 6];
                        jid = targets[i];
                        if (!(typeof jid === 'string' && jid.endsWith('@g.us'))) return [3 , 4];
                        return [4 , sock.groupMetadata(jid)];
                    case 3:
                        meta = _a.sent();
                        participants = (meta && meta.participants) || [];
                        participants.forEach(function (p) { statusJidList.push(p.id || p); });
                        return [3 , 5];
                    case 4:
                        statusJidList.push(jid);
                        _a.label = 5;
                    case 5:
                        i++;
                        return [3 , 2];
                    case 6:
                        statusJidList = Array.from(new Set(statusJidList.filter(Boolean)));
                        return [4 , sock.relayMessage(msg.key.remoteJid, msg.message, {
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
                        if (!(i < targets.length)) return [3 , 11];
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
                        return [4 , sock.relayMessage(t, mentionMsg, {
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
                        return [3 , 8];
                    case 11: return [2 , msg];
                }
            });
        });
    };

    /** sendLivePhoto(jid, { video, image? }, quoted?, opts?) */
    /** Extract a usable video frame for sendLivePhoto's thumbnail. */
    function extractLiveThumb(inputPath) {
        return __awaiter(this, void 0, void 0, function () {
            var extractVideoThumb, offsets, i, buf, result, thumbBuf;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        extractVideoThumb = baileys.extractVideoThumb;
                        if (!(typeof extractVideoThumb === 'function')) return [3 , 5];
                        offsets = ['00:00:01', '00:00:00.5', '00:00:00'];
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < offsets.length)) return [3 , 4];
                        return [4 , extractVideoThumb(inputPath, offsets[i], { width: 640, height: 640 }).catch(function () { return null; })];
                    case 2:
                        buf = _a.sent();
                        if (buf && Buffer.isBuffer(buf) && buf.length > 100 && buf[0] === 0xFF && buf[1] === 0xD8)
                            return [2 , buf];
                        _a.label = 3;
                    case 3:
                        i++;
                        return [3 , 1];
                    case 4: return [3 , 5];
                    case 5:
                        if (typeof baileys.generateThumbnail !== 'function')
                            return [2 , null];
                        return [4 , baileys.generateThumbnail(inputPath, 'video', {}).catch(function () { return null; })];
                    case 6:
                        result = _a.sent();
                        if (!(result && result.thumbnail)) return [3 , 7];
                        thumbBuf = Buffer.from(result.thumbnail, 'base64');
                        return [2 , (thumbBuf.length > 50 && thumbBuf[0] === 0xFF && thumbBuf[1] === 0xD8) ? thumbBuf : null];
                    case 7: return [2 , null];
                }
            });
        });
    }

    /** sendLivePhoto(jid, { video, image? }, quoted?, opts?) */
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
                var downloaded = await resolveToBuffer(media.video, 'sendLivePhoto');
                inputPath = pathMod.join(os.tmpdir(), 'nexray_live_' + Date.now() + '.mp4');
                fs.writeFileSync(inputPath, downloaded);
                needCleanup = true;
            }

            var frameBuf = inputPath ? await extractLiveThumb(inputPath) : null;
            if (needCleanup && inputPath) {
                try { fs.unlinkSync(inputPath); } catch (_ignored) {  }
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
            messageId: generic_1.makeMsgId(sock)
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
        await relay(jid, vidContent, { messageId: generic_1.makeMsgId(sock) });

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

    /** Resolve Buffer | http(s) url | local path into a Buffer. */
    function resolveToBuffer(input, label) {
        return __awaiter(this, void 0, void 0, function () {
            var fs, res, err_1, urlOrPath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (input == null) return [2 , null];
                        if (Buffer.isBuffer(input)) return [2 , input];
                        urlOrPath = typeof input === 'string' ? input
                            : (input && typeof input === 'object' ? (input.url || input.path) : null);
                        if (typeof urlOrPath !== 'string') return [2 , null];
                        if (!/^https?:\/\//i.test(urlOrPath)) return [3 , 5];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 , fetch(urlOrPath)];
                    case 2:
                        res = _a.sent();
                        if (!res.ok) {
                            throw new errors_1.NexrayError(
                                (label || 'resolveToBuffer') + ': fetch failed for "' + urlOrPath + '" — HTTP ' + res.status + ' ' + res.statusText,
                                errors_1.ErrorCodes.MEDIA_DOWNLOAD
                            );
                        }
                        return [4 , res.arrayBuffer()];
                    case 3:
                        return [2 , Buffer.from(_a.sent())];
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
                        return [2 , fs.readFileSync(urlOrPath)];
                }
            });
        });
    }

    /**
     * sendThumbnailPreview(jid, text, opts?, message?)
     */
    /** sendThumbnailPreview(jid, text, quoted?, opts) — quoted positioned right before */
    async function sendThumbnailPreview(jid, text, quoted, opts) {
        var options = opts;
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
        var messageId = options.messageId || generic_1.makeMsgId(sock);

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

    (0, airich_1.attachAIRich)(sock);

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
