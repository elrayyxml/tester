"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * @nexray/lib — listener/message.js
 *
 * Binds messages.upsert → serialize → optional consumer callback.
 *
 * NOTE: we intentionally do NOT attach `_serialized` back onto the raw
 * message object — that creates a circular structure (raw → _serialized →
 * message → raw) which breaks JSON.stringify()/logging. Consumers should
 * call `sock.serialize(msg)` themselves, or use the optional `onMessage`
 * callback which already receives the serialized `m`.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindMessageListener(sock, options) {
  options = options || {};
  if (!sock || !sock.ev) return;

  sock.ev.on("messages.upsert", async function (upsert) {
    var messages = upsert.messages;
    var type = upsert.type;
    if (!Array.isArray(messages)) return;

    if (typeof options.onMessage !== "function") return;

    for (var i = 0; i < messages.length; i++) {
      var raw = messages[i];
      try {
        var m = typeof sock.serialize === "function" ? sock.serialize(raw) : null;
        await options.onMessage({ m: m, raw: raw, type: type, sock: sock });
      } catch (err) {
        if (options.logger && options.logger.error) {
          options.logger.error({ err: err }, "onMessage handler error");
        }
      }
    }
  });
}

exports.bindMessageListener = bindMessageListener;
