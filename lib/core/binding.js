/** @module core/binding */

import {
  reply,
  sendReact,
  sendFile,
  sendSticker,
  sendMessageModify,
  pollResult,
  sendContact,
  sendAlbumMessage,
  groupStatus,
  replyButton,
  sendMetaMsg,
} from './message.js';

/**
 * Tempelkan helper pengiriman ke sock. Bila `adapter` diberikan, `sock.on`,
 * `sock.once`, dan `sock.off` diteruskan ke emitter adapter sehingga event
 * bawaan (connect, message, group.add, dst.) bisa didengarkan lewat
 * `sock.on(...)`, sementara event mentah zapo tetap lewat `sock.ev.on(...)`.
 *
 * @param {object} sock
 * @param {import('events').EventEmitter} [adapter] emitter event bawaan
 * @returns {object} sock yang sama, sudah berhelper
 */
export function bindHelpers(sock, adapter) {
  if (adapter) {
    sock.on = (event, listener) => adapter.on(event, listener);
    sock.once = (event, listener) => adapter.once(event, listener);
    sock.off = (event, listener) => adapter.off(event, listener);
  }

  sock.reply = (chat, content, message, options) => reply(sock, chat, content, message, options);
  sock.sendReact = (chat, emoji, key) => sendReact(sock, chat, emoji, key);
  sock.sendFile = (chat, source, filename, caption, message, options) =>
    sendFile(sock, chat, source, filename, caption, message, options);
  sock.sendSticker = (chat, source, message, options) =>
    sendSticker(sock, chat, source, message, options);
  sock.sendMessageModify = (chat, text, message, options) =>
    sendMessageModify(sock, chat, text, message, options);
  sock.pollResult = (chat, data, message) => pollResult(sock, chat, data, message);
  sock.sendContact = (chat, contacts, message, options) =>
    sendContact(sock, chat, contacts, message, options);
  sock.sendAlbumMessage = (chat, items, message) => sendAlbumMessage(sock, chat, items, message);
  sock.groupStatus = (chat, data, options) => groupStatus(sock, chat, data, options);
  sock.replyButton = (chat, buttons, message, options) =>
    replyButton(sock, chat, buttons, message, options);
  sock.sendMetaMsg = (chat, parts, message, options) =>
    sendMetaMsg(sock, chat, parts, message, options);
  return sock;
}
