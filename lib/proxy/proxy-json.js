/** @module proxy/proxy-json */

import fs from 'fs';
import path from 'path';

/**
 * Backend key-value pada satu berkas JSON.
 *
 * @param {string} [file] path berkas
 * @returns {object} proxy dengan get/set/delete/keys
 */
export function createJsonProxy(file = 'store.json') {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return {};
    }
  };

  return {
    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    async get(key) {
      return read()[key];
    },

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      const data = read();
      data[key] = value;
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      const data = read();
      delete data[key];
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    },

    /** @returns {Promise<string[]>} */
    async keys() {
      return Object.keys(read());
    },
  };
}
