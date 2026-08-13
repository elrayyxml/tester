'use strict'

/**
 * Optional lightweight handler for chats.upsert / chats.update.
 * Currently only re-emits; can be extended by the consumer.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindChatListener(sock, options = {}) {
  if (!sock?.ev) return

  if (typeof options.onChatUpsert === 'function') {
    sock.ev.on('chats.upsert', (chats) => {
      try {
        options.onChatUpsert(chats, sock)
      } catch (err) {
        options.logger?.error?.({ err }, 'onChatUpsert error')
      }
    })
  }

  if (typeof options.onChatUpdate === 'function') {
    sock.ev.on('chats.update', (updates) => {
      try {
        options.onChatUpdate(updates, sock)
      } catch (err) {
        options.logger?.error?.({ err }, 'onChatUpdate error')
      }
    })
  }
}

module.exports = {
  bindChatListener
}
