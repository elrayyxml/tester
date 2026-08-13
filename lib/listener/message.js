'use strict'

/**
 * Bind messages.upsert → serialize → optional user callback.
 * Also exposes the serialized object on the raw event for convenience.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindMessageListener(sock, options = {}) {
  if (!sock?.ev) return

  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert
    if (!Array.isArray(messages)) return

    for (const raw of messages) {
      try {
        // Attach serialized form for consumers that listen to the same event
        if (typeof sock.serialize === 'function') {
          raw._serialized = sock.serialize(raw)
        }
      } catch (err) {
        options.logger?.error?.({ err }, 'serialize failed')
      }
    }

    // Optional high-level callback
    if (typeof options.onMessage === 'function') {
      for (const raw of messages) {
        try {
          await options.onMessage({
            m: raw._serialized || sock.serialize?.(raw),
            raw,
            type,
            sock
          })
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
