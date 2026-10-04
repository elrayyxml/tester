/** @module listeners/messages-receipt */

/**
 * Pasang listener receipt (delivered/read/played).
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerReceipt(client, sock, adapter) {
  client.on('receipt', (event) => {
    adapter.emit('receipt', event);
    adapter.emit('message.receipt', event);
  });
}
