'use strict'

var message = require('./message')
var chat = require('./chat')
var newsletter = require('./newsletter')
var relay = require('./relay')

var api = {
  bindMessageListener: message.bindMessageListener,
  bindChatListener: chat.bindChatListener,
  bindNewsletterListener: newsletter.bindNewsletterListener,
  relayHelper: relay.relayHelper,
  relayRaw: relay.relayRaw,
  prepareMedia: relay.prepareMedia,
  resolveAdditionalNodes: relay.resolveAdditionalNodes,
  normalizeQuoted: relay.normalizeQuoted
}

module.exports = api
module.exports.default = api
