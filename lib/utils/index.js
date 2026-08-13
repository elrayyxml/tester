'use strict'

const functions = require('./functions')
const media = require('./media')
const message = require('./message')
const linkPreview = require('./link-preview')
const contentBuilder = require('./content-builder')
const protoUpdate = require('./proto-update')

const Utils = {
  sleep: functions.sleep,
  generateMessageId: functions.generateMessageId,
  getDevice: functions.getDevice,
  formatBytes: functions.formatBytes,
  randomInt: functions.randomInt,
  pickRandom: functions.pickRandom,
  isUrl: functions.isUrl,
  defaultIsBot: functions.defaultIsBot,

  getBufferFromUrl: media.getBufferFromUrl,
  getWaveform: media.getWaveform,
  detectMime: media.detectMime,
  getStream: media.getStream,
  extractImageThumb: media.extractImageThumb,
  getCompressedThumbnail: media.getCompressedThumbnail,

  getContentType: message.getContentType,
  normalizeMessageContent: message.normalizeMessageContent,
  extractMessageContent: message.extractMessageContent,
  getBodyFromMessage: message.getBodyFromMessage,

  getUrlInfo: linkPreview.getUrlInfo,
  extractFirstUrl: linkPreview.extractFirstUrl,

  // content builders (advanced)
  buildInteractiveContent: contentBuilder.buildInteractiveContent,
  buildButtonsContent: contentBuilder.buildButtonsContent,
  buildPollContent: contentBuilder.buildPollContent,
  buildPollResultContent: contentBuilder.buildPollResultContent,
  buildAlbumHeader: contentBuilder.buildAlbumHeader,

  updateProtoOnStartup: protoUpdate.updateProtoOnStartup
}

const PROTECTED = new Set(['extend', ...Object.keys(Utils)])

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
  ...linkPreview,
  ...contentBuilder,
  ...protoUpdate
}
