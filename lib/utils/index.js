'use strict'

const functions = require('./functions')
const media = require('./media')
const message = require('./message')
const preview = require('./link-preview')

const Utils = {
  ...functions,
  ...media,
  ...message,
  ...preview
}

const protectedNames = new Set(Object.keys(Utils).concat(['extend']))
Utils.extend = function extend(map = {}) {
  if (!map || typeof map !== 'object') throw new TypeError('Utils.extend menerima object berisi fungsi.')
  for (const [name, value] of Object.entries(map)) {
    if (typeof value !== 'function') continue
    if (protectedNames.has(name)) {
      process.emitWarning(`Utils.${name} adalah method bawaan dan tidak dioverride.`, { code: 'WB_UTILS_OVERRIDE' })
      continue
    }
    Utils[name] = value
  }
  return Utils
}

module.exports = { Utils, ...functions, ...media, ...message, ...preview }
