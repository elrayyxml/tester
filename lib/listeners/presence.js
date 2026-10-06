/** @module listeners/presence */

/**
 * Pasang listener presence dan chatstate.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerPresence(client, sock, adapter) {
  const onPresence = (event) => adapter.emit('presence', event);
  const onChatstate = (event) => adapter.emit('chatstate', event);
  client.on('presence', onPresence);
  client.on('chatstate', onChatstate);

  return () => {
    client.off('presence', onPresence);
    client.off('chatstate', onChatstate);
  };
}
