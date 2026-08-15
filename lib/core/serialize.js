'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.serialize = void 0;

var message_1 = require("../utils/message");
var functions_1 = require("../utils/functions");

/**
 * Serialize raw WAMessage from messages.upsert into a convenient object.
 * Does NOT attach itself to the socket — call explicitly: const m = serialize(sock, msg)
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} msg - raw WAMessage
 * @returns {object} enriched m
 */
function serialize(sock, msg) {
    if (!msg || !msg.key) {
        return null;
    }

    var key = msg.key;
    var message = msg.message || {};
    var type = (0, message_1.getContentType)(message);
    var content = type ? message[type] : null;
    var body = (0, message_1.normalizeBody)(content || message, type);

    var chat = key.remoteJid || '';
    var sender = key.participant || key.remoteJid || '';
    var fromMe = !!key.fromMe;
    var isGroup = chat.endsWith('@g.us');
    var isPrivate = chat.endsWith('@s.whatsapp.net');
    var isNewsletter = chat.endsWith('@newsletter');

    var botFn = (sock && sock.__nexray && sock.__nexray.bot) || (function () { return false; });
    var isBot = !!botFn(key.id);
    var device = (0, functions_1.getDevice)(key.id);

    var mentionedJid = (content && content.contextInfo && content.contextInfo.mentionedJid) || [];
    var expiration = content && content.contextInfo && content.contextInfo.expiration;

    var m = {
        key: key,
        id: key.id,
        chat: chat,
        sender: sender,
        senderLid: key.participantAlt || key.remoteJidAlt || undefined,
        fromMe: fromMe,
        isGroup: isGroup,
        isPrivate: isPrivate,
        isNewsletter: isNewsletter,
        isBot: isBot,
        device: device,
        type: type,
        mtype: type,
        msg: content,
        message: message,
        body: body,
        text: body,
        mentionedJid: mentionedJid,
        expiration: expiration,
        pushName: msg.pushName,
        messageTimestamp: msg.messageTimestamp,
        quoted: null,
        // shortcuts
        reply: function (text, opts) {
            if (sock && typeof sock.reply === 'function') {
                return sock.reply(chat, text, m, opts);
            }
            if (sock && typeof sock.sendText === 'function') {
                return sock.sendText(chat, text, m, opts);
            }
            return sock.sendMessage(chat, { text: text }, { quoted: key });
        },
        react: function (emoji) {
            if (sock && typeof sock.sendReact === 'function') {
                return sock.sendReact(chat, emoji, key);
            }
            return sock.sendMessage(chat, {
                react: { text: emoji, key: key }
            });
        }
    };

    // recursive quoted (1 level)
    if (content && content.contextInfo && content.contextInfo.quotedMessage) {
        var qKey = {
            remoteJid: content.contextInfo.remoteJid || chat,
            id: content.contextInfo.stanzaId,
            fromMe: false,
            participant: content.contextInfo.participant
        };
        var qMsg = {
            key: qKey,
            message: content.contextInfo.quotedMessage
        };
        try {
            m.quoted = serialize(sock, qMsg);
        }
        catch (_a) {
            m.quoted = {
                key: qKey,
                message: content.contextInfo.quotedMessage
            };
        }
    }

    return m;
}

exports.serialize = serialize;
