/** @module proxy/proxy-redis */

/**
 * Backend key-value pada Redis.
 *
 * @param {object} [config]
 * @param {object} [config.client] client redis yang sudah ada
 * @param {string} [config.url]
 * @param {object} [config.connection] opsi createClient
 * @returns {object} proxy dengan get/set/delete/keys
 */
export function createRedisProxy(config = {}) {
  let client;

  const open = async () => {
    if (client) return client;
    const mod = await import('redis');
    client = config.client ?? mod.createClient(config.connection ?? config.url ?? config);
    if (typeof client.connect === 'function') await client.connect();
    return client;
  };

  return {
    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    async get(key) {
      const c = await open();
      const raw = await c.get(key);
      return raw == null ? undefined : JSON.parse(raw);
    },

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      const c = await open();
      await c.set(key, JSON.stringify(value ?? null));
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      const c = await open();
      await c.del(key);
    },

    /** @returns {Promise<string[]>} */
    async keys() {
      const c = await open();
      return c.keys('*');
    },
  };
}
