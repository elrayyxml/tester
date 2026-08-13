'use strict'

var client = require('./client')
var extend = require('./extend')
var serialize = require('./serialize')

var api = {
  Client: client.Client,
  Extend: extend.Extend,
  serialize: serialize.serialize
}

module.exports = api
module.exports.default = api
