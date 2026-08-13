'use strict'

/**
 * @nexray/lib
 * Lightweight Baileys helper library (serialize + relay-based send helpers).
 *
 * Entry point – CommonJS (clean, readable, no obfuscation).
 */

const { Client, Extend, serialize } = require('./core')
const { Utils } = require('./utils')
const {
  getGlobalConfig,
  setGlobalConfig,
  NexrayError,
  ErrorMessages
} = require('./constant')

module.exports = {
  Client,
  Extend,
  serialize,
  Utils,
  getGlobalConfig,
  setGlobalConfig,
  NexrayError,
  ErrorMessages
}
