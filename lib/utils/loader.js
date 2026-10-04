/** @module utils/loader */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Muat modul *.js dari direktori.
 *
 * @param {string} dir
 * @param {object} [options]
 * @param {boolean} [options.recursive]
 * @returns {Promise<Array<{name: string, path: string, mod: object}>>}
 */
export async function loadModules(dir, { recursive = false } = {}) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      results.push(...(await loadModules(full, { recursive })));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    try {
      const mod = await import(pathToFileURL(full).href);
      results.push({ name: path.basename(entry.name, '.js'), path: full, mod });
    } catch (error) {
      console.warn(`[LOADER] Gagal memuat ${entry.name}: ${error?.message || error}`);
    }
  }
  return results;
}
