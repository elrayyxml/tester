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
exports.buildRichPayload = exports.attachAIRich = void 0;

var crypto_1 = require("crypto");
var context_1 = require("./context");
var functions_1 = require("../utils/functions");

/**
 * Build unifiedResponse section from neoxr-style meta parts:
 *   { text }, { code: { language, code } }, { table: { title, headers, rows } },
 *   { muted }, { suggestions: string[] }, { sources: [{ icon, title, url }] }
 *
 * Adapted from ryuu AIRich layout primitives + neoxr sendMetaMsg usage.
 */
function partsToSections(parts) {
    var sections = [];
    var sources = [];
    if (!Array.isArray(parts))
        parts = [parts];
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p || typeof p !== 'object')
            continue;
        if (typeof p.text === 'string') {
            sections.push({
                view_model: {
                    primitive: {
                        type: 'text',
                        text: p.text
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            });
        }
        else if (p.code && typeof p.code === 'object') {
            sections.push({
                view_model: {
                    primitive: {
                        type: 'code',
                        language: p.code.language || 'javascript',
                        code: p.code.code || ''
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            });
        }
        else if (p.table && typeof p.table === 'object') {
            sections.push({
                view_model: {
                    primitive: {
                        type: 'table',
                        title: p.table.title || '',
                        headers: p.table.headers || [],
                        rows: p.table.rows || []
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            });
        }
        else if (typeof p.muted === 'string') {
            sections.push({
                view_model: {
                    primitive: {
                        type: 'muted',
                        text: p.muted
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            });
        }
        else if (Array.isArray(p.suggestions)) {
            sections.push({
                view_model: {
                    primitives: p.suggestions.map(function (s) { return ({ type: 'suggestion', text: String(s) }); }),
                    __typename: 'GenAIActionRowLayoutViewModel'
                }
            });
        }
        else if (Array.isArray(p.sources)) {
            for (var j = 0; j < p.sources.length; j++) {
                var s = p.sources[j];
                sources.push({
                    title: s.title || '',
                    url: s.url || '',
                    iconUrl: s.icon || s.iconUrl || ''
                });
            }
        }
        else if (p.reels || p.posts) {
            // pass-through complex blocks as raw primitive
            sections.push({
                view_model: {
                    primitive: p,
                    __typename: 'GenAISingleLayoutViewModel'
                }
            });
        }
    }
    return { sections: sections, sources: sources };
}

/**
 * Build ryuu-style botForwardedMessage / richResponseMessage payload
 * @param {object} opts
 */
function buildRichPayload(opts) {
    if (opts === void 0) { opts = {}; }
    var parts = opts.parts || opts.content || [];
    var title = opts.title || '';
    var quoted = opts.quoted;
    var parsed = partsToSections(parts);
    var qObj = {};
    if (quoted) {
        var q = (0, context_1.buildQuoted)(quoted);
        if (q && q.key) {
            qObj = {
                stanzaId: q.key.id,
                participant: q.key.participant || q.key.remoteJid,
                quotedMessage: q.message || { conversation: '' }
            };
        }
    }
    var unified = Buffer.from(JSON.stringify({
        response_id: (0, crypto_1.randomUUID) ? (0, crypto_1.randomUUID)() : (0, functions_1.generateMessageID)(),
        sections: parsed.sections
    })).toString('base64');

    return {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
                messageDisclaimerText: title,
                richResponseSourcesMetadata: parsed.sources.length
                    ? { sources: parsed.sources }
                    : undefined
            }
        },
        botForwardedMessage: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: opts.submessages || [],
                    unifiedResponse: {
                        data: unified
                    },
                    contextInfo: Object.assign({}, qObj, opts.contextInfo || {})
                }
            }
        }
    };
}
exports.buildRichPayload = buildRichPayload;

/**
 * Attach sendMetaMsg / AIRich helpers to socket
 * @param {object} sock
 * @param {object} deps - { relay, makeMsgId, generateWAMessageFromContent }
 */
function attachAIRich(sock, deps) {
    var relay = deps.relay;
    var makeMsgId = deps.makeMsgId;
    var generateWAMessageFromContent = deps.generateWAMessageFromContent;

    /**
     * sendMetaMsg(jid, parts, quoted?, opts?)
     * Neoxr-compatible:
     *   sendMetaMsg(chat, [{ text }, { code }, { table }, { sources }], m, { title, mentions })
     */
    sock.sendMetaMsg = function (jid, parts, quoted, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var options, q, payload, msg, messageId;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        options = opts || {};
                        if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.id && !quoted.chat && !quoted.remoteJid && !Array.isArray(quoted)) {
                            options = quoted;
                            quoted = options.quoted || null;
                        }
                        q = quoted || options.quoted || null;
                        payload = buildRichPayload({
                            parts: parts,
                            title: options.title || '',
                            quoted: q,
                            contextInfo: options.contextInfo,
                            submessages: options.submessages
                        });
                        messageId = options.messageId || makeMsgId();
                        msg = generateWAMessageFromContent(jid, payload, {
                            userJid: sock.user && sock.user.id,
                            messageId: messageId,
                            quoted: (0, context_1.buildQuoted)(q) || undefined
                        });
                        return [4 /*yield*/, relay(jid, msg.message || payload, {
                                messageId: msg.key ? msg.key.id : messageId,
                                additionalNodes: options.additionalNodes || [{
                                        tag: 'bot',
                                        attrs: { biz_bot: '1' }
                                    }]
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, msg];
                }
            });
        });
    };

    // alias
    sock.sendAIRich = sock.sendMetaMsg;
}

exports.attachAIRich = attachAIRich;
