/** @module utils/resolver */

import { stripDevice } from './converter.js';

/**
 * Cache pemetaan LID dan nomor telepon dua arah.
 *
 * zapo hanya menyediakan API arah nomor ke LID. Arah sebaliknya dilayani dari
 * data yang lewat sendiri: pesan masuk membawa remoteJidAlt/participantAlt,
 * metadata grup membawa lid/phoneNumber per anggota.
 *
 * @returns {object}
 */
export function createLidMappingCache() {
  const lidToPn = new Map();
  const pnToLid = new Map();

  return {
    /**
     * @param {string} lidJid
     * @param {string} pnJid
     */
    remember(lidJid, pnJid) {
      const lid = stripDevice(lidJid);
      const pn = stripDevice(pnJid);
      if (!lid?.endsWith('@lid') || !pn?.endsWith('@s.whatsapp.net')) return;
      lidToPn.set(lid, pn);
      pnToLid.set(pn, lid);
    },

    /**
     * @param {string} lidJid
     * @returns {string|null}
     */
    getPn: (lidJid) => lidToPn.get(stripDevice(lidJid)) ?? null,

    /**
     * @param {string} pnJid
     * @returns {string|null}
     */
    getLid: (pnJid) => pnToLid.get(stripDevice(pnJid)) ?? null,

    /** @returns {number} */
    get size() {
      return lidToPn.size;
    },
  };
}
