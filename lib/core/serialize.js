/** @module core/serialize */

import { stripDevice } from '../utils/converter.js';
import { messageText, getContentType } from '../utils/functions.js';
import { unwrapMessage, findQuoted, getMentioned } from './message-util.js';
import { temporaryStore } from '../memory/index.js';

/**
 * Bangun ctx pesan masuk dari event `message` zapo.
 *
 * @param {import('zapo-js').WaIncomingMessageEvent} event
 * @param {object} sock
 * @param {object} client WaClient
 * @returns {object|null} ctx, null bila pesan tidak bisa dibaca
 */
export function serializeMessage(event, sock, client) {
  const { key, message } = event;
  if (!key?.remoteJid || !key?.id) return null;

  const inner = unwrapMessage(message);
  const mtype = getContentType(inner);
  const text = messageText(message);
  const isGroup = !!key.isGroup;
  const isStatus = key.remoteJid === 'status@broadcast';

  const sender = isGroup
    ? stripDevice(key.participant ?? key.participantAlt)
    : stripDevice(key.remoteJid);
  const senderNumber = stripDevice(sender).split('@')[0];
  const senderLid = stripDevice(
    sender.endsWith('@lid')
      ? sender
      : key.participant?.endsWith('@lid')
        ? key.participant
        : (key.participantAlt?.endsWith('@lid') && key.participantAlt) || undefined,
  );

  const quoted = findQuoted(message);
  const mentionedJid = getMentioned(message).map(stripDevice);

  /** @type {object} */
  const ctx = {
    /** @type {object} stanza mentah */
    rawNode: event.rawNode,
    /** @type {object} */
    key,
    /** @type {string} */
    id: key.id,
    /** @type {boolean} */
    fromMe: !!key.fromMe,
    /** @type {boolean} */
    isBot: false,
    /** @type {string} JID chat (group/pribadi/status) */
    chat: stripDevice(key.remoteJid),
    /** @type {string} */
    remoteJid: stripDevice(key.remoteJid),
    /** @type {string} JID pengirim */
    sender,
    /** @type {string} nomor pengirim */
    senderNumber,
    /** @type {string|undefined} JID LID pengirim bila diketahui */
    senderLid,
    /** @type {string} */
    pushName: event.pushName ?? '',
    /** @type {boolean} */
    isGroup,
    /** @type {boolean} */
    isStatus,
    /** @type {boolean} */
    isBroadcast: !!key.isBroadcast || key.remoteJid.endsWith('@broadcast'),
    /** @type {string|undefined} */
    mtype,
    /** @type {object} Proto.IMessage */
    message,
    /** @type {object} isi pesan tanpa pembungkus */
    inner,
    /** @type {string} teks pesan */
    text,
    /** @type {string} alias `text` */
    body: text,
    /** @type {object|null} pesan yang dikutip */
    quoted,
    /** @type {boolean} */
    isQuoted: !!quoted,
    /** @type {boolean} */
    isMedia: !!mtype &&
      /imageMessage|videoMessage|audioMessage|stickerMessage|documentMessage|pttMessage/.test(mtype),
    /** @type {string[]} */
    mentionedJid,
    /** @type {number|undefined} TTL disappearing dalam detik */
    expiration: event.expirationSeconds,
    /** @type {number|undefined} */
    timestamp: event.timestampSeconds,
    /** @type {boolean|undefined} */
    offline: event.offline,
    /** @type {string|undefined} */
    stanzaType: event.stanzaType,

    /**
     * Balas di chat yang sama, quoted bila bukan status.
     *
     * @param {string|object} content teks atau konten Baileys
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    reply: (content, options = {}) => {
      const own = typeof content === 'string' ? { text: content } : content;
      return sock.sendMessage(ctx.chat, own, { quoted: isStatus ? undefined : ctx, ...options });
    },

    /**
     * Balas dengan mention pengirim otomatis.
     *
     * @param {string|object} content
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    replyMention: (content, options = {}) => {
      const own = typeof content === 'string' ? { text: content } : content;
      return sock.sendMessage(ctx.chat, own, {
        quoted: isStatus ? undefined : ctx,
        mentions: [ctx.sender],
        ...options,
      });
    },

    /**
     * Reaksi pada pesan ini.
     *
     * @param {string} emoji
     * @returns {Promise<object>}
     */
    react: (emoji) => sock.sendMessage(ctx.chat, { react: { text: emoji, key } }),

    /**
     * Unduh media pesan ini.
     *
     * @returns {Promise<Uint8Array>}
     */
    download: () => client.message.downloadBytes(event),
  };

  /**
   * Salinan ctx bergaya Baileys untuk quoted manual. Non-enumerable agar
   * spread ctx tidak memicu getter ini lagi (rekursi tak berhingga).
   */
  Object.defineProperty(ctx, 'fakeObj', {
    enumerable: false,
    get() {
      return { ...ctx, key, message };
    },
  });

  temporaryStore.messages.set(`${key.remoteJid}:${key.id}`, ctx);

  return ctx;
}
