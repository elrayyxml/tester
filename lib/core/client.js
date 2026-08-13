'use strict'

const { Extend } = require('./extend')
const { bindMessageListener } = require('../listener/message')
const { bindChatListener } = require('../listener/chat')
const { bindNewsletterListener } = require('../listener/newsletter')

/**
 * Client(sock, options) – thin wrapper that:
 * 1. Calls Extend(sock, options) to attach all send helpers
 * 2. Installs the built-in message / chat / newsletter listeners
 *
 * Returns the same socket instance (mutated in-place).
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 * @returns {Promise<import('baileys').WASocket>}
 */
async function Client(sock, options = {}) {
  await Extend(sock, options)

  // Install listeners (Extend itself never does this)
  bindMessageListener(sock, options)
  bindChatListener(sock, options)
  bindNewsletterListener(sock, options)

  return sock
}

exports.Client = Client;
