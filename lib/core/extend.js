"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var relayMod = require("../listener/relay");
var relayRaw = relayMod.relayRaw;
var relayHelper = relayMod.relayHelper;
var prepareMedia = relayMod.prepareMedia;

var newsletterMod = require("../listener/newsletter");
var assertNewsletterJid = newsletterMod.assertNewsletterJid;

var mediaUtils = require("../utils/media");
var getBufferFromUrl = mediaUtils.getBufferFromUrl;
var detectMime = mediaUtils.detectMime;
var getAudioDuration = mediaUtils.getAudioDuration;
var getAudioWaveform = mediaUtils.getAudioWaveform;
var extractImageThumb = mediaUtils.extractImageThumb;

var linkPreview = require("../utils/link-preview");
var getUrlInfo = linkPreview.getUrlInfo;

var contentBuilder = require("../utils/content-builder");
var buildInteractiveContent = contentBuilder.buildInteractiveContent;
var buildCarouselContent = contentBuilder.buildCarouselContent;
var buildLocationContent = contentBuilder.buildLocationContent;
var buildContactsContent = contentBuilder.buildContactsContent;
var buildPollContent = contentBuilder.buildPollContent;
var buildPollResultContent = contentBuilder.buildPollResultContent;
var buildProductMessage = contentBuilder.buildProductMessage;
var buildAlbumHeader = contentBuilder.buildAlbumHeader;
var buildReactContent = contentBuilder.buildReactContent;

var messageUtils = require("../utils/message");
var getContentType = messageUtils.getContentType;

var errorsConst = require("../constant/errors");
var NexrayError = errorsConst.NexrayError;
var ErrorMessages = errorsConst.ErrorMessages;

var configureConst = require("../constant/configure");
var resolveLogger = configureConst.resolveLogger;

/**
 * @nexray/lib — core/extend.js
 *
 * Attaches every sock.sendX() helper onto an already-created Baileys socket
 * instance. This module never creates a socket and never manages auth/session
 * — it only mutates the `sock` object passed in, and returns it for chaining.
 *
 * Every sendX() here funnels through listener/relay.js's `relayRaw()` /
 * `relayHelper()`, which both end in `sock.relayMessage()`.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options] See PRD §6.2 for the full option surface.
 * @returns {import('baileys').WASocket}
 */
function Extend(sock, options) {
  options = options || {};

  if (!sock || typeof sock.relayMessage !== "function") {
    throw new NexrayError(ErrorMessages.INVALID_SOCKET, { code: "INVALID_SOCKET" });
  }

  var logger = resolveLogger(options);

  // ---------------------------------------------------------------------
  // sendText — supports mentions[], mentionAll, and automatic link preview
  // (unless linkPreview:false is passed). Goes through relayHelper() so
  // Baileys' own generateWAMessage() attaches contextInfo.quotedMessage
  // for us when `quoted` (3rd arg) is supplied.
  // ---------------------------------------------------------------------
  sock.sendText = async function sendText(jid, text, quoted, opts) {
    opts = opts || {};

    var content = { text: String(text == null ? "" : text) };

    if (Array.isArray(opts.mentions) && opts.mentions.length) {
      content.mentions = opts.mentions;
    }

    if (opts.mentionAll) {
      var meta = null;
      try {
        meta = typeof sock.groupMetadata === "function" ? await sock.groupMetadata(jid) : null;
      } catch (err) {
        logger.debug({ err: err }, "sendText: mentionAll failed to fetch groupMetadata");
      }
      if (meta && Array.isArray(meta.participants)) {
        var existing = content.mentions || [];
        content.mentions = existing.concat(
          meta.participants.map(function (p) {
            return p.id;
          })
        );
      }
    }

    if (opts.linkPreview !== false) {
      var info = await getUrlInfo(content.text, { uploadImage: true, logger: logger }).catch(function () {
        return undefined;
      });
      if (info) content.linkPreview = info;
    } else {
      content.linkPreview = null;
    }

    if (opts.ephemeral) content.ephemeralExpiration = opts.ephemeral;

    return relayHelper(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        ephemeralExpiration: opts.ephemeral,
        additionalNodes: opts.additionalNodes,
        additionalAttributes: opts.additionalAttributes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendAdText — text with a MANUALLY supplied link preview (thumbnailUrl,
  // title, description, etc). Does not call getUrlInfo(); the caller fully
  // controls the preview payload — useful for ad-style / custom-branded
  // link cards.
  // ---------------------------------------------------------------------
  sock.sendAdText = async function sendAdText(jid, text, quoted, opts) {
    opts = opts || {};

    var thumbnailBuffer;
    if (opts.thumbnail) {
      thumbnailBuffer = opts.thumbnail;
    } else if (opts.thumbnailUrl) {
      try {
        var buf = await getBufferFromUrl(opts.thumbnailUrl);
        thumbnailBuffer = await extractImageThumb(buf, 300);
      } catch (err) {
        logger.debug({ err: err }, "sendAdText: failed to fetch thumbnailUrl");
      }
    }

    var content = {
      text: String(text == null ? "" : text),
      linkPreview: {
        "canonical-url": opts.url || opts.thumbnailUrl || "",
        "matched-text": opts.matchedText || opts.url || "",
        title: opts.title || "",
        description: opts.description || "",
        previewType: opts.previewType || 0,
        jpegThumbnail: thumbnailBuffer,
        renderLargerThumbnail: !!opts.largeThumbnail,
        showAdAttribution: !!opts.showAdAttribution
      }
    };

    if (Array.isArray(opts.mentions) && opts.mentions.length) {
      content.mentions = opts.mentions;
    }

    return relayHelper(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        ephemeralExpiration: opts.ephemeral,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendReact
  // ---------------------------------------------------------------------
  sock.sendReact = async function sendReact(jid, emoji, key) {
    if (!key || !key.id) {
      throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: "MISSING_CONTENT" });
    }
    var content = buildReactContent({ emoji: emoji, key: key });
    return relayRaw(sock, jid, content, {}, options);
  };

  // ---------------------------------------------------------------------
  // sendMedia — auto-detects image/video/audio/document from the buffer's
  // magic bytes (via utils/media.detectMime). PTT (voice note) support:
  // when opts.ptt is true, duration + waveform are computed via
  // utils/media.getAudioDuration()/getAudioWaveform() (audio-decode based)
  // unless the caller already supplied them.
  // ---------------------------------------------------------------------
  sock.sendMedia = async function sendMedia(jid, input, caption, quoted, opts) {
    opts = opts || {};
    if (typeof caption === "object" && caption !== null && quoted === undefined) {
      // sendMedia(jid, input, opts) shorthand — caption arg was actually opts
      opts = caption;
      caption = opts.caption;
      quoted = opts.quoted;
    }

    var buffer = await getBufferFromUrl(input);
    var mime = opts.mime || (await detectMime(buffer, opts.filename));

    var content;
    if (opts.document || (mime && mime === "application/octet-stream" && !opts.forceImage)) {
      content = {
        document: buffer,
        mimetype: mime || "application/octet-stream",
        fileName: opts.filename || opts.fileName || "file",
        caption: caption
      };
    } else if (mime && mime.startsWith("image/")) {
      content = { image: buffer, caption: caption };
    } else if (mime && mime.startsWith("video/")) {
      content = {
        video: buffer,
        caption: caption,
        gifPlayback: !!opts.gif,
        ptv: !!opts.ptv
      };
    } else if (mime && mime.startsWith("audio/")) {
      content = { audio: buffer, mimetype: mime, ptt: !!opts.ptt };

      if (opts.ptt) {
        content.seconds = opts.seconds != null ? opts.seconds : await getAudioDuration(buffer, { logger: logger });
        content.waveform = opts.waveform || (await getAudioWaveform(buffer, { logger: logger }));
      }
    } else {
      content = {
        document: buffer,
        mimetype: mime || "application/octet-stream",
        fileName: opts.filename || opts.fileName || "file",
        caption: caption
      };
    }

    if (Array.isArray(opts.mentions) && opts.mentions.length) content.mentions = opts.mentions;
    if (opts.viewOnce) content.viewOnce = true;

    return relayHelper(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        ephemeralExpiration: opts.ephemeral,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendPtv — shorthand for a video-note (round "point to view" video).
  // ---------------------------------------------------------------------
  sock.sendPtv = async function sendPtv(jid, input, quoted, opts) {
    opts = Object.assign({}, opts, { ptv: true });
    return sock.sendMedia(jid, input, undefined, quoted, opts);
  };

  // ---------------------------------------------------------------------
  // sendSticker
  // ---------------------------------------------------------------------
  sock.sendSticker = async function sendSticker(jid, input, quoted, opts) {
    opts = opts || {};
    var buffer = await getBufferFromUrl(input);

    var content = {
      sticker: buffer,
      isAnimated: !!opts.isAnimated,
      isAiSticker: !!opts.isAiSticker,
      isAvatar: !!opts.isAvatar,
      isLottie: !!opts.isLottie,
      packname: opts.packName || opts.packname,
      author: opts.packPublisher || opts.author
    };

    return relayHelper(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        ephemeralExpiration: opts.ephemeral,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendStickerPack
  // ---------------------------------------------------------------------
  sock.sendStickerPack = async function sendStickerPack(jid, inputs, quoted, opts) {
    opts = opts || {};
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: "STICKER_PACK_EMPTY" });
    }
    if (inputs.length > 60) {
      throw new NexrayError("Sticker pack exceeds the maximum of 60 stickers.", { code: "STICKER_PACK_LIMIT" });
    }

    var stickerBuffers = await Promise.all(inputs.map(getBufferFromUrl));
    var coverBuffer = opts.cover ? await getBufferFromUrl(opts.cover) : stickerBuffers[0];

    var content = {
      stickerPack: {
        name: opts.name || "Sticker Pack",
        publisher: opts.publisher || "",
        stickers: stickerBuffers,
        cover: coverBuffer,
        description: opts.description,
        caption: opts.caption
      }
    };

    return relayHelper(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendLocation — plain location message. Quoting works correctly because
  // buildLocationContent() nests a single top-level `locationMessage` key
  // (see utils/content-builder.js), which relayRaw() → generateWAMessageFromContent()
  // needs to correctly detect via getContentType() and attach
  // contextInfo.quotedMessage.
  //
  // WhatsApp has no native "locationMessage + buttons" combination — if you
  // need a location WITH buttons attached, use sock.sendInteractive({ location })
  // instead (see below), which builds a proper interactiveMessage header.
  // ---------------------------------------------------------------------
  sock.sendLocation = async function sendLocation(jid, loc, quoted, opts) {
    opts = opts || {};
    loc = loc || {};

    var jpegThumbnail;
    if (opts.thumbnail) {
      jpegThumbnail = opts.thumbnail;
    } else if (loc.thumbnailUrl) {
      try {
        var buf = await getBufferFromUrl(loc.thumbnailUrl);
        jpegThumbnail = await extractImageThumb(buf, 200);
      } catch (err) {
        logger.debug({ err: err }, "sendLocation: failed to build thumbnail");
      }
    }

    var content = buildLocationContent({
      latitude: loc.latitude,
      longitude: loc.longitude,
      name: loc.name,
      address: loc.address,
      url: loc.url,
      jpegThumbnail: jpegThumbnail,
      mentions: opts.mentions,
      mentionAll: opts.mentionAll,
      contextInfo: opts.contextInfo
    });

    return relayRaw(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        ephemeralExpiration: opts.ephemeral,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendContact
  // ---------------------------------------------------------------------
  sock.sendContact = async function sendContact(jid, contacts, quoted, opts) {
    opts = opts || {};
    var list = Array.isArray(contacts) ? contacts : [contacts];

    var content = buildContactsContent({
      contacts: list,
      mentions: opts.mentions,
      contextInfo: opts.contextInfo
    });

    return relayRaw(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendAlbum — mirrors Baileys' official `{ album: [...] }` pattern from
  // messages-send.js EXACTLY:
  //   1. generateWAMessage(jid, { album: items }) once → produces the
  //      albumMessage HEADER (fullMsg), relayed first.
  //   2. For each item, generateWAMessage(jid, item) separately, inject
  //      messageContextInfo.messageAssociation { parentMessageKey: header.key,
  //      associationType: MEDIA_ALBUM (1) }, then relay each child in order.
  //
  // This differs from (and fixes) a previous 2-step manual approach that
  // relayed the header and children through mismatched code paths and lost
  // the parent/child association.
  // ---------------------------------------------------------------------
  sock.sendAlbum = async function sendAlbum(jid, items, quoted, opts) {
    opts = opts || {};
    if (!Array.isArray(items) || items.length < 2) {
      throw new NexrayError(ErrorMessages.INVALID_ALBUM, { code: "ALBUM_MIN_ITEMS" });
    }

    var baileys = require("baileys");
    var generateWAMessage = baileys.generateWAMessage;

    var prepared = await Promise.all(
      items.map(async function (item) {
        var buffer = await getBufferFromUrl(item.url || item.buffer || item);
        var mime = item.mime || (await detectMime(buffer));
        if (mime && mime.startsWith("video/")) {
          return { video: buffer, caption: item.caption };
        }
        return { image: buffer, caption: item.caption };
      })
    );

    var imageCount = prepared.filter(function (p) {
      return !!p.image;
    }).length;
    var videoCount = prepared.filter(function (p) {
      return !!p.video;
    }).length;

    var functionsUtils = require("../utils/functions");
    var headerMessageId = generateWAMessage ? undefined : undefined; // header id resolved by generateWAMessage below

    var headerFullMsg = await generateWAMessage(
      jid,
      { album: prepared },
      {
        userJid: sock.user && sock.user.id,
        quoted: relayMod.normalizeQuoted(quoted),
        upload: sock.waUploadToServer,
        messageId: functionsUtils.generateMessageId(sock.user && sock.user.id, options.messageIdPrefix)
      }
    );

    await sock.relayMessage(jid, headerFullMsg.message, {
      messageId: headerFullMsg.key.id,
      additionalNodes: opts.additionalNodes
    });

    var AssociationType = { MEDIA_ALBUM: 1 };
    var childKeys = [];

    for (var i = 0; i < prepared.length; i++) {
      var childContent = prepared[i];
      var childFullMsg = await generateWAMessage(jid, childContent, {
        userJid: sock.user && sock.user.id,
        upload: sock.waUploadToServer,
        messageId: functionsUtils.generateMessageId(sock.user && sock.user.id, options.messageIdPrefix)
      });

      var childTypeKey = getContentType(childFullMsg.message);
      childFullMsg.message.messageContextInfo = Object.assign({}, childFullMsg.message.messageContextInfo || {}, {
        messageAssociation: {
          parentMessageKey: headerFullMsg.key,
          associationType: AssociationType.MEDIA_ALBUM
        }
      });

      await sock.relayMessage(jid, childFullMsg.message, {
        messageId: childFullMsg.key.id
      });

      childKeys.push(childFullMsg.key);
    }

    headerFullMsg.albumChildren = childKeys;
    return headerFullMsg;
  };

  // ---------------------------------------------------------------------
  // sendPoll
  // ---------------------------------------------------------------------
  sock.sendPoll = async function sendPoll(jid, values, quoted, opts) {
    opts = opts || {};
    var content = buildPollContent({
      name: opts.name || "Poll",
      values: values,
      selectableCount: opts.selectableCount,
      toAnnouncementGroup: opts.toAnnouncementGroup,
      endDate: opts.endDate,
      hideVoter: opts.hideVoter,
      canAddOption: opts.canAddOption
    });
    return relayRaw(sock, jid, content, { quoted: quoted }, options);
  };

  // ---------------------------------------------------------------------
  // sendQuiz — newsletter-only (WhatsApp restriction).
  // ---------------------------------------------------------------------
  sock.sendQuiz = async function sendQuiz(newsletterJid, values, quoted, opts) {
    opts = opts || {};
    assertNewsletterJid(newsletterJid);
    if (opts.correctAnswer === undefined) {
      throw new NexrayError(ErrorMessages.QUIZ_MISSING_CORRECT, { code: "QUIZ_MISSING_CORRECT" });
    }

    var content = buildPollContent({
      name: opts.name || "Quiz",
      values: values,
      correctAnswer: opts.correctAnswer,
      pollType: 1
    });
    return relayRaw(sock, newsletterJid, content, { quoted: quoted }, options);
  };

  // ---------------------------------------------------------------------
  // sendPollResult / sendQuizResult
  // ---------------------------------------------------------------------
  sock.sendPollResult = async function sendPollResult(jid, name, votes, quoted) {
    var content = buildPollResultContent({ name: name, votes: votes, pollType: 0 });
    return relayRaw(sock, jid, content, { quoted: quoted }, options);
  };

  sock.sendQuizResult = async function sendQuizResult(jid, name, votes, quoted) {
    var content = buildPollResultContent({ name: name, votes: votes, pollType: 1 });
    return relayRaw(sock, jid, content, { quoted: quoted }, options);
  };

  // ---------------------------------------------------------------------
  // sendInteractive — THE unified entry point for interactiveMessage /
  // nativeFlowMessage, covering:
  //   - plain quick-reply / url / call / copy buttons (opts.buttons)
  //   - raw nativeFlow button objects (opts.interactiveButtons / opts.nativeFlowMessage)
  //   - a media/location/product header (opts.media, opts.location, opts.product)
  //   - templated form (opts.asTemplate)
  //
  // Any media supplied via opts.media is uploaded first (prepareMedia →
  // prepareWAMessageMedia) and merged into the interactiveMessage header,
  // so header + buttons + body all live in ONE interactiveMessage — this is
  // also the correct way to attach a location or product to buttons, since
  // WhatsApp doesn't support buttons directly on a bare locationMessage or
  // productMessage.
  // ---------------------------------------------------------------------
  sock.sendInteractive = async function sendInteractive(jid, buttons, quoted, opts) {
    opts = opts || {};

    var headerMedia;
    if (opts.media) {
      var mediaBuffer = await getBufferFromUrl(opts.media);
      var mime = opts.mediaMime || (await detectMime(mediaBuffer));
      var mediaKey = mime && mime.startsWith("video/") ? "video" : mime && mime.startsWith("document") ? "document" : "image";
      var prepared = await prepareMedia(sock, (function () {
        var m = {};
        m[mediaKey] = mediaBuffer;
        return m;
      })());
      headerMedia = prepared;
    }

    var locationMessage;
    if (opts.location) {
      locationMessage = {
        degreesLatitude: opts.location.latitude,
        degreesLongitude: opts.location.longitude,
        name: opts.location.name,
        address: opts.location.address
      };
    }

    var productMessage;
    if (opts.product) {
      var productImage;
      if (opts.product.image) {
        var pBuf = await getBufferFromUrl(opts.product.image);
        var pPrepared = await prepareMedia(sock, { image: pBuf });
        productImage = pPrepared.imageMessage;
      }
      var built = buildProductMessage(opts.product, productImage);
      productMessage = built.productMessage;
    }

    var content = buildInteractiveContent({
      buttons: Array.isArray(buttons) ? buttons : undefined,
      interactiveButtons: opts.interactiveButtons,
      nativeFlowMessage: opts.nativeFlowMessage,
      messageParamsJson: opts.messageParamsJson || opts.paramsJson,
      text: opts.text || opts.caption,
      footer: opts.footer,
      title: opts.title,
      subtitle: opts.subtitle,
      header: opts.header,
      headerMedia: headerMedia,
      locationMessage: locationMessage,
      productMessage: productMessage,
      thumbnail: opts.thumbnail,
      mentions: opts.mentions,
      mentionAll: opts.mentionAll,
      contextInfo: opts.contextInfo,
      asTemplate: opts.asTemplate,
      templateId: opts.templateId
    });

    return relayRaw(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        ephemeralExpiration: opts.ephemeral,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendCarousel — thin wrapper around sendInteractive's carousel builder;
  // NOT a separate content type from interactiveMessage — a carousel IS an
  // interactiveMessage.carouselMessage under the hood, sharing the exact
  // same button/header shape as sendInteractive.
  // ---------------------------------------------------------------------
  sock.sendCarousel = async function sendCarousel(jid, cards, quoted, opts) {
    opts = opts || {};

    var preparedCards = await Promise.all(
      (cards || []).map(async function (card) {
        var headerMedia;
        if (card.media) {
          var mediaBuffer = await getBufferFromUrl(card.media);
          var mime = card.mediaMime || (await detectMime(mediaBuffer));
          var mediaKey = mime && mime.startsWith("video/") ? "video" : "image";
          var prepared = await prepareMedia(sock, (function () {
            var m = {};
            m[mediaKey] = mediaBuffer;
            return m;
          })());
          headerMedia = prepared;
        }
        return Object.assign({}, card, { headerMedia: headerMedia });
      })
    );

    var content = buildCarouselContent({
      cards: preparedCards,
      text: opts.text || opts.caption,
      footer: opts.footer
    });

    return relayRaw(
      sock,
      jid,
      content,
      {
        quoted: quoted,
        additionalNodes: opts.additionalNodes
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // sendLegacyButton — legacy buttonsMessage (deprecated by WhatsApp but
  // still requested by some consumers for backward compatibility).
  // ---------------------------------------------------------------------
  sock.sendLegacyButton = async function sendLegacyButton(jid, buttons, quoted, opts) {
    opts = opts || {};
    var buildButtonsContent = contentBuilder.buildButtonsContent;

    var headerMedia;
    if (opts.media) {
      var mediaBuffer = await getBufferFromUrl(opts.media);
      var mime = opts.mediaMime || (await detectMime(mediaBuffer));
      var mediaKey = mime && mime.startsWith("video/") ? "video" : "image";
      headerMedia = await prepareMedia(sock, (function () {
        var m = {};
        m[mediaKey] = mediaBuffer;
        return m;
      })());
    }

    var content = buildButtonsContent({
      buttons: buttons,
      text: opts.text || opts.caption,
      footer: opts.footer,
      headerMedia: headerMedia,
      mentions: opts.mentions,
      contextInfo: opts.contextInfo
    });

    return relayRaw(sock, jid, content, { quoted: quoted, additionalNodes: opts.additionalNodes }, options);
  };
  // (sendLegacyButton ends above; sendLegacyList continues below)

  // ---------------------------------------------------------------------
  // sendLegacyList — private-chat only (WhatsApp restriction).
  // ---------------------------------------------------------------------
  sock.sendLegacyList = async function sendLegacyList(jid, sections, quoted, opts) {
    opts = opts || {};
    if (typeof jid !== "string" || !jid.endsWith("@s.whatsapp.net")) {
      throw new NexrayError(ErrorMessages.LEGACY_LIST_IN_GROUP, { code: "LEGACY_LIST_IN_GROUP" });
    }

    var buildListContent = contentBuilder.buildListContent;
    var content = buildListContent({
      sections: sections,
      title: opts.title,
      text: opts.text || opts.description,
      footer: opts.footer,
      buttonText: opts.buttonText,
      mentions: opts.mentions,
      contextInfo: opts.contextInfo
    });

    return relayRaw(sock, jid, content, { quoted: quoted, additionalNodes: opts.additionalNodes }, options);
  };

  // ---------------------------------------------------------------------
  // sendOrderMessage
  // ---------------------------------------------------------------------
  sock.sendOrderMessage = async function sendOrderMessage(jid, thumbnail, text, quoted) {
    var thumbBuffer = thumbnail ? await getBufferFromUrl(thumbnail) : undefined;
    var content = {
      orderMessage: {
        orderId: "0",
        thumbnail: thumbBuffer,
        itemCount: 0,
        status: 1,
        message: text || ""
      }
    };
    return relayRaw(sock, jid, content, { quoted: quoted }, options);
  };

  // ---------------------------------------------------------------------
  // sendCopyMessage — forwards/copies an existing message's content as-is.
  // ---------------------------------------------------------------------
  sock.sendCopyMessage = async function sendCopyMessage(jid, quoted, opts) {
    opts = opts || {};
    var normalized = relayMod.normalizeQuoted(quoted);
    if (!normalized || !normalized.message) {
      throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: "MISSING_CONTENT" });
    }

    var functionsUtils = require("../utils/functions");
    var messageId = functionsUtils.generateMessageId(sock.user && sock.user.id, options.messageIdPrefix);

    var contentTypeKey = getContentType(normalized.message);
    var content = JSON.parse(JSON.stringify(normalized.message));
    if (content[contentTypeKey] && typeof content[contentTypeKey] === "object") {
      content[contentTypeKey].contextInfo = Object.assign({}, content[contentTypeKey].contextInfo || {}, {
        isForwarded: opts.forwarded !== false,
        forwardingScore: opts.forwardingScore || 1
      });
    }

    await sock.relayMessage(jid, content, { messageId: messageId, additionalNodes: opts.additionalNodes });
    return { key: { remoteJid: jid, id: messageId, fromMe: true }, message: content };
  };

  // ---------------------------------------------------------------------
  // sendStatus / sendGroupStatus
  // ---------------------------------------------------------------------
  sock.sendStatus = async function sendStatus(jids, content) {
    var targetJids = Array.isArray(jids) ? jids : [jids];
    return relayHelper(
      sock,
      "status@broadcast",
      content,
      {
        statusJidList: targetJids,
        additionalAttributes: { to: "status@broadcast", type: "text" }
      },
      options
    );
  };

  sock.sendGroupStatus = async function sendGroupStatus(jid, content) {
    return relayHelper(
      sock,
      jid,
      content,
      {
        additionalAttributes: { to: jid, type: "groupStatus" }
      },
      options
    );
  };

  // ---------------------------------------------------------------------
  // findUserId — sync PN <-> LID resolution from the local signal store,
  // when the underlying Baileys socket exposes one. Best-effort: fields are
  // left undefined when not resolvable rather than throwing.
  // ---------------------------------------------------------------------
  sock.findUserId = function findUserId(jid) {
    var result = { phoneNumber: undefined, lid: undefined };
    if (!jid || typeof jid !== "string") return result;

    if (jid.endsWith("@s.whatsapp.net")) {
      result.phoneNumber = jid;
    } else if (jid.endsWith("@lid")) {
      result.lid = jid;
    }

    try {
      var mapper = sock.signalRepository && sock.signalRepository.lidMapping;
      if (mapper) {
        if (jid.endsWith("@lid") && typeof mapper.getPNForLID === "function") {
          var pn = mapper.getPNForLID(jid);
          if (pn) result.phoneNumber = pn;
        } else if (jid.endsWith("@s.whatsapp.net") && typeof mapper.getLIDForPN === "function") {
          var lid = mapper.getLIDForPN(jid);
          if (lid) result.lid = lid;
        }
      }
    } catch (err) {
      logger.debug({ err: err }, "findUserId: lid mapping lookup failed");
    }

    return result;
  };

  // ---------------------------------------------------------------------
  // serialize() — attach the serializer as a bound socket method too, so
  // consumers can call `sock.serialize(msg)` directly (used internally by
  // listener/message.js's bindMessageListener, and by m.reply()'s quoted
  // re-serialization).
  // ---------------------------------------------------------------------
  var serializeMod = require("./serialize");
  sock.serialize = function serialize(msg) {
    return serializeMod.serialize(sock, msg, options);
  };

  // ---------------------------------------------------------------------
  // Startup side effects — both are strictly opt-in, driven only by the
  // `options` object the consumer passed to Extend()/Client(). No hidden
  // JIDs, no scheduled background calls anywhere in this file — see
  // listener/newsletter.js's runAutoFollowNewsletter() docstring.
  // ---------------------------------------------------------------------
  if (options.updateProtoOnStartup !== false) {
    var protoUpdate = require("../utils/proto-update");
    protoUpdate.updateProtoOnStartup(logger).catch(function (err) {
      logger.debug({ err: err }, "updateProtoOnStartup failed silently");
    });
  }

  if (options.autoFollowNewsletter) {
    newsletterMod.runAutoFollowNewsletter(sock, options).catch(function (err) {
      logger.debug({ err: err }, "autoFollowNewsletter failed silently");
    });
  }

  return sock;
}

exports.Extend = Extend;
