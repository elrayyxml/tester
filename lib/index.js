'use strict'

/**
 * @nexray/lib – CJS entry (clean, readable, no obfuscation)
 */

var core = require('./core')
var utils = require('./utils')
var constant = require('./constant')

var api = {
  Client: core.Client,
  Extend: core.Extend,
  serialize: core.serialize,
  Utils: utils.Utils,
  getGlobalConfig: constant.getGlobalConfig,
  setGlobalConfig: constant.setGlobalConfig,
  NexrayError: constant.NexrayError,
  ErrorMessages: constant.ErrorMessages
}

module.exports = api
module.exports.default = api
