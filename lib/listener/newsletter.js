"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var errorsConst = require("../constant/errors");
var NexrayError = errorsConst.NexrayError;
var ErrorMessages = errorsConst.ErrorMessages;

/**
 * @nexray/lib — listener/newsletter.js
 *
 * Binds optional newsletter-related event callbacks, and performs the
 * explicit, opt-in `autoFollowNewsletter` startup action.
 *
 * IMPORTANT — no hidden network calls: `autoFollowNewsletter` only ever
 * follows JIDs the consumer passed in `options` at Client()/Extend() call
 * time. There is intentionally no hardcoded JID or scheduled background
 * call anywhere in this file — every network side effect here is traceable
 * directly to a documented option the consumer controls.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindNewsletterListener(sock, options) {
  options = options || {};
  if (!sock || !sock.ev) return;

  if (typeof options.onNewsletterReaction === "function") {
    sock.ev.on("newsletter.reaction", function (data) {
      try {
        options.onNewsletterReaction(data, sock);
      } catch (err) {
        if (options.logger && options.logger.error) options.logger.error({ err: err }, "onNewsletterReaction error");
      }
    });
  }

  if (typeof options.onNewsletterView === "function") {
    sock.ev.on("newsletter.view", function (data) {
      try {
        options.onNewsletterView(data, sock);
      } catch (err) {
        if (options.logger && options.logger.error) options.logger.error({ err: err }, "onNewsletterView error");
      }
    });
  }

  if (typeof options.onNewsletterParticipantsUpdate === "function") {
    sock.ev.on("newsletter-participants.update", function (data) {
      try {
        options.onNewsletterParticipantsUpdate(data, sock);
      } catch (err) {
        if (options.logger && options.logger.error) {
          options.logger.error({ err: err }, "onNewsletterParticipantsUpdate error");
        }
      }
    });
  }
}

/**
 * Runs the explicit `autoFollowNewsletter` startup action. No-op unless the
 * consumer supplied a non-false value.
 * @param {import('baileys').WASocket} sock
 * @param {object} options
 * @returns {Promise<void>}
 */
async function runAutoFollowNewsletter(sock, options) {
  options = options || {};
  var target = options.autoFollowNewsletter;
  if (!target || target === false) return;

  var jids = Array.isArray(target) ? target : [target];
  var logger = options.logger;

  for (var i = 0; i < jids.length; i++) {
    var jid = jids[i];
    if (typeof jid !== "string" || !jid.endsWith("@newsletter")) {
      if (logger && logger.warn) {
        logger.warn({ jid: jid }, "autoFollowNewsletter: skipped invalid newsletter JID");
      }
      continue;
    }
    try {
      if (typeof sock.newsletterFollow === "function") {
        await sock.newsletterFollow(jid);
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn({ jid: jid, err: err }, "autoFollowNewsletter: failed to follow");
      }
    }
  }
}

/**
 * Asserts `jid` is a valid newsletter JID, throwing NexrayError otherwise.
 * Used by sendQuiz() / other newsletter-only send helpers.
 * @param {string} jid
 */
function assertNewsletterJid(jid) {
  if (typeof jid !== "string" || !jid.endsWith("@newsletter")) {
    throw new NexrayError(ErrorMessages.INVALID_NEWSLETTER_JID, { code: "INVALID_NEWSLETTER_JID" });
  }
}

exports.bindNewsletterListener = bindNewsletterListener;
exports.runAutoFollowNewsletter = runAutoFollowNewsletter;
exports.assertNewsletterJid = assertNewsletterJid;
