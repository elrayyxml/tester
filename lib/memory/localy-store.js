/** @module memory/localy-store */

import fs from 'fs';
import path from 'path';

const DEFAULT_DATA = {
  users: {},
  groups: {},
  setting: {},
};

/**
 * Store data berkas JSON: pengguna, grup, setting.
 */
export class LocalyStore {
  /**
   * @param {string} [file] path berkas JSON
   */
  constructor(file = 'database.json') {
    /** @type {string} */
    this.file = file;
    /** @type {object} */
    this.data = structuredClone(DEFAULT_DATA);
  }

  /** @returns {LocalyStore} */
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      this.data = { ...DEFAULT_DATA, ...raw };
    } catch {
      this.data = structuredClone(DEFAULT_DATA);
    }
    return this;
  }

  /** @returns {LocalyStore} */
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this;
  }
}

export const localyStore = new LocalyStore();
