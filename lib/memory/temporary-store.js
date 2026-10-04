/** @module memory/temporary-store */

import { createBoundedMap } from '../utils/caching.js';

/**
 * Store sementara di memori. Pesan disimpan satu jam untuk quoted
 * lintas pesan; kontak dan chat dipantau terus.
 */
export const temporaryStore = {
  /** @type {object} */
  messages: createBoundedMap({ max: 20000, ttl: 60 * 60 * 1000 }),
  /** @type {Map<string, object>} */
  contacts: new Map(),
  /** @type {Map<string, object>} */
  chats: new Map(),
};
