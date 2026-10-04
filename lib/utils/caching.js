/** @module utils/caching */

/**
 * Map dengan batas ukuran dan TTL; entri terlama tak diakses dibuang.
 *
 * @param {object} [options]
 * @param {number} [options.max]
 * @param {number} [options.ttl] milidetik
 * @returns {object}
 */
export function createBoundedMap({ max = 10000, ttl = Infinity } = {}) {
  const map = new Map();

  return {
    /**
     * @param {*} key
     * @returns {*|undefined}
     */
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (ttl !== Infinity && Date.now() > entry.expires) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },

    /**
     * @param {*} key
     * @param {*} value
     */
    set(key, value) {
      if (ttl !== Infinity) {
        map.set(key, { value, expires: Date.now() + ttl });
      } else {
        map.set(key, { value });
      }
      if (max !== Infinity && map.size > max) {
        map.delete(map.keys().next().value);
      }
    },

    /**
     * @param {*} key
     * @returns {boolean}
     */
    delete(key) {
      return map.delete(key);
    },

    /**
     * @param {*} key
     * @returns {boolean}
     */
    has(key) {
      return this.get(key) !== undefined;
    },

    clear() {
      map.clear();
    },

    /** @returns {number} */
    get size() {
      return map.size;
    },

    /** @returns {Array} */
    keys() {
      return [...map.keys()];
    },
  };
}

/**
 * Set dengan batas ukuran dan TTL.
 *
 * @param {object} [options]
 * @param {number} [options.max]
 * @param {number} [options.ttl] milidetik
 * @returns {object}
 */
export function createBoundedSet({ max = 10000, ttl = Infinity } = {}) {
  const map = createBoundedMap({ max, ttl });

  return {
    /**
     * @param {*} value
     */
    add(value) {
      map.set(value, true);
    },

    /**
     * @param {*} value
     * @returns {boolean}
     */
    has(value) {
      return map.has(value);
    },

    /**
     * @param {*} value
     * @returns {boolean}
     */
    delete(value) {
      return map.delete(value);
    },

    clear() {
      map.clear();
    },

    /** @returns {number} */
    get size() {
      return map.size;
    },
  };
}
