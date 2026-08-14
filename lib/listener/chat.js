"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * @nexray/lib — listener/chat.js
 * Optional lightweight handler for chats.upsert / chats.update.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindChatListener(sock, options) {
  options = options || {};
  if (!sock || !sock.ev) return;

  if (typeof options.onChatUpsert === "function") {
    sock.ev.on("chats.upsert", function (chats) {
      try {
        options.onChatUpsert(chats, sock);
      } catch (err) {
        if (options.logger && options.logger.error) options.logger.error({ err: err }, "onChatUpsert error");
      }
    });
  }

  if (typeof options.onChatUpdate === "function") {
    sock.ev.on("chats.update", function (updates) {
      try {
        options.onChatUpdate(updates, sock);
      } catch (err) {
        if (options.logger && options.logger.error) options.logger.error({ err: err }, "onChatUpdate error");
      }
    });
  }
}

exports.bindChatListener = bindChatListener;
