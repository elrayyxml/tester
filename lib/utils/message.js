"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * @nexray/lib — utils/message.js
 *
 * Low-level WAMessage content helpers, mirroring the official Baileys
 * `messages.js` implementations for `getContentType`, `normalizeMessageContent`
 * and `extractMessageContent` exactly — this matters because
 * `generateWAMessageFromContent` (and therefore quoted-message handling)
 * relies on `getContentType` picking the correct key.
 */

/**
 * Returns the key identifying the "true" content type of a message object,
 * e.g. `conversation`, `extendedTextMessage`, `imageMessage`, etc.
 * Matches Baileys' own getContentType() exactly.
 * @param {object} content
 * @returns {string|undefined}
 */
function getContentType(content) {
  if (!content) return undefined;
  var keys = Object.keys(content);
  return keys.find(function (k) {
    return (k === "conversation" || k.includes("Message")) && k !== "senderKeyDistributionMessage";
  });
}

/** Message wrapper keys that hold another message inside `.message`. */
function getFutureProofMessage(message) {
  return (
    (message && message.associatedChildMessage) ||
    (message && message.botForwardedMessage) ||
    (message && message.botInvokeMessage) ||
    (message && message.botTaskMessage) ||
    (message && message.documentWithCaptionMessage) ||
    (message && message.editedMessage) ||
    (message && message.ephemeralMessage) ||
    (message && message.eventCoverImage) ||
    (message && message.groupMentionedMessage) ||
    (message && message.groupStatusMentionMessage) ||
    (message && message.groupStatusMessage) ||
    (message && message.groupStatusMessageV2) ||
    (message && message.limitSharingMessage) ||
    (message && message.lottieStickerMessage) ||
    (message && message.newsletterAdminProfileMessage) ||
    (message && message.newsletterAdminProfileMessageV2) ||
    (message && message.newsletterAdminProfileStatusMessage) ||
    (message && message.pollCreationMessageV4) ||
    (message && message.pollCreationOptionImageMessage) ||
    (message && message.questionMessage) ||
    (message && message.questionReplyMessage) ||
    (message && message.spoilerMessage) ||
    (message && message.statusAddYours) ||
    (message && message.statusMentionMessage) ||
    (message && message.viewOnceMessage) ||
    (message && message.viewOnceMessageV2) ||
    (message && message.viewOnceMessageV2Extension)
  );
}

/**
 * Unwraps ephemeral / view-once / edited / spoiler wrapper messages down to
 * their real inner content. Max 5 iterations to guard against malformed
 * cyclic payloads. Matches Baileys' own normalizeMessageContent() exactly.
 * @param {object} content
 * @returns {object|undefined}
 */
function normalizeMessageContent(content) {
  if (!content) return undefined;
  for (var i = 0; i < 5; i++) {
    var inner = getFutureProofMessage(content);
    if (!inner) break;
    content = inner.message;
  }
  return content;
}

/**
 * Extracts the true message content, unwrapping template/buttons message
 * shapes down to their effective content. Matches Baileys' own
 * extractMessageContent() exactly (used by media download + assertMediaContent).
 * @param {object} content
 * @returns {object|undefined}
 */
function extractMessageContent(content) {
  function extractFromTemplateMessage(msg) {
    if (msg.imageMessage) return { imageMessage: msg.imageMessage };
    if (msg.documentMessage) return { documentMessage: msg.documentMessage };
    if (msg.videoMessage) return { videoMessage: msg.videoMessage };
    if (msg.locationMessage) return { locationMessage: msg.locationMessage };
    return {
      conversation: "contentText" in msg ? msg.contentText : "hydratedContentText" in msg ? msg.hydratedContentText : ""
    };
  }

  var normalized = normalizeMessageContent(content);
  if (!normalized) return undefined;

  if (normalized.buttonsMessage) {
    return extractFromTemplateMessage(normalized.buttonsMessage);
  }
  if (normalized.templateMessage && normalized.templateMessage.hydratedFourRowTemplate) {
    return extractFromTemplateMessage(normalized.templateMessage.hydratedFourRowTemplate);
  }
  if (normalized.templateMessage && normalized.templateMessage.hydratedTemplate) {
    return extractFromTemplateMessage(normalized.templateMessage.hydratedTemplate);
  }
  if (normalized.templateMessage && normalized.templateMessage.fourRowTemplate) {
    return extractFromTemplateMessage(normalized.templateMessage.fourRowTemplate);
  }

  return normalized;
}

/**
 * Determines if a message object contains a media-eligible key for album
 * children (image or video only). Matches Baileys' own hasValidAlbumMedia().
 * @param {object} content
 * @returns {boolean}
 */
function hasValidAlbumMedia(content) {
  return !!(content && (content.imageMessage || content.videoMessage));
}

/**
 * Determines if a message object is a valid interactiveMessage header
 * (image/video/document/product/location). Mirrors hasValidInteractiveHeader().
 * @param {object} content
 * @returns {boolean}
 */
function hasValidInteractiveHeader(content) {
  return !!(
    content &&
    (content.imageMessage ||
      content.videoMessage ||
      content.documentMessage ||
      content.productMessage ||
      content.locationMessage)
  );
}

/**
 * Extracts a plain-text "body" out of any supported message type — used by
 * `core/serialize.js` to populate `m.body`.
 * @param {object} message Raw `WAMessage.message` object.
 * @returns {string}
 */
function getBodyFromMessage(message) {
  var content = normalizeMessageContent(message);
  if (!content) return "";

  if (typeof content.conversation === "string") return content.conversation;
  if (content.extendedTextMessage && content.extendedTextMessage.text) return content.extendedTextMessage.text;
  if (content.imageMessage && content.imageMessage.caption) return content.imageMessage.caption;
  if (content.videoMessage && content.videoMessage.caption) return content.videoMessage.caption;
  if (content.documentMessage && content.documentMessage.caption) return content.documentMessage.caption;

  if (content.buttonsResponseMessage && content.buttonsResponseMessage.selectedDisplayText) {
    return content.buttonsResponseMessage.selectedDisplayText;
  }

  if (content.listResponseMessage && content.listResponseMessage.singleSelectReply && content.listResponseMessage.singleSelectReply.selectedRowId) {
    var title = content.listResponseMessage.title || "";
    var row = content.listResponseMessage.singleSelectReply.selectedRowId;
    return title ? title + " " + row : row;
  }
  if (content.listResponseMessage && content.listResponseMessage.title) return content.listResponseMessage.title;

  if (content.templateButtonReplyMessage && content.templateButtonReplyMessage.selectedDisplayText) {
    return content.templateButtonReplyMessage.selectedDisplayText;
  }

  if (content.interactiveResponseMessage && content.interactiveResponseMessage.body && content.interactiveResponseMessage.body.text) {
    return content.interactiveResponseMessage.body.text;
  }
  if (
    content.interactiveResponseMessage &&
    content.interactiveResponseMessage.nativeFlowResponseMessage &&
    content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson
  ) {
    try {
      var parsed = JSON.parse(content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      return (parsed && (parsed.id || parsed.title || parsed.display_text)) || JSON.stringify(parsed);
    } catch (e) {
      return content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson;
    }
  }

  if (content.reactionMessage && content.reactionMessage.text) return content.reactionMessage.text;

  return "";
}

exports.getContentType = getContentType;
exports.normalizeMessageContent = normalizeMessageContent;
exports.extractMessageContent = extractMessageContent;
exports.hasValidAlbumMedia = hasValidAlbumMedia;
exports.hasValidInteractiveHeader = hasValidInteractiveHeader;
exports.getBodyFromMessage = getBodyFromMessage;
