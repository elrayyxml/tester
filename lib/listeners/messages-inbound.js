/** @module listeners/messages-inbound */

import { serializeMessage } from '../core/serialize.js';
import { processedMessages } from '../core/private.js';

/** ProtocolMessage.Type.REVOKE protobuf enum. */
const REVOKE_TYPE = 0;

/** Salinan berisi: teks atau media non-teks. */
const punyaIsi = (ctx) =>
  Boolean(ctx?.text?.trim() || (ctx?.mtype && ctx.mtype !== 'text' && ctx.mtype !== 'unknown'));

/**
 * Salinan kunci grup murni (senderKeyDistributionMessage saja). Status
 * dikecualikan karena fitur antitagsw bekerja dari pesan ini.
 */
const hanyaKunciGrup = (ctx) => {
  if (ctx?.chat === 'status@broadcast') return false;
  const keys = Object.keys(ctx?.message ?? {});
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
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (!Array.isArray(m?.messages) || m?.type === 'append') return;
      const ctx = serializeMessage(m.messages[0], sock, client);
      if (!ctx) return;

      // Pesan yang sama bisa datang dua kali: salinan pertama sering kosong
      // (kunci grup) dan salinan kedua berisi. Cache mengingat apakah salinan
      // lama sudah berisi supaya salinan berisi tidak dibuang oleh salinan
      // kosong yang datang belakangan.
      const kunci = `${ctx.chat}:${ctx.id}`;
      const adaIsi = punyaIsi(ctx);
      const isiLama = ctx.id ? processedMessages.get(kunci) : undefined;
      if (ctx.id && isiLama !== undefined && (isiLama === true || !adaIsi)) return;
      if (ctx.id) processedMessages.set(kunci, adaIsi);

      if (!adaIsi && hanyaKunciGrup(ctx)) return;

      // presence: true menandai dibaca dan menampilkan "mengetik" sesaat.
      if (opts.presence && !ctx.fromMe) {
        try {
          await sock.readMessages([ctx.key]);
          await sock.sendPresenceUpdate('composing', ctx.chat);
          setTimeout(() => sock.sendPresenceUpdate('paused', ctx.chat).catch(() => {}), 2500);
        } catch (error) {
          adapter.logger.warn(`Presence update failed: ${error?.message || error}`);
        }
      }

      if (ctx.isStatus && !ctx.fromMe) return adapter.emit('stories', ctx);
      if (ctx.fromMe) return adapter.emit('message.send', ctx);
      adapter.emit('message', ctx);
    } catch (error) {
      adapter.logger.error(`Error while processing message upsert: ${error?.message || error}`);
    }
  });
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
  client.on('message_protocol', (event) => {
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
  });
}
