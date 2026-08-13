'use strict'

var configure = require('./configure')
var errors = require('./errors')

var api = {
  getGlobalConfig: configure.getGlobalConfig,
  setGlobalConfig: configure.setGlobalConfig,
  defaults: configure.defaults,
  NexrayError: errors.NexrayError,
  ErrorMessages: errors.ErrorMessages
}

module.exports = api
module.exports.default = api
