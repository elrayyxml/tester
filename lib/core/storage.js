/** @module core/storage */

import fs from 'fs';
import path from 'path';
import { createStore } from 'zapo-js';

/**
 * Nama berkas sqlite untuk store sesi.
 *
 * @type {string}
 */
export const SQLITE_FILENAME = 'zapo.sqlite';

/**
 * @param {string} sessionDir
 * @returns {string}
 */
export const sessionDbPath = (sessionDir) => path.join(sessionDir, SQLITE_FILENAME);

/**
 * Backend store sesi per SessionType.
 *
 * @param {import('../types/index.js').SessionType} type
 * @param {object} config konfigurasi backend (uri mongo, file sqlite, pool, dst.)
 * @returns {Promise<object>} backend store zapo
 */
export async function createBackend(type, config = {}) {
  switch (type) {
    case 'sqlite':
    case 'local': {
      const { createSqliteStore } = await import('@zapo-js/store-sqlite');
      return createSqliteStore({ path: config.path ?? config.file ?? sessionDbPath(config.sessionDir ?? '.'), driver: 'auto' });
    }
    case 'mongo': {
      const { createMongoStore } = await import('@zapo-js/store-mongo');
      return createMongoStore({ db: { uri: config.uri, database: config.database } });
    }
    case 'mysql': {
      const { createMysqlStore } = await import('@zapo-js/store-mysql');
      return createMysqlStore({ pool: config.pool });
    }
    case 'postgres': {
      const { createPostgresStore } = await import('@zapo-js/store-postgres');
      return createPostgresStore(config);
    }
    case 'redis': {
      const { createRedisStore } = await import('@zapo-js/store-redis');
      return createRedisStore(config);
    }
    default:
      throw new Error(
        `Unknown session type: "${type}". Supported types: local, sqlite, mongo, mysql, postgres, redis.`,
      );
  }
}

/**
 * Store sesi zapo.
 *
 * `messages` dan `contacts` dimatikan: bot memproses pesan langsung dari
 * event, riwayat di store hanya menumbuhkan penyimpanan. `threads` menyala
 * karena daftar chat dibutuhkan beberapa fitur.
 *
 * @param {import('../types/index.js').SessionType} [type]
 * @param {object} [config]
 * @param {string} [config.sessionDir]
 * @returns {Promise<object>} store zapo
 */
export async function createSessionStore(type = 'sqlite', config = {}) {
  const backend = await createBackend(type, config);
  if (type === 'sqlite' || type === 'local') {
    const dir = path.dirname(backend.path ?? config.path ?? sessionDbPath(config.sessionDir ?? '.'));
    fs.mkdirSync(dir, { recursive: true });
  }

  return createStore({
    backends: { main: backend },
    providers: {
      auth: 'main',
      signal: 'main',
      preKey: 'main',
      session: 'main',
      identity: 'main',
      senderKey: 'main',
      appState: 'main',
      privacyToken: 'main',
      messages: 'none',
      threads: 'main',
      contacts: 'none',
    },
  });
}

/**
 * @param {string} sessionDir
 * @returns {boolean}
 */
export const hasSqliteStore = (sessionDir) => fs.existsSync(sessionDbPath(sessionDir));
