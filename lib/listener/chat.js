'use strict'

function bindChatListeners(sock, options = {}) {
  if (!sock?.ev?.on) return sock
  if (typeof options.onChatsUpsert === 'function') sock.ev.on('chats.upsert', value => options.onChatsUpsert(value))
  if (typeof options.onChatsUpdate === 'function') sock.ev.on('chats.update', value => options.onChatsUpdate(value))
  return sock
}

module.exports = { bindChatListeners }
