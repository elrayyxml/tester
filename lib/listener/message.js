'use strict'

/**
 * Bind messages.upsert → serialize → optional user callback.
 *
 * NOTE: We intentionally do NOT attach `_serialized` back onto the raw
 * message object. That created a circular structure (raw → _serialized →
 * fakeObj/message → raw) which breaks JSON.stringify / logging.
 *
 * Consumers should call `sock.serialize(msg)` themselves, or use the
 * optional `onMessage` callback which already receives the serialized `m`.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindMessageListener(sock, options = {}) {
  if (!sock?.ev) return

  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert
    if (!Array.isArray(messages)) return

    // Optional high-level callback
    if (typeof options.onMessage === 'function') {
      for (const raw of messages) {
        try {
          const m = typeof sock.serialize === 'function' ? sock.serialize(raw) : null
          await options.onMessage({ m, raw, type, sock })
        } catch (err) {
          options.logger?.error?.({ err }, 'onMessage handler error')
        }
      }
    }
  })
}

module.exports = {
  bindMessageListener
}
