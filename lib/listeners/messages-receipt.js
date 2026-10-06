/** @module listeners/messages-receipt */

/**
 * Pasang listener receipt (delivered/read/played).
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerReceipt(client, sock, adapter) {
  const onReceipt = (event) => {
    adapter.emit('receipt', event);
    adapter.emit('message.receipt', event);
  };
  client.on('receipt', onReceipt);

  return () => client.off('receipt', onReceipt);
}
