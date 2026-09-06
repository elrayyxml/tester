/**
 * @nexray/lib — require() entry via createRequire bridge
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Re-export from ESM sibling for dual package consumers
export { Client } from './core/client.js';
export { Utils } from './utils/index.js';
