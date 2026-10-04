/** @module core/private */

import { createBoundedMap } from '../utils/caching.js';

/** Status koneksi per custom_id. @type {Map<string, boolean>} */
export const statusConnected = new Map();

/**
 * ID pesan yang sudah diproses, untuk menolak kiriman ulang server.
 * Nilainya boolean: salinan yang tercatat membawa isi atau tidak.
 *
 * @type {object}
 */
export const processedMessages = createBoundedMap({ max: 20000, ttl: 10 * 60 * 1000 });

/** Batas percobaan reconnect per sesi. */
export const MAX_RECONNECT = 5;

/** Presence `available` diulang: server melupakan status online dalam beberapa menit. */
export const PRESENCE_REFRESH_MS = 10 * 60 * 1000;

/**
 * Reconnect state per folder sesi, dipisah agar sesi saling independen.
 *
 * @type {Map<string, object>}
 */
export const sessionStates = new Map();

/**
 * @param {string} folder
 * @returns {object}
 */
export function getSessionState(folder) {
  let state = sessionStates.get(folder);
  if (!state) {
    state = { reconnecting: false, attempts: 0, qrCount: 0, presenceTimer: null };
    sessionStates.set(folder, state);
  }
  return state;
}

/** @param {object} state */
export function stopPresenceKeepAlive(state) {
  clearInterval(state.presenceTimer);
  state.presenceTimer = null;
}

/**
 * @param {object} sock
 * @param {object} state
 */
export function startPresenceKeepAlive(sock, state) {
  stopPresenceKeepAlive(state);
  const kirim = () => sock.sendPresenceUpdate('available').catch(() => {});
  kirim();
  state.presenceTimer = setInterval(kirim, PRESENCE_REFRESH_MS);
}
