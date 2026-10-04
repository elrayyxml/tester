/** @module utils/cooldown */

/**
 * Rate limit sederhana per key.
 *
 * @param {number} [defaultMs] jeda bawaan milidetik
 * @returns {object}
 */
export function createCooldown(defaultMs = 3000) {
  const last = new Map();

  return {
    /**
     * True berarti masih dalam masa jeda dan harus dibuang.
     *
     * @param {string} key
     * @param {number} [ms]
     * @returns {boolean}
     */
    check(key, ms = defaultMs) {
      const now = Date.now();
      const prev = last.get(key) ?? 0;
      if (now - prev < ms) return true;
      last.set(key, now);
      return false;
    },

    /** @param {string} key */
    reset(key) {
      last.delete(key);
    },

    clear() {
      last.clear();
    },

    /** @returns {number} */
    get size() {
      return last.size;
    },
  };
}
