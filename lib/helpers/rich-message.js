'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRichPayload = buildRichPayload;
exports.attachAIRich = attachAIRich;

var crypto = require('crypto');
var context_1 = require('./context');
var generic_1 = require('./generic');
var engine_1 = require('../core/engine');

var RichSubMessageType = { TEXT: 2, TABLE: 4, CODE: 5 };
var CodeHighlightType = { DEFAULT: 0, KEYWORD: 1, METHOD: 2, STRING: 3, NUMBER: 4, COMMENT: 5 };

function botMetadataSignature() {
    var s = new Uint8Array(64);
    crypto.randomFillSync(s);
    return s;
}

function botMetadataCertificate(length) {
    if (length === void 0) length = 685;
    var c = new Uint8Array(length);
    c[0] = 48;
    c[1] = 130;
    crypto.randomFillSync(c.subarray(2));
    return c;
}

function wrapToBotForwardedMessage(richResponseMessage) {
    return {
        messageContextInfo: {
            botMetadata: {
                verificationMetadata: {
                    proofs: [{
                            certificateChain: [botMetadataCertificate(), botMetadataCertificate(892)],
                            version: 1,
                            useCase: 1,
                            signature: botMetadataSignature()
                        }]
                }
            }
        },
        botForwardedMessage: {
            message: { richResponseMessage: richResponseMessage }
        }
    };
}

function tokenizeCode(code) {
    return [{ highlightType: CodeHighlightType.DEFAULT, codeContent: String(code || '') }];
}

function toUnified(submessages) {
    return {
        response_id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
        sections: submessages.map(function (sub) {
            if (sub.messageType === RichSubMessageType.CODE) {
                var cm = sub.codeMetadata || {};
                return {
                    view_model: {
                        primitive: {
                            language: cm.codeLanguage || 'javascript',
                            code_blocks: (cm.codeBlocks || []).map(function (b) {
                                return { content: b.codeContent, type: CodeHighlightType[b.highlightType] || 'DEFAULT' };
                            }),
                            __typename: 'GenAICodeUXPrimitive'
                        },
                        __typename: 'GenAISingleLayoutViewModel'
                    }
                };
            }
            if (sub.messageType === RichSubMessageType.TABLE) {
                var tm = sub.tableMetadata || {};
                return {
                    view_model: {
                        primitive: {
                            title: tm.title || '',
                            rows: (tm.rows || []).map(function (row) {
                                return {
                                    is_header: !!row.isHeading,
                                    cells: row.items || [],
                                    markdown_cells: (row.items || []).map(function (item) { return ({ text: item }); })
                                };
                            }),
                            __typename: 'GenATableUXPrimitive'
                        },
                        __typename: 'GenAISingleLayoutViewModel'
                    }
                };
            }
            return {
                view_model: {
                    primitive: {
                        text: sub.messageText || '',
                        inline_entities: sub.inlineEntities || [],
                        __typename: 'GenAIMarkdownTextUXPrimitive'
                    },
                    __typename: 'GenAISingleLayoutViewModel'
                }
            };
        })
    };
}

/**
 * Build richResponse / botForwardedMessage from neoxr-style parts or content object.
 */
function buildRichPayload(content) {
    var parts = Array.isArray(content) ? content : null;
    var submessages = [];
    if (parts) {
        parts.forEach(function (p) {
            if (!p || typeof p !== 'object') return;
            if (typeof p.text === 'string') {
                submessages.push({ messageType: RichSubMessageType.TEXT, messageText: p.text });
            }
            else if (p.code) {
                var codeStr = typeof p.code === 'string' ? p.code : (p.code.code || '');
                var lang = (p.code && p.code.language) || p.language || 'javascript';
                submessages.push({
                    messageType: RichSubMessageType.CODE,
                    codeMetadata: { codeLanguage: lang, codeBlocks: tokenizeCode(codeStr) }
                });
            }
            else if (p.table) {
                var rows = Array.isArray(p.table) ? p.table : (p.table.rows || []);
                var title = p.title || (p.table && p.table.title) || '';
                if (p.table.headers) {
                    rows = [p.table.headers].concat(rows);
                }
                submessages.push({
                    messageType: RichSubMessageType.TABLE,
                    tableMetadata: {
                        title: title,
                        rows: rows.map(function (items, index) {
                            return {
                                isHeading: index === 0 && !!(p.table && p.table.headers),
                                items: Array.isArray(items) ? items : [String(items)]
                            };
                        })
                    }
                });
            }
        });
    }
    else if (content && typeof content === 'object') {
        if (content.headerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: content.headerText });
        if (content.contentText || content.text) {
            submessages.push({ messageType: RichSubMessageType.TEXT, messageText: content.contentText || content.text });
        }
        if (content.code) {
            var codeStr2 = typeof content.code === 'string' ? content.code : content.code.code || '';
            submessages.push({
                messageType: RichSubMessageType.CODE,
                codeMetadata: {
                    codeLanguage: content.language || (content.code && content.code.language) || 'javascript',
                    codeBlocks: tokenizeCode(codeStr2)
                }
            });
        }
        if (content.table) {
            var rows2 = Array.isArray(content.table) ? content.table : content.table.rows || [];
            submessages.push({
                messageType: RichSubMessageType.TABLE,
                tableMetadata: {
                    title: content.title || '',
                    rows: rows2.map(function (items, index) {
                        return { isHeading: index === 0 && !content.noHeading, items: Array.isArray(items) ? items : [String(items)] };
                    })
                }
            });
        }
        if (content.footerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: content.footerText });
    }

    var unified = toUnified(submessages);
    var richResponseMessage = {
        submessages: submessages,
        messageType: 1,
        unifiedResponse: {
            data: Buffer.from(JSON.stringify(unified), 'utf8')
        },
        contextInfo: {
            isForwarded: true,
            forwardingScore: 1,
            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
            forwardOrigin: 4
        }
    };
    var message = wrapToBotForwardedMessage(richResponseMessage);
    if (content && content.disclaimerText) {
        message.messageContextInfo.botMetadata.messageDisclaimerText = content.disclaimerText;
    }
    message.messageContextInfo.botMetadata.botResponseId = unified.response_id;
    return message;
}

function attachAIRich(sock) {
    /**
     * sendMetaMsg(jid, parts|content, quoted?, opts?)
     */
    sock.sendMetaMsg = function (jid, parts, quoted, opts) {
        return Promise.resolve().then(function () {
            var options = opts || {};
            if (quoted && typeof quoted === 'object' && !quoted.key && !quoted.message) {
                options = Object.assign({}, quoted, options);
                quoted = options.quoted || null;
            }
            var baileys = engine_1.getEngine(sock);
            var payload = buildRichPayload(parts);
            var generateWAMessageFromContent = baileys.generateWAMessageFromContent;
            var msg = generateWAMessageFromContent(jid, payload, {
                userJid: sock.user && sock.user.id,
                quoted: (0, context_1.buildQuoted)(quoted) || undefined,
                messageId: options.messageId || generic_1.makeMsgId(sock)
            });
            return sock.relayMessage(jid, msg.message || payload, {
                messageId: msg.key && msg.key.id,
                additionalNodes: options.additionalNodes || [
                    { tag: 'bot', attrs: { biz_bot: '1' } },
                    { tag: 'biz', attrs: {} }
                ]
            }).then(function () { return msg; });
        });
    };
    sock.sendAIRich = sock.sendMetaMsg;
}
