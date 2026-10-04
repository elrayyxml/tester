/** @module proxy/proxy-postgresql */

/**
 * Backend key-value pada satu tabel PostgreSQL.
 *
 * @param {object} [config]
 * @param {object} [config.client] Client pg yang sudah ada
 * @param {object|string} [config.connection] opsi Client pg / connection string
 * @returns {object} proxy dengan get/set/delete/keys
 */
export function createPostgresProxy(config = {}) {
  let client;

  const open = async () => {
    if (client) return client;
    const mod = await import('pg');
    client = config.client ?? new mod.default.Client(config.connection ?? config.connectionString);
    await client.connect();
    await client.query('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)');
    return client;
  };

  return {
    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    async get(key) {
      const c = await open();
      const res = await c.query('SELECT value FROM store WHERE key = $1', [key]);
      return res.rows[0] ? JSON.parse(res.rows[0].value) : undefined;
    },

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      const c = await open();
      await c.query(
        'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(value ?? null)],
      );
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      const c = await open();
      await c.query('DELETE FROM store WHERE key = $1', [key]);
    },

    /** @returns {Promise<string[]>} */
    async keys() {
      const c = await open();
      const res = await c.query('SELECT key FROM store');
      return res.rows.map((r) => r.key);
    },
  };
}
