'use strict'

const { generateWAMessage, generateWAMessageFromContent } = require('baileys')
const { generateMessageId } = require('../utils/functions')
const { NexrayError, ErrorMessages } = require('../constant/errors')

/**
 * Default polygon vertices used by newsletter media annotations
 * (same shape as the reference implementation).
 */
const DEFAULT_POLYGON = [
  { x: 60.71664810180664, y: -36.39784622192383 },
  { x: -16.710189819335938, y: 49.263675689697266 },
  { x: -56.585853576660156, y: 37.85963439941406 },
  { x: 20.840980529785156, y: -47.80188751220703 }
]

/**
 * Build the media `annotations` array for newsletter branding.
 * Applied on imageMessage / videoMessage (not outer contextInfo).
 *
 * @param {object} ann - { newsletterJid, newsletterName, contentType?, accessibilityText? }
 * @returns {object[]}
 */
function buildMediaAnnotations(ann) {
  if (!ann || !ann.newsletterJid) return undefined
  return [
    {
      polygonVertices: DEFAULT_POLYGON,
      newsletter: {
        newsletterJid: ann.newsletterJid,
        newsletterName: ann.newsletterName || '',
        // 1 = UPDATE (proto.ContextInfo.ForwardedNewsletterMessageInfo.ContentType.UPDATE)
        contentType: ann.contentType ?? 1,
        accessibilityText: ann.accessibilityText || ann.newsletterName || ''
      }
    }
  ]
}

/**
 * Inject newsletter annotations into generated media messages.
 * Looks for imageMessage / videoMessage / ptvMessage and sets `.annotations`.
 *
 * @param {object} message - proto Message
 * @param {object} ann
 */
function injectNewsletterAnnotation(message, ann) {
  if (!message || !ann) return
  const annotations = buildMediaAnnotations(ann)
  if (!annotations) return

  const targets = ['imageMessage', 'videoMessage', 'ptvMessage', 'documentMessage']
  for (const key of targets) {
    if (message[key]) {
      message[key].annotations = annotations
    }
  }

  // Also support nested wrappers
  if (message.ephemeralMessage?.message) {
    injectNewsletterAnnotation(message.ephemeralMessage.message, ann)
  }
  if (message.viewOnceMessage?.message) {
    injectNewsletterAnnotation(message.viewOnceMessage.message, ann)
  }
  if (message.viewOnceMessageV2?.message) {
    injectNewsletterAnnotation(message.viewOnceMessageV2.message, ann)
  }
  if (message.documentWithCaptionMessage?.message) {
    injectNewsletterAnnotation(message.documentWithCaptionMessage.message, ann)
  }
}

/**
 * Generic relay helper used by every sendX method.
 *
 * 1. Builds full WAMessage via generateWAMessage (or FromContent for raw)
 * 2. Optionally injects newsletter media annotations
 * 3. Sends through sock.relayMessage
 * 4. Returns the generated WebMessageInfo
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
    logger:
      extra.logger ||
      sock.logger || {
        child: () => ({
          info: () => {},
          error: () => {},
          warn: () => {},
          debug: () => {},
          trace: () => {}
        })
      },
    messageId: extra.messageId || generateMessageId(sock.user?.id, extra.messageIdPrefix),
    quoted: quoted || extra.quoted,
    ephemeralExpiration: extra.ephemeral,
    mediaUploadTimeoutMs: extra.mediaUploadTimeoutMs,
    // pass jid so media prep can detect newsletter targets
    jid,
    ...extra.generationOptions
  }

  let fullMsg
  if (content.raw === true) {
    const { raw, ...rest } = content
    fullMsg = generateWAMessageFromContent(jid, rest, options)
  } else {
    fullMsg = await generateWAMessage(jid, content, options)
  }

  // Newsletter media annotation (image/video annotations array)
  if (extra.newsletterAnnotation && fullMsg.message) {
    injectNewsletterAnnotation(fullMsg.message, extra.newsletterAnnotation)
  }

  // Inject custom contextInfo extras (e.g. album messageAssociation, mentionAll)
  if (fullMsg.message && extra.generationOptions?.messageContextInfo) {
    fullMsg.message.messageContextInfo = {
      ...(fullMsg.message.messageContextInfo || {}),
      ...extra.generationOptions.messageContextInfo
    }
  }
  // Also honour contextInfo that was put on the content itself
  if (fullMsg.message && content.contextInfo) {
    fullMsg.message.messageContextInfo = {
      ...(fullMsg.message.messageContextInfo || {}),
      ...content.contextInfo
    }
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
  relayHelper,
  buildMediaAnnotations,
  injectNewsletterAnnotation
}
