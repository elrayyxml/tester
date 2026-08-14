"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var messageUtils = require("../utils/message");
var getContentType = messageUtils.getContentType;
var normalizeMessageContent = messageUtils.normalizeMessageContent;
var getBodyFromMessage = messageUtils.getBodyFromMessage;
var functionsUtils = require("../utils/functions");
var getDevice = functionsUtils.getDevice;
var defaultIsBot = functionsUtils.defaultIsBot;

/**
 * @nexray/lib — core/serialize.js
 *
 * Serialize a raw WAMessage from messages.upsert into a convenient object.
 * Pure function — never mutates the original message.
 *
 * @param {import('baileys').WASocket} sock
 * @param {import('baileys').WAMessage} msg
 * @param {object} [options]
 * @returns {object|null}
 */
function serialize(sock, msg, options) {
  options = options || {};
  if (!msg) return null;

  var key = msg.key || {};
  var id = key.id;
  var chat = key.remoteJid;
  var fromMe = !!key.fromMe;
  var isGroup = typeof chat === "string" && chat.endsWith("@g.us");
  var isPrivate = typeof chat === "string" && chat.endsWith("@s.whatsapp.net");
  var isNewsletter = typeof chat === "string" && chat.endsWith("@newsletter");

  // Normalize sender (prefer phone number / participantAlt when available)
  var sender = key.participantAlt || key.participant || key.remoteJidAlt || chat;
  if (fromMe && sock.user && sock.user.id) {
    sender = sock.user.id;
  }
  if (key.participantAlt && key.participantAlt.includes("@s.whatsapp.net")) {
    sender = key.participantAlt;
  }

  var senderLid =
    key.participant && key.participant.includes("@lid")
      ? key.participant
      : key.remoteJid && key.remoteJid.includes("@lid")
        ? key.remoteJid
        : undefined;

  var isBotFn = typeof options.bot === "function" ? options.bot : defaultIsBot;
  var isBot = isBotFn(id);

  var device = getDevice(id);

  var rawContent = msg.message || {};
  var content = normalizeMessageContent(rawContent);
  var type = getContentType(content) || getContentType(rawContent) || "unknown";
  var msgContent = type && content ? content[type] : content;

  var body = getBodyFromMessage(rawContent);

  // Mentions
  var mentionedJid = [];
  var ctx = (msgContent && msgContent.contextInfo) || (content && content.extendedTextMessage && content.extendedTextMessage.contextInfo) || (content && content.messageContextInfo);
  if (ctx && ctx.mentionedJid) {
    mentionedJid = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
  }

  // Quoted (one level deep). This is the exact shape `relayHelper` /
  // `generateWAMessageFromContent` expects for `options.quoted`:
  //   { key: { remoteJid, fromMe, id, participant }, message, participant }
  //
  // IMPORTANT: `key.remoteJid` on the quoted key must be the chat the
  // *original quoted message* belongs to (same as the current `chat` for
  // 1:1 or the current group), `key.fromMe` reflects whether *we* sent the
  // quoted message, and `participant` is the actual sender JID of the
  // quoted message (used by generateWAMessageFromContent to compute
  // contextInfo.participant). A previous version of this function
  // accidentally wrote `fromMe: ctx.participant ? false : fromMe` — mixing
  // up the `participant` and `fromMe` fields — which produced a malformed
  // quoted key and made every sendX() with a quoted reply silently fail
  // to attach contextInfo.quotedMessage. Fixed here.
  var quoted = null;
  if (ctx && ctx.quotedMessage) {
    var quotedParticipant = ctx.participant || undefined;
    var quotedFromMe = quotedParticipant ? quotedParticipant === (sock.user && sock.user.id) : fromMe;

    var qKey = {
      remoteJid: ctx.remoteJid || chat,
      fromMe: quotedFromMe,
      id: ctx.stanzaId,
      participant: quotedParticipant
    };
    var qMsg = {
      key: qKey,
      message: ctx.quotedMessage,
      messageTimestamp: undefined,
      pushName: undefined
    };
    quoted = serialize(sock, qMsg, options);
    if (quoted) {
      // strip bound methods on the quoted copy — replying to a quote
      // should go through the *current* message's reply(), not recurse
      delete quoted.reply;
      delete quoted.react;
    }
  }

  var expiration = ctx && ctx.expiration;

  var m = {
    key: key,
    id: id,
    chat: chat,
    sender: sender,
    senderLid: senderLid,
    fromMe: fromMe,
    isGroup: isGroup,
    isPrivate: isPrivate,
    isNewsletter: isNewsletter,
    isBot: isBot,
    device: device,
    type: type,
    msg: msgContent,
    body: body,
    mentionedJid: mentionedJid,
    quoted: quoted,
    expiration: expiration,
    pushName: msg.pushName,
    messageTimestamp: msg.messageTimestamp,
    broadcast: msg.broadcast,
    // plain copy of content only (no back-ref to full WAMessage → no circular)
    message: rawContent
  };

  // Shortcut helpers bound to this message
  m.reply = function reply(text, opts) {
    return sock.sendText(chat, text, m, opts || {});
  };

  m.react = function react(emoji) {
    return sock.sendReact(chat, emoji, key);
  };

  return m;
}

exports.serialize = serialize;
