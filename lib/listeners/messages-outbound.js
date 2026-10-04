/** @module listeners/messages-outbound */

/**
 * Pasang listener pesan keluar zapo.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerOutbound(client, sock, adapter) {
  client.on('message_send', (event) => adapter.emit('message.send', event));
}
