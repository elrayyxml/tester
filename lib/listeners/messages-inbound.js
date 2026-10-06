/** @module listeners/messages-inbound */

import { serializeMessage } from '../core/serialize.js';
import { processedMessages, reportedOutgoing } from '../core/private.js';
import { extractCommand, matchCommand } from '../utils/functions.js';

/** ProtocolMessage.Type.REVOKE protobuf enum. */
const REVOKE_TYPE = 0;

/** Salinan berisi: teks atau media non-teks. */
const hasContent = ({ text, mtype } = {}) =>
  Boolean(text?.trim() || (mtype && mtype !== 'text' && mtype !== 'unknown'));

/**
 * Salinan kunci grup murni (senderKeyDistributionMessage saja). Status
 * dikecualikan karena fitur antitagsw bekerja dari pesan ini.
 */
const isBareSenderKeyCopy = ({ chat, message } = {}) => {
  if (chat === 'status@broadcast') return false;
  const keys = Object.keys(message ?? {});
  if (!keys.includes('senderKeyDistributionMessage')) return false;
  return keys.every((k) => k === 'senderKeyDistributionMessage' || k === 'messageContextInfo');
};

/**
 * Pasang listener pesan masuk: serialisasi, saring pesan kembar,
 * emit `message` (orang lain), `message.send` (bot sendiri), atau `stories`.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter instance Client (EventEmitter)
 * @param {object} [opts]
 */
export function registerInbound(client, sock, adapter, opts = {}) {
  const onUpsert = async (m) => {
    try {
      if (!Array.isArray(m?.messages) || m?.type === 'append') return;
      const ctx = serializeMessage(m.messages[0], sock, client);
      if (!ctx) return;

      /**
       * Pesan yang sama bisa datang dua kali: salinan pertama sering kosong
       * (kunci grup) dan salinan kedua berisi. Cache mengingat apakah salinan
       * lama sudah berisi supaya salinan berisi tidak dibuang oleh salinan
       * kosong yang datang belakangan.
       */
      const dedupeKey = `${ctx.chat}:${ctx.id}`;
      const carriesContent = hasContent(ctx);
      const previous = ctx.id ? processedMessages.get(dedupeKey) : undefined;
      if (ctx.id && previous !== undefined && (previous === true || !carriesContent)) return;
      if (ctx.id) processedMessages.set(dedupeKey, carriesContent);

      if (!carriesContent && isBareSenderKeyCopy(ctx)) return;

      /**
       * Presence hanya untuk perintah yang dikenal. `opts.commands` memuat
       * perintah dari plugin, `opts.prefixes` daftar prefix yang dipakai
       * pemakai (bisa lebih dari satu), dan `opts.requirePrefix` memaksa mode
       * berprefiks. Tanpa `commands`, semua pesan yang tampak sebagai perintah
       * tetap dianggap perintah agar perilaku lama tidak berubah.
       */
      const knownCommands = opts.commands instanceof Set
        ? opts.commands
        : new Set(opts.commands ?? []);
      const prefixes = opts.prefixes ?? ['.', '/', '!', '#'];
      const isCommand = !ctx.fromMe &&
        (knownCommands.size
          ? Boolean(matchCommand(ctx.text, knownCommands, { prefixes, requirePrefix: opts.requirePrefix === true }))
          : Boolean(extractCommand(ctx.text, prefixes)));

      if (opts.presence && isCommand) {
        try {
          await sock.readMessages([ctx.key]);
          await sock.sendPresenceUpdate('composing', ctx.chat);
          setTimeout(() => sock.sendPresenceUpdate('paused', ctx.chat).catch(() => {}), 2500);
        } catch (error) {
          adapter.logger.warn(`Presence update failed: ${error?.message || error}`);
        }
      }

      if (ctx.isStatus && !ctx.fromMe) return adapter.emit('stories', ctx);

      if (ctx.fromMe) {
        /**
         * Tandai sudah dilaporkan agar `message_send` zapo tidak mengirim
         * event `message.send` kedua untuk pesan yang sama.
         */
        if (ctx.id) reportedOutgoing.set(ctx.id, true);
        return adapter.emit('message.send', ctx);
      }

      adapter.emit('message', ctx);
    } catch (error) {
      adapter.logger.error(`Error while processing message upsert: ${error?.message || error}`);
    }
  };

  sock.ev.on('messages.upsert', onUpsert);

  return () => sock.ev.off('messages.upsert', onUpsert);
}

/**
 * Pasang listener pesan dihapus (revoke): `message_protocol` zapo dengan
 * varian REVOKE diterjemahkan menjadi event `message.delete`.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerMessageDelete(client, sock, adapter) {
  const onProtocol = (event) => {
    try {
      const protocol = event?.protocolMessage;
      if (protocol?.type !== REVOKE_TYPE) return;

      adapter.emit('message.delete', {
        key: {
          remoteJid: event.key?.remoteJid,
          id: protocol.key?.id,
          fromMe: protocol.key?.fromMe ?? false,
          participant: protocol.key?.participant ?? event.key?.participant,
        },
        chat: event.key?.remoteJid,
        sender: event.key?.participant ?? event.key?.remoteJid,
        deletedId: protocol.key?.id,
        timestamp: event.timestampSeconds,
        rawNode: event.rawNode,
      });
    } catch (error) {
      adapter.logger.warn(`message_protocol parse failed: ${error?.message || error}`);
    }
  };

  client.on('message_protocol', onProtocol);

  return () => client.off('message_protocol', onProtocol);
}
