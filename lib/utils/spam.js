/** @module utils/spam */

import { createBoundedMap } from './caching.js';

/**
 * Anti-spam: batasi frekuensi pesan per key dalam jendela waktu.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs]
 * @param {number} [options.max]
 * @param {number} [options.maxKeys]
 * @returns {object}
 */
export function createSpamFilter({ windowMs = 10000, max = 5, maxKeys = 20000 } = {}) {
  const hits = createBoundedMap({ max: maxKeys, ttl: windowMs * 2 });

  return {
    /**
     * True berarti melewati batas dan harus dibuang.
     *
     * @param {string} key
     * @returns {boolean}
     */
    check(key) {
      const now = Date.now();
      const entry = hits.get(key) ?? { count: 0, start: now };
      if (now - entry.start > windowMs) {
        entry.count = 0;
        entry.start = now;
      }
      entry.count += 1;
      hits.set(key, entry);
      return entry.count > max;
    },

    clear() {
      hits.clear();
    },
  };
}
