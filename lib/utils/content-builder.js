"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var crypto = require("crypto");
var hasValidInteractiveHeader = require("./message").hasValidInteractiveHeader;

/**
 * @nexray/lib — utils/content-builder.js
 *
 * Proto-ready content builders for message types that AnyMessageContent
 * doesn't cover 1:1 through the high-level `generateWAMessage()` path, or
 * where we need finer control (e.g. merging a prepared media header into
 * `interactiveMessage`). These builders produce plain objects matching the
 * exact proto shape Baileys expects; `relayRaw()` / `relayHelper()` push
 * them through `generateWAMessageFromContent()` afterwards, which is what
 * actually attaches `contextInfo.quotedMessage` — so it's essential every
 * builder here nests the primary content directly under a single top-level
 * key (e.g. `{ locationMessage: {...} }`), never a key that itself wraps a
 * `.message` (which would break `getContentType()` detection upstream).
 */

function getProto() {
  try {
    var b = require("baileys");
    return b.proto || b.WAProto || null;
  } catch (e) {
    return null;
  }
}

function createMessage(obj) {
  var proto = getProto();
  if (proto && proto.Message && proto.Message.create) {
    try {
      return proto.Message.create(obj);
    } catch (e) {
      return obj;
    }
  }
  return obj;
}

/**
 * Apply mentions / mentionAll / custom contextInfo onto the primary content
 * key of a freshly built message object. Mutates and returns `m`.
 * @param {object} m
 * @param {{ mentions?: string[], mentionAll?: boolean, contextInfo?: object }} [opts]
 */
function applyContextInfo(m, opts) {
  opts = opts || {};
  if (!m || typeof m !== "object") return m;
  var type = Object.keys(m).find(function (k) {
    return k !== "messageContextInfo";
  });
  if (!type) return m;
  var key = m[type];
  if (!key || typeof key !== "object") return m;

  var ctx = Object.assign({}, key.contextInfo || {});
  if (Array.isArray(opts.mentions) && opts.mentions.length) {
    ctx.mentionedJid = opts.mentions;
  }
  if (opts.mentionAll) {
    ctx.nonJidMentions = 1;
  }
  if (opts.contextInfo && typeof opts.contextInfo === "object") {
    Object.assign(ctx, opts.contextInfo);
  }
  if (Object.keys(ctx).length) {
    key.contextInfo = ctx;
  }
  return m;
}

/**
 * Plain text content — mentions/mentionAll supported via applyContextInfo.
 * Link preview fields (matchedText/title/etc.) are merged in by the caller
 * (core/extend.js sendText) since they require an async getUrlInfo() call.
 * @param {{ text: string, mentions?: string[], mentionAll?: boolean, contextInfo?: object }} opts
 */
function buildTextContent(opts) {
  var m = {
    extendedTextMessage: {
      text: String(opts.text || "")
    }
  };
  return createMessage(applyContextInfo(m, opts));
}

function buildButtonsContent(opts) {
  var buttons = (opts.buttons || []).map(function (button, i) {
    var buttonText = button.text || button.buttonText || button.displayText;
    if (button.nativeFlowInfo || button.name) {
      return {
        buttonId: button.id || button.buttonId || "btn_" + i,
        buttonText: typeof buttonText === "string" ? { displayText: buttonText } : buttonText,
        nativeFlowInfo: button.nativeFlowInfo || {
          name: button.name,
          paramsJson: typeof button.paramsJson === "string" ? button.paramsJson : JSON.stringify(button.paramsJson || {})
        },
        type: button.type || 2
      };
    }
    return {
      buttonId: button.id || button.buttonId || "btn_" + i,
      buttonText: typeof buttonText === "string" ? { displayText: buttonText } : buttonText,
      type: button.type || 1
    };
  });

  var buttonsMessage = {
    buttons: buttons,
    contentText: opts.text || opts.caption || "",
    headerType: 1,
    footerText: opts.footer || undefined
  };

  if (opts.headerMedia) {
    Object.assign(buttonsMessage, opts.headerMedia);
    var type = Object.keys(opts.headerMedia)[0] || "";
    var map = { imageMessage: 4, videoMessage: 5, documentMessage: 3, locationMessage: 2 };
    buttonsMessage.headerType = map[type] || 1;
  }

  return createMessage(applyContextInfo({ buttonsMessage: buttonsMessage }, opts));
}

function buildListContent(opts) {
  var m = {
    listMessage: {
      sections: opts.sections || [],
      buttonText: opts.buttonText || "Select",
      title: opts.title || "",
      footerText: opts.footer || "",
      description: opts.text || opts.description || "",
      listType: opts.listType || 1
    }
  };
  return createMessage(applyContextInfo(m, opts));
}

/**
 * Full interactive / nativeFlow builder — this is the single entry point
 * that backs `sock.sendInteractive()`, supporting BOTH plain
 * `interactiveButtons` arrays and pre-built `nativeFlowMessage` objects,
 * plus an optional media/location/product header, body/footer text, and a
 * carousel via `cards` (each card reusing this same buttons shape).
 *
 * Supports:
 *  - buttons / interactiveButtons / nativeFlowMessage (all equivalent inputs)
 *  - header: image / video / document / location / product (already prepared)
 *  - body, footer, title, subtitle
 *  - messageParamsJson
 *  - mentions / mentionAll
 *  - cards[] → carouselMessage (each card built the same way, minus contextInfo)
 * @param {object} opts
 */
function buildInteractiveContent(opts) {
  opts = opts || {};

  var buttonsField = Array.isArray(opts.buttons)
    ? opts.buttons
    : Array.isArray(opts.interactiveButtons)
      ? opts.interactiveButtons
      : (opts.nativeFlowMessage && opts.nativeFlowMessage.buttons) || [];

  var paramsJson = opts.messageParamsJson || opts.paramsJson || "";
  if (typeof paramsJson === "object" && paramsJson !== null) {
    paramsJson = JSON.stringify(paramsJson);
  }

  var interactiveMessage = {
    nativeFlowMessage: {
      buttons: buttonsField,
      messageParamsJson: paramsJson || undefined
    }
  };

  if (opts.text || opts.caption) {
    interactiveMessage.body = { text: opts.text || opts.caption };
  }
  if (opts.footer) {
    interactiveMessage.footer = { text: opts.footer };
  }

  var hasHeader = opts.title || opts.subtitle || opts.headerMedia || opts.locationMessage || opts.productMessage || opts.header;

  if (hasHeader) {
    interactiveMessage.header = {
      title: (opts.header && opts.header.title) || opts.title || "",
      subtitle: (opts.header && opts.header.subtitle) || opts.subtitle || "",
      hasMediaAttachment: !!(
        opts.headerMedia ||
        opts.locationMessage ||
        opts.productMessage ||
        (opts.header && opts.header.hasMediaAttachment)
      )
    };

    if (opts.headerMedia) {
      Object.assign(interactiveMessage.header, opts.headerMedia);
    }
    if (opts.locationMessage) {
      interactiveMessage.header.locationMessage = opts.locationMessage;
      interactiveMessage.header.hasMediaAttachment = true;
    }
    if (opts.productMessage) {
      interactiveMessage.header.productMessage = opts.productMessage;
      interactiveMessage.header.hasMediaAttachment = true;
    }
  }

  if (opts.thumbnail) {
    interactiveMessage.jpegThumbnail = opts.thumbnail;
  }

  var ctx = {};
  if (Array.isArray(opts.mentions) && opts.mentions.length) ctx.mentionedJid = opts.mentions;
  if (opts.mentionAll) ctx.nonJidMentions = 1;
  if (opts.contextInfo) Object.assign(ctx, opts.contextInfo);
  if (Object.keys(ctx).length) interactiveMessage.contextInfo = ctx;

  if (opts.asTemplate) {
    return createMessage({
      templateMessage: {
        interactiveMessageTemplate: interactiveMessage,
        templateId: opts.templateId || "template-" + Date.now()
      }
    });
  }

  return createMessage({ interactiveMessage: interactiveMessage });
}

/**
 * Carousel builder — one interactiveMessage.carouselMessage with N cards,
 * each card sharing the same header/body/footer/button shape as a single
 * interactive message (built via buildInteractiveContent's header logic).
 * @param {{ cards: object[], text?: string, footer?: string }} opts
 */
function buildCarouselContent(opts) {
  opts = opts || {};
  var cards = (opts.cards || []).map(function (card) {
    var buttonsField = Array.isArray(card.buttons)
      ? card.buttons
      : Array.isArray(card.interactiveButtons)
        ? card.interactiveButtons
        : (card.nativeFlowMessage && card.nativeFlowMessage.buttons) || [];

    var paramsJson = card.messageParamsJson || card.paramsJson || "";
    if (typeof paramsJson === "object" && paramsJson !== null) paramsJson = JSON.stringify(paramsJson);

    var cardObj = {
      nativeFlowMessage: {
        buttons: buttonsField,
        messageParamsJson: paramsJson || undefined
      }
    };

    if (card.text || card.caption) cardObj.body = { text: card.text || card.caption };
    if (card.footer) cardObj.footer = { text: card.footer };

    if (card.headerMedia || card.title || card.subtitle) {
      cardObj.header = {
        title: card.title || "",
        subtitle: card.subtitle || "",
        hasMediaAttachment: !!card.headerMedia
      };
      if (card.headerMedia) Object.assign(cardObj.header, card.headerMedia);
    }
    if (card.thumbnail) cardObj.jpegThumbnail = card.thumbnail;

    return cardObj;
  });

  var interactiveMessage = {
    carouselMessage: {
      cards: cards,
      carouselCardType: 0,
      messageVersion: 1
    }
  };
  if (opts.text) interactiveMessage.body = { text: opts.text };
  if (opts.footer) interactiveMessage.footer = { text: opts.footer };

  return createMessage({ interactiveMessage: interactiveMessage });
}

function buildAlbumHeader(counts) {
  return createMessage({
    albumMessage: {
      expectedImageCount: counts.imageCount || 0,
      expectedVideoCount: counts.videoCount || 0
    }
  });
}

function buildPollContent(opts) {
  var values = opts.values || [];
  var selectableCount = opts.selectableCount == null ? 1 : opts.selectableCount;
  var pollCreationMessage = {
    name: opts.name || "Poll",
    selectableOptionsCount: selectableCount,
    options: values.map(function (optionName) {
      return { optionName: String(optionName) };
    }),
    endTime: opts.endDate ? new Date(opts.endDate).getTime() : undefined,
    hideParticipantName: opts.hideVoter != null ? opts.hideVoter : false,
    allowAddOption: opts.canAddOption != null ? opts.canAddOption : false
  };

  var messageSecret = opts.messageSecret || crypto.randomBytes(32);
  var result = { messageContextInfo: { messageSecret: messageSecret } };

  if (opts.toAnnouncementGroup) {
    result.pollCreationMessageV2 = pollCreationMessage;
  } else if (opts.correctAnswer !== undefined || opts.pollType === 1) {
    result.pollCreationMessageV5 = Object.assign({}, pollCreationMessage, {
      correctAnswer: { optionName: String(opts.correctAnswer) },
      pollType: 1,
      selectableOptionsCount: 1
    });
  } else if (selectableCount === 1) {
    result.pollCreationMessageV3 = pollCreationMessage;
  } else {
    result.pollCreationMessage = pollCreationMessage;
  }

  return createMessage(result);
}

function buildPollResultContent(opts) {
  var pollResultSnapshotMessage = {
    name: opts.name || "Results",
    pollVotes: (opts.votes || []).map(function (vote) {
      return {
        optionName: vote.name || vote.optionName,
        optionVoteCount: parseInt(vote.voteCount != null ? vote.voteCount : vote.count || 0, 10)
      };
    }),
    pollType: opts.pollType === 1 ? 1 : 0
  };
  if (opts.pollType === 1) {
    return createMessage({ pollResultSnapshotMessageV3: pollResultSnapshotMessage });
  }
  return createMessage({ pollResultSnapshotMessage: pollResultSnapshotMessage });
}

function buildReactContent(opts) {
  return createMessage({
    reactionMessage: {
      text: opts.emoji || opts.text || "",
      key: opts.key,
      senderTimestampMs: Date.now()
    }
  });
}

/**
 * Location content — a plain top-level `locationMessage` key so
 * `getContentType()` (and therefore quoted-message injection inside
 * `generateWAMessageFromContent`) resolves correctly.
 * @param {{ latitude: number, longitude: number, name?: string, address?: string, url?: string, jpegThumbnail?: Buffer }} opts
 */
function buildLocationContent(opts) {
  var m = {
    locationMessage: {
      degreesLatitude: opts.latitude != null ? opts.latitude : 0,
      degreesLongitude: opts.longitude != null ? opts.longitude : 0,
      name: opts.name || "",
      address: opts.address || "",
      url: opts.url || "",
      jpegThumbnail: opts.jpegThumbnail || opts.thumbnail
    }
  };
  return createMessage(applyContextInfo(m, opts));
}

function buildVCard(c) {
  var name = c.fullName || c.displayName || c.name || "Contact";
  var phone = String(c.phoneNumber || c.number || "").replace(/\D/g, "");
  return "BEGIN:VCARD\nVERSION:3.0\nFN:" + name + "\nTEL;type=CELL;type=VOICE;waid=" + phone + ":+" + phone + "\nEND:VCARD";
}

function buildContactsContent(opts) {
  var contacts = opts.contacts || [];
  var vcards = contacts.map(function (c) {
    return {
      displayName: c.fullName || c.displayName || c.name || "Contact",
      vcard: c.vcard || buildVCard(c)
    };
  });

  var m =
    vcards.length === 1
      ? { contactMessage: vcards[0] }
      : {
          contactsArrayMessage: {
            displayName: vcards.length + " contacts",
            contacts: vcards
          }
        };
  return createMessage(applyContextInfo(m, opts));
}

/**
 * Build productMessage object (after image is prepared via
 * prepareWAMessageMedia). Nested under a plain top-level `productMessage`
 * key so it participates correctly in quoted-message injection.
 */
function buildProductMessage(opts, imageMessage) {
  return {
    productMessage: {
      product: {
        productImage: imageMessage,
        productId: opts.productId || "",
        title: opts.title || "",
        description: opts.description || "",
        currencyCode: opts.currencyCode || "IDR",
        priceAmount1000: opts.priceAmount1000 || 0,
        retailerId: opts.retailerId,
        url: opts.url,
        productImageCount: opts.productImageCount || 1
      },
      businessOwnerJid: opts.businessOwnerJid
    }
  };
}

exports.getProto = getProto;
exports.createMessage = createMessage;
exports.applyContextInfo = applyContextInfo;
exports.buildTextContent = buildTextContent;
exports.buildButtonsContent = buildButtonsContent;
exports.buildListContent = buildListContent;
exports.buildInteractiveContent = buildInteractiveContent;
exports.buildCarouselContent = buildCarouselContent;
exports.buildAlbumHeader = buildAlbumHeader;
exports.buildPollContent = buildPollContent;
exports.buildPollResultContent = buildPollResultContent;
exports.buildReactContent = buildReactContent;
exports.buildLocationContent = buildLocationContent;
exports.buildContactsContent = buildContactsContent;
exports.buildProductMessage = buildProductMessage;
exports.hasValidInteractiveHeader = hasValidInteractiveHeader;
