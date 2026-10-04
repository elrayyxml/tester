/** @module listeners/group-update */

/** Aksi peserta Baileys ke nama event adapter. */
const EMIT_MAP = {
  add: 'group.add',
  remove: 'group.remove',
  promote: 'group.promote',
  demote: 'group.demote',
};

/** JID peserta: nomor telepon didahulukan agar mention tampil benar. */
const toJids = (participants) =>
  participants.map((p) => p.phoneJid ?? p.jid ?? p.lidJid).filter(Boolean);

/**
 * Pasang listener perubahan grup.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} adapter
 */
export function registerGroupUpdate(client, sock, adapter) {
  client.on('group', (event) => {
    sock.ev.emit('group', event);
    if (!event.groupJid) return;

    const mapped = EMIT_MAP[event.action];
    if (mapped && event.participants?.length) {
      adapter.emit(mapped, {
        id: event.groupJid,
        participants: toJids(event.participants),
        author: event.authorJid,
        action: event.action,
      });
      return;
    }

    // Permintaan join membawa createdMembershipRequests, bukan participants.
    if (event.action === 'membership_approval_request' || event.createdMembershipRequests?.length) {
      adapter.emit('group.request', {
        id: event.groupJid,
        author: event.authorJid,
        requests: event.createdMembershipRequests ?? event.participants,
      });
    }
  });

  sock.ev.on('group-participants.update', (update) => adapter.emit('group-participants.update', update));
}
