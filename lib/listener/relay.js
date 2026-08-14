"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var functionsUtils = require("../utils/functions");
var generateMessageId = functionsUtils.generateMessageId;
var messageUtils = require("../utils/message");
var getContentType = messageUtils.getContentType;

/**
 * @nexray/lib — listener/relay.js
 *
 * Generic relay helpers shared by every sock.sendX() in core/extend.js.
 * Every send path in this library funnels through `sock.relayMessage()` —
 * never `sock.sendMessage()` — so we get full control over
 * additionalAttributes / additionalNodes (needed for newsletter annotation,
 * quiz messages, etc) without depending on Baileys' own high-level
 * sendMessage() branching logic.
 */

/**
 * Normalizes a "quoted" input (either a serialized `m` object from
 * core/serialize.js, or a raw WAMessage) into the exact shape
 * `generateWAMessage`/`generateWAMessageFromContent` expect for
 * `options.quoted`: `{ key: { remoteJid, fromMe, id, participant }, message }`.
 *
 * @param {object} quoted
 * @returns {object|undefined}
 */
function normalizeQuoted(quoted) {
  if (!quoted) return undefined;

  // Already a raw WAMessage shape ({ key, message })
  if (quoted.key && quoted.message !== undefined) {
    return quoted;
  }

  // Serialized `m` object from core/serialize.js
  if (quoted.key && quoted.msg !== undefined) {
    return {
      key: quoted.key,
      message: quoted.message
    };
  }

  return undefined;
}

/**
 * Resolves `additionalNodes` for newsletter forwarding annotation, applied
 * only to *media* messages, and only when `newsletterAnnotation` was
 * explicitly configured by the consumer via Client()/Extend() options.
 * This is intentionally opt-in only — see core/extend.js for the option
 * surface and the PRD's explicit ban on any hidden/implicit newsletter
 * network calls.
 *
 * @param {object} extendOptions
 * @param {string} contentTypeKey e.g. "imageMessage", "videoMessage"
 * @returns {object|undefined} contextInfo patch, or undefined
 */
function resolveNewsletterAnnotation(extendOptions, contentTypeKey) {
  var isMedia = contentTypeKey === "imageMessage" || contentTypeKey === "videoMessage";
  if (!isMedia) return undefined;
  var annotation = extendOptions && extendOptions.newsletterAnnotation;
  if (!annotation || annotation === false) return undefined;

  return {
    forwardedNewsletterMessageInfo: {
      newsletterJid: annotation.newsletterJid,
      newsletterName: annotation.newsletterName,
      contentType: annotation.contentType != null ? annotation.contentType : 1
    }
  };
}

/**
 * Resolves `additionalNodes` (biz binary nodes) merged from extend-level
 * defaults and per-call overrides.
 * @param {object} [extendOptions]
 * @param {object[]} [extra]
 */
function resolveAdditionalNodes(extendOptions, extra) {
  var nodes = [];
  if (extendOptions && Array.isArray(extendOptions.additionalNodes)) {
    nodes = nodes.concat(extendOptions.additionalNodes);
  }
  if (Array.isArray(extra)) {
    nodes = nodes.concat(extra);
  }
  return nodes.length ? nodes : undefined;
}

/**
 * Core relay helper: takes a plain proto content object (`{ locationMessage: {...} }`
 * style, top-level key), generates the full WAMessage via
 * `generateWAMessageFromContent` (letting Baileys attach `contextInfo.quotedMessage`
 * when `quoted` is provided), then relays it.
 *
 * @param {import('baileys').WASocket} sock
 * @param {string} jid
 * @param {object} content Plain proto content, e.g. `{ locationMessage: {...} }`.
 * @param {{
 *   quoted?: object,
 *   ephemeralExpiration?: number,
 *   messageId?: string,
 *   additionalNodes?: object[],
 *   additionalAttributes?: object,
 *   statusJidList?: string[],
 *   useCachedGroupMetadata?: boolean
 * }} [extra]
 * @param {object} [extendOptions] the options object passed to Client()/Extend()
 * @returns {Promise<import('baileys').WAMessage>}
 */
async function relayRaw(sock, jid, content, extra, extendOptions) {
  extra = extra || {};
  extendOptions = extendOptions || {};

  var baileys = require("baileys");
  var generateWAMessageFromContent = baileys.generateWAMessageFromContent;

  var messageId = extra.messageId || generateMessageId(sock.user && sock.user.id, extendOptions.messageIdPrefix);

  var quoted = normalizeQuoted(extra.quoted);

  var fullMsg = generateWAMessageFromContent(jid, content, {
    userJid: sock.user && sock.user.id,
    quoted: quoted,
    ephemeralExpiration: extra.ephemeralExpiration,
    messageId: messageId
  });

  var contentTypeKey = getContentType(content);
  var newsletterCtx = resolveNewsletterAnnotation(extendOptions, contentTypeKey);
  if (newsletterCtx && fullMsg.message && fullMsg.message[contentTypeKey]) {
    fullMsg.message[contentTypeKey].contextInfo = Object.assign(
      {},
      fullMsg.message[contentTypeKey].contextInfo || {},
      newsletterCtx
    );
  }

  var additionalNodes = resolveAdditionalNodes(extendOptions, extra.additionalNodes);

  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes: additionalNodes,
    statusJidList: extra.statusJidList,
    useCachedGroupMetadata: extra.useCachedGroupMetadata
  });

  return fullMsg;
}

/**
 * High-level relay helper: takes an `AnyMessageContent`-shaped object (the
 * same shape Baileys' own `sock.sendMessage()` accepts, e.g. `{ image, caption }`
 * or `{ text }`), builds it via `generateWAMessage` (which itself handles
 * media upload, link preview injection, and quoted-message context), then
 * relays it. Used for media/contacts/poll/etc where letting Baileys do the
 * upload/prepare step is simpler and more robust than building the proto by hand.
 *
 * @param {import('baileys').WASocket} sock
 * @param {string} jid
 * @param {object} content AnyMessageContent-shaped object.
 * @param {object} [extra] Same shape as relayRaw's `extra`.
 * @param {object} [extendOptions]
 * @returns {Promise<import('baileys').WAMessage>}
 */
async function relayHelper(sock, jid, content, extra, extendOptions) {
  extra = extra || {};
  extendOptions = extendOptions || {};

  var baileys = require("baileys");
  var generateWAMessage = baileys.generateWAMessage;

  var messageId = extra.messageId || generateMessageId(sock.user && sock.user.id, extendOptions.messageIdPrefix);

  var quoted = normalizeQuoted(extra.quoted);

  var fullMsg = await generateWAMessage(jid, content, {
    userJid: sock.user && sock.user.id,
    quoted: quoted,
    ephemeralExpiration: extra.ephemeralExpiration,
    messageId: messageId,
    upload: sock.waUploadToServer,
    mediaCache: sock.mediaCache,
    getUrlInfo: extra.getUrlInfo,
    statusJidList: extra.statusJidList
  });

  var contentTypeKey = getContentType(fullMsg.message);
  var newsletterCtx = resolveNewsletterAnnotation(extendOptions, contentTypeKey);
  if (newsletterCtx && fullMsg.message && fullMsg.message[contentTypeKey]) {
    fullMsg.message[contentTypeKey].contextInfo = Object.assign(
      {},
      fullMsg.message[contentTypeKey].contextInfo || {},
      newsletterCtx
    );
  }

  var additionalNodes = resolveAdditionalNodes(extendOptions, extra.additionalNodes);

  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes: additionalNodes,
    statusJidList: extra.statusJidList,
    useCachedGroupMetadata: extra.useCachedGroupMetadata
  });

  return fullMsg;
}

/**
 * Prepares raw media (Buffer/URL/path/stream) into an uploaded
 * imageMessage/videoMessage/audioMessage/documentMessage/stickerMessage
 * object via Baileys' own `prepareWAMessageMedia`. Used by content builders
 * that need an already-uploaded media object nested inside another message
 * (e.g. interactiveMessage header, productMessage.product.productImage,
 * album children).
 *
 * @param {import('baileys').WASocket} sock
 * @param {{ [key: string]: Buffer|string }} mediaContent e.g. `{ image: buffer }`
 * @param {object} [options] passed through to prepareWAMessageMedia
 * @returns {Promise<object>}
 */
async function prepareMedia(sock, mediaContent, options) {
  var baileys = require("baileys");
  var prepareWAMessageMedia = baileys.prepareWAMessageMedia;

  return prepareWAMessageMedia(
    mediaContent,
    Object.assign(
      {
        upload: sock.waUploadToServer
      },
      options || {}
    )
  );
}

exports.normalizeQuoted = normalizeQuoted;
exports.resolveNewsletterAnnotation = resolveNewsletterAnnotation;
exports.resolveAdditionalNodes = resolveAdditionalNodes;
exports.relayRaw = relayRaw;
exports.relayHelper = relayHelper;
exports.prepareMedia = prepareMedia;
