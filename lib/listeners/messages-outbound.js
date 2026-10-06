/** @module listeners/messages-outbound */

import { reportedOutgoing } from '../core/private.js';

/**
 * Pasang listener pesan keluar zapo (`message_send`). Pesan yang sama bisa
 * juga terlihat lewat `message` dengan `key.fromMe`; id yang sudah dilaporkan
 * oleh jalur inbound dilewati agar `message.send` tidak terpancar dua kali.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerOutbound(client, sock, adapter) {
  const onOutgoing = (event) => {
    if (event?.id) {
      if (reportedOutgoing.get(event.id)) return;
      reportedOutgoing.set(event.id, true);
    }
    adapter.emit('message.send', event);
  };
  client.on('message_send', onOutgoing);

  return () => client.off('message_send', onOutgoing);
}
