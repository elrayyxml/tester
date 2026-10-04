/** @module proxy/proxy-sqlite */

/**
 * Backend key-value pada SQLite (tabel `store`), berbeda dari store sesi zapo.
 *
 * @param {string} [file] path berkas sqlite
 * @returns {object} proxy dengan get/set/delete/keys
 */
export function createSqliteProxy(file = 'store.sqlite') {
  let db;

  const open = async () => {
    if (db) return db;
    const mod = await import('better-sqlite3');
    db = new mod.default(file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)');
    return db;
  };

  return {
    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    async get(key) {
      const conn = await open();
      const row = conn.prepare('SELECT value FROM store WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : undefined;
    },

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      const conn = await open();
      conn
        .prepare(
          'INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, JSON.stringify(value ?? null));
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      const conn = await open();
      conn.prepare('DELETE FROM store WHERE key = ?').run(key);
    },

    /** @returns {Promise<string[]>} */
    async keys() {
      const conn = await open();
      return conn.prepare('SELECT key FROM store').all().map((r) => r.key);
    },
  };
}
