/** @module proxy/proxy-mysql */

/**
 * Backend key-value pada satu tabel MySQL.
 *
 * @param {object} [config]
 * @param {object} [config.pool] pool mysql2 yang sudah ada
 * @param {object} [config.connection] opsi mysql.createPool
 * @returns {object} proxy dengan get/set/delete/keys
 */
export function createMysqlProxy(config = {}) {
  let pool;

  const open = async () => {
    if (pool) return pool;
    const mysql = await import('mysql2/promise');
    pool = config.pool ?? mysql.createPool(config.connection ?? config);
    await pool.query(
      'CREATE TABLE IF NOT EXISTS store (ikey VARCHAR(191) PRIMARY KEY, value LONGTEXT)',
    );
    return pool;
  };

  return {
    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    async get(key) {
      await open();
      const [rows] = await pool.query('SELECT value FROM store WHERE ikey = ? LIMIT 1', [key]);
      return rows[0] ? JSON.parse(rows[0].value) : undefined;
    },

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      await open();
      await pool.query(
        'INSERT INTO store (ikey, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, JSON.stringify(value ?? null)],
      );
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      await open();
      await pool.query('DELETE FROM store WHERE ikey = ?', [key]);
    },

    /** @returns {Promise<string[]>} */
    async keys() {
      await open();
      const [rows] = await pool.query('SELECT ikey FROM store');
      return rows.map((r) => r.ikey);
    },
  };
}
