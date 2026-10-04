/** @module listeners/presence */

/**
 * Pasang listener presence dan chatstate.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerPresence(client, sock, adapter) {
  client.on('presence', (event) => adapter.emit('presence', event));
  client.on('chatstate', (event) => adapter.emit('chatstate', event));
}
