/** @module utils/security */

/** Nomor dari JID tanpa device-id. */
const number = (jid) => jid?.split('@')[0]?.replace(/:\d+/, '');

/**
 * @param {string|undefined} jid
 * @param {Array<string|number>} [owners]
 * @returns {boolean}
 */
export function isOwner(jid, owners = []) {
  if (!jid) return false;
  return owners.some((owner) => String(owner).replace(/\D/g, '') === number(jid));
}

/** Peserta admin bila `admin` bernilai `admin` atau `superadmin`. */
const findAdmin = (participants, jid, role) =>
  participants.some((p) => number(p.id ?? p.jid) === number(jid) && (role ? p.admin === role : !!p.admin));

/**
 * @param {Array<{id?: string, jid?: string, admin?: string}>} participants
 * @param {string} jid
 * @returns {boolean}
 */
export const isAdmin = (participants = [], jid) => findAdmin(participants, jid, null);

/**
 * @param {Array<{id?: string, jid?: string, admin?: string}>} participants
 * @param {string} jid
 * @returns {boolean}
 */
export const isSuperAdmin = (participants = [], jid) => findAdmin(participants, jid, 'superadmin');
