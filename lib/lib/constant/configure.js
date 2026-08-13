'use strict'

/**
 * Global configuration singleton.
 * Values can be overridden via process.env or setGlobalConfig().
 */

const defaults = {
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  TEMP_DIR: process.env.TEMP_DIR || process.env.TEMPORARY_PATH || 'temp',
  REQUEST_TIMEOUT: Number(process.env.REQUEST_TIMEOUT) || 60000,
  FFMPEG_TIMEOUT: Number(process.env.FFMPEG_TIMEOUT) || 90000,
  FFMPEG_CONCURRENCY: Number(process.env.FFMPEG_CONCURRENCY) || 4
}

let config = { ...defaults }

/**
 * Get the current global config object (shallow copy).
 * @returns {typeof defaults}
 */
function getGlobalConfig() {
  return { ...config }
}

/**
 * Merge partial config into the global config.
 * @param {Partial<typeof defaults>} partial
 */
function setGlobalConfig(partial = {}) {
  if (partial && typeof partial === 'object') {
    Object.assign(config, partial)
  }
}

module.exports = {
  getGlobalConfig,
  setGlobalConfig,
  defaults
}
