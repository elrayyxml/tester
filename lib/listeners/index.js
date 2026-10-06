/** @module listeners/index */

export { registerInbound, registerMessageDelete } from './messages-inbound.js';
export { registerOutbound } from './messages-outbound.js';
export { registerReceipt } from './messages-receipt.js';
export { registerPresence } from './presence.js';
export { registerGroupUpdate } from './group-update.js';

import { registerInbound, registerMessageDelete } from './messages-inbound.js';
import { registerOutbound } from './messages-outbound.js';
import { registerReceipt } from './messages-receipt.js';
import { registerPresence } from './presence.js';
import { registerGroupUpdate } from './group-update.js';

/** Event zapo yang dipipe langsung ke sock.ev tanpa transformasi. */
const PIPED_EVENTS = [
  'message_addon',
  'message_protocol',
  'message_bot_chunk',
  'message_unavailable',
  'chatstate',
  'call',
  'newsletter',
  'newsletter_message_update',
  'business',
  'picture',
  'privacy',
  'blocklist',
  'own_username',
  'mutation',
  'mutation_send',
  'history_sync_chunk',
  'group_history_bundle',
  'offline_resume',
  'offline_thread_metadata',
  'mex_notification',
  'stream_failure',
  'stanza_error',
  'voip_call_incoming',
  'voip_call_state',
  'voip_call_ended',
  'voip_call_error',
  'voip_call_outbound_audio_finished',
  'voip_call_inbound_video',
  'voip_call_inbound_video_rtp',
];

/**
 * Pasang seluruh listener bawaan dan piping event zapo ke sock.ev.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 * @param {object} [opts]
 * @returns {Array<() => void>} fungsi pelepas listener yang dipasang di `sock.ev`
 */
export function wireListeners(client, sock, adapter, opts = {}) {
  const disposers = [
    registerInbound(client, sock, adapter, opts),
    registerOutbound(client, sock, adapter),
    registerReceipt(client, sock, adapter),
    registerPresence(client, sock, adapter),
    registerGroupUpdate(client, sock, adapter),
    registerMessageDelete(client, sock, adapter),
  ].filter((dispose) => typeof dispose === 'function');

  client.on('message', (event) => sock.ev.emit('message', event));
  client.on('message_send', (event) => sock.ev.emit('message_send', event));

  for (const name of PIPED_EVENTS) client.on(name, (event) => sock.ev.emit(name, event));

  return disposers;
}
