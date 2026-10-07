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

  const helpers = {
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
  };
  for (const [name, helper] of Object.entries(helpers)) {
    sock[name] = (...args) => helper(sock, ...args);
  }
  return sock;
}
