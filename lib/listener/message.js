'use strict'

const { serialize } = require('../core/serialize')

function bindMessageListener(sock, options = {}) {
  if (!sock?.ev?.on) return sock
  const handler = async event => {
    for (const raw of event?.messages || []) {
      const message = serialize(sock, raw, options)
      if (typeof options.onMessage === 'function') await options.onMessage(message, event)
      if (typeof options.message === 'function') await options.message(message, event)
      if (typeof options.onMessagesUpsert === 'function') await options.onMessagesUpsert(message, event)
    }
  }
  sock.ev.on('messages.upsert', handler)
  sock.__wbMessageListener = handler
  return sock
}

module.exports = { bindMessageListener }
