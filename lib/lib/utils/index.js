'use strict'

const functions = require('./functions')
const media = require('./media')
const message = require('./message')
const linkPreview = require('./link-preview')

/**
 * Singleton Utils registry.
 * All built-in helpers are attached once.
 * Consumer code can call Utils.extend({ ... }) from any file;
 * the methods become available globally via the same import.
 */
const Utils = {
  // functions
  sleep: functions.sleep,
  generateMessageId: functions.generateMessageId,
  getDevice: functions.getDevice,
  formatBytes: functions.formatBytes,
  randomInt: functions.randomInt,
  pickRandom: functions.pickRandom,
  isUrl: functions.isUrl,
  defaultIsBot: functions.defaultIsBot,

  // media
  getBufferFromUrl: media.getBufferFromUrl,
  detectMime: media.detectMime,
  getStream: media.getStream,
  extractImageThumb: media.extractImageThumb,
  getCompressedThumbnail: media.getCompressedThumbnail,

  // message helpers
  getContentType: message.getContentType,
  normalizeMessageContent: message.normalizeMessageContent,
  extractMessageContent: message.extractMessageContent,
  getBodyFromMessage: message.getBodyFromMessage,

  // link preview
  getUrlInfo: linkPreview.getUrlInfo,
  extractFirstUrl: linkPreview.extractFirstUrl
}

/** Core method names that must not be overwritten silently */
const PROTECTED = new Set(['extend', ...Object.keys(Utils)])

/**
 * Extend the global Utils singleton with custom helpers.
 * Existing core methods emit a warning if overridden.
 *
 * @param {Record<string, Function>} fnMap
 */
function extend(fnMap) {
  if (!fnMap || typeof fnMap !== 'object') return
  for (const [name, fn] of Object.entries(fnMap)) {
    if (typeof fn !== 'function') continue
    if (PROTECTED.has(name) && name !== 'extend') {
      console.warn(`[nexray] Utils.extend: overriding built-in method "${name}"`)
    }
    Utils[name] = fn
  }
}

Utils.extend = extend

module.exports = {
  Utils,
  ...functions,
  ...media,
  ...message,
  ...linkPreview
}
