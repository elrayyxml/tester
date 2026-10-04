/** @module core/message-util */

import { getContentType, messageText } from '../utils/functions.js';
import { stripDevice } from '../utils/converter.js';

/**
 * Buka pembungkus ephemeral/viewOnce/documentWithCaption sampai isi aslinya.
 *
 * @param {object} message
 * @returns {object}
 */
export function unwrapMessage(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
    } else break;
  }
  return current;
}

/**
 * Pesan yang dikutip dari contextInfo, lengkap dengan key dan teksnya.
 *
 * @param {object} message
 * @returns {{key: object, message: object, text: string, mtype: string}|null}
 */
export function findQuoted(message) {
  const inner = unwrapMessage(message);
  const type = getContentType(inner);
  if (!type) return null;
  const ctx = inner[type]?.contextInfo;
  if (!ctx?.quotedMessage) return null;

  return {
    key: {
      remoteJid: ctx.remoteJid ?? undefined,
      id: ctx.stanzaId ?? undefined,
      fromMe: false,
      participant: stripDevice(ctx.participant ?? undefined),
    },
    message: ctx.quotedMessage,
    text: messageText(ctx.quotedMessage),
    mtype: getContentType(ctx.quotedMessage),
  };
}

/**
 * Daftar mention dari contextInfo.
 *
 * @param {object} message
 * @returns {string[]}
 */
export function getMentioned(message) {
  const inner = unwrapMessage(message);
  const type = getContentType(inner);
  return inner?.[type]?.contextInfo?.mentionedJid ?? [];
}
