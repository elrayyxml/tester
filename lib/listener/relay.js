'use strict'

const { generateWAMessage, generateWAMessageFromContent, prepareWAMessageMedia } = require('baileys')
const { generateMessageId } = require('../utils/functions')
const { NexrayError, ErrorMessages } = require('../constant/errors')

/**
 * Generic relay helper used by every sendX method.
 *
 * 1. Builds full WAMessage via generateWAMessage
 * 2. Sends through sock.relayMessage
 * 3. Returns the generated WebMessageInfo
 *
 * @param {import('baileys').WASocket} sock
 * @param {string} jid
 * @param {import('baileys').AnyMessageContent} content
 * @param {object} [quoted]
 * @param {object} [extra]
 * @returns {Promise<import('baileys').WAMessage>}
 */
async function relayHelper(sock, jid, content, quoted, extra = {}) {
  if (!jid) throw new NexrayError(ErrorMessages.MISSING_JID, { code: 'MISSING_JID' })
  if (!content) throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: 'MISSING_CONTENT' })

  const options = {
    userJid: sock.user?.id || sock.authState?.creds?.me?.id,
    upload: sock.waUploadToServer,
    logger: extra.logger || sock.logger || { child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, trace: () => {} }) },
    messageId: extra.messageId || generateMessageId(sock.user?.id, extra.messageIdPrefix),
    quoted: quoted || extra.quoted,
    ephemeralExpiration: extra.ephemeral,
    mediaUploadTimeoutMs: extra.mediaUploadTimeoutMs,
    ...extra.generationOptions
  }

  // Allow power-user raw content
  let fullMsg
  if (content.raw === true) {
    const { raw, ...rest } = content
    fullMsg = generateWAMessageFromContent(jid, rest, options)
  } else {
    fullMsg = await generateWAMessage(jid, content, options)
  }

  // Newsletter annotation (if configured and media)
  if (extra.newsletterAnnotation && fullMsg.message) {
    const ann = extra.newsletterAnnotation
    const ctx = fullMsg.message.messageContextInfo || {}
    ctx.forwardedNewsletterMessageInfo = {
      newsletterJid: ann.newsletterJid,
      newsletterName: ann.newsletterName,
      serverMessageId: ann.serverMessageId || -1,
      contentType: ann.contentType || 1
    }
    fullMsg.message.messageContextInfo = ctx
  }

  const relayOpts = {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes: extra.additionalNodes,
    useCachedGroupMetadata: extra.useCachedGroupMetadata !== false
  }

  await sock.relayMessage(jid, fullMsg.message, relayOpts)
  return fullMsg
}

module.exports = {
  relayHelper
}
