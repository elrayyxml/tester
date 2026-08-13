'use strict'

const { generateWAMessage, generateWAMessageFromContent, prepareWAMessageMedia } = require('baileys')
const { generateMessageId } = require('../utils/functions')
const { NexrayError, ErrorMessages } = require('../constant/errors')


/**
 * Resolve additionalNodes based on message content type.
 * Source patterns: pastebin eU5Esi7s / Nixel interactive builder.
 *
 * @param {object} message - proto IMessage
 * @param {object} [extra]
 * @returns {object[]|undefined}
 */
function resolveAdditionalNodes(message, extra = {}) {
  if (extra.additionalNodes) return extra.additionalNodes
  if (!message) return undefined

  // Interactive / native flow (mixed buttons, cta_copy, etc.)
  if (message.interactiveMessage) {
    const flowName = extra.nativeFlowName || 'mixed'
    if (flowName === 'catalog_message' || flowName === 'order_details') {
      return [{ tag: 'biz', attrs: { native_flow_name: flowName } }]
    }
    if (flowName === 'payment_key_info') {
      return [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [{ tag: 'native_flow', attrs: { name: 'payment_key_info' } }]
            }
          ]
        }
      ]
    }
    // default mixed
    return [
      {
        tag: 'biz',
        attrs: {},
        content: [
          {
            tag: 'interactive',
            attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
          }
        ]
      }
    ]
  }

  // Legacy buttonsMessage – also needs biz interactive sometimes
  if (message.buttonsMessage) {
    return [
      {
        tag: 'biz',
        attrs: {},
        content: [
          {
            tag: 'interactive',
            attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
          }
        ]
      }
    ]
  }

  // Poll creation
  if (
    message.pollCreationMessage ||
    message.pollCreationMessageV2 ||
    message.pollCreationMessageV3 ||
    message.pollCreationMessageV5
  ) {
    return [{ tag: 'meta', attrs: { polltype: 'creation' } }]
  }

  // Event message
  if (message.eventMessage) {
    return [{ tag: 'meta', attrs: { event_type: 'creation' } }]
  }

  // AI / bot reply marker
  if (extra.asBot || extra.bizBot) {
    return [
      { tag: 'bot', attrs: { biz_bot: '1' } },
      { tag: 'biz', attrs: {} }
    ]
  }

  return undefined
}

/** @deprecated use resolveAdditionalNodes – kept for callers */
function interactiveBizNodes(flowName = 'mixed') {
  return resolveAdditionalNodes({ interactiveMessage: {} }, { nativeFlowName: flowName })
}

/**
 * Status-mention meta node.
 */
function statusMentionNodes(jids) {
  return [
    {
      tag: 'meta',
      attrs: {},
      content: [
        {
          tag: 'mentioned_users',
          attrs: {},
          content: (jids || []).map(jid => ({
            tag: 'to',
            attrs: { jid },
            content: undefined
          }))
        }
      ]
    }
  ]
}

const DEFAULT_POLYGON = [
  { x: 60.71664810180664, y: -36.39784622192383 },
  { x: -16.710189819335938, y: 49.263675689697266 },
  { x: -56.585853576660156, y: 37.85963439941406 },
  { x: 20.840980529785156, y: -47.80188751220703 }
]

function buildMediaAnnotations(ann) {
  if (!ann || !ann.newsletterJid) return undefined
  return [
    {
      polygonVertices: DEFAULT_POLYGON,
      newsletter: {
        newsletterJid: ann.newsletterJid,
        newsletterName: ann.newsletterName || '',
        contentType: ann.contentType ?? 1,
        accessibilityText: ann.accessibilityText || ann.newsletterName || ''
      }
    }
  ]
}

function injectNewsletterAnnotation(message, ann) {
  if (!message || !ann) return
  const annotations = buildMediaAnnotations(ann)
  if (!annotations) return
  for (const key of ['imageMessage', 'videoMessage', 'ptvMessage', 'documentMessage']) {
    if (message[key]) message[key].annotations = annotations
  }
  if (message.ephemeralMessage?.message) injectNewsletterAnnotation(message.ephemeralMessage.message, ann)
  if (message.viewOnceMessage?.message) injectNewsletterAnnotation(message.viewOnceMessage.message, ann)
  if (message.viewOnceMessageV2?.message) injectNewsletterAnnotation(message.viewOnceMessageV2.message, ann)
  if (message.documentWithCaptionMessage?.message) {
    injectNewsletterAnnotation(message.documentWithCaptionMessage.message, ann)
  }
}

function buildGenOptions(sock, extra = {}) {
  return {
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
    quoted: extra.quoted,
    ephemeralExpiration: extra.ephemeral,
    mediaUploadTimeoutMs: extra.mediaUploadTimeoutMs,
    jid: extra.jid,
    ...extra.generationOptions
  }
}

async function relayRaw(sock, jid, messageContent, extra = {}) {
  if (!jid) throw new NexrayError(ErrorMessages.MISSING_JID, { code: 'MISSING_JID' })
  if (!messageContent) throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: 'MISSING_CONTENT' })

  const options = buildGenOptions(sock, { ...extra, jid })
  const fullMsg = generateWAMessageFromContent(jid, messageContent, options)

  if (extra.newsletterAnnotation && fullMsg.message) {
    injectNewsletterAnnotation(fullMsg.message, extra.newsletterAnnotation)
  }
  if (fullMsg.message && extra.messageContextInfo) {
    fullMsg.message.messageContextInfo = {
      ...(fullMsg.message.messageContextInfo || {}),
      ...extra.messageContextInfo
    }
  }

  const additionalNodes = resolveAdditionalNodes(fullMsg.message, extra)

  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes,
    statusJidList: extra.statusJidList,
    useCachedGroupMetadata: extra.useCachedGroupMetadata !== false
  })
  return fullMsg
}

async function relayHelper(sock, jid, content, quoted, extra = {}) {
  if (!jid) throw new NexrayError(ErrorMessages.MISSING_JID, { code: 'MISSING_JID' })
  if (!content) throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: 'MISSING_CONTENT' })

  const options = buildGenOptions(sock, {
    ...extra,
    jid,
    quoted: quoted || extra.quoted
  })

  let fullMsg
  if (content.raw === true) {
    const { raw, ...rest } = content
    fullMsg = generateWAMessageFromContent(jid, rest, options)
  } else {
    fullMsg = await generateWAMessage(jid, content, options)
  }

  if (extra.newsletterAnnotation && fullMsg.message) {
    injectNewsletterAnnotation(fullMsg.message, extra.newsletterAnnotation)
  }
  if (fullMsg.message && extra.generationOptions?.messageContextInfo) {
    fullMsg.message.messageContextInfo = {
      ...(fullMsg.message.messageContextInfo || {}),
      ...extra.generationOptions.messageContextInfo
    }
  }
  if (fullMsg.message && content.contextInfo) {
    fullMsg.message.messageContextInfo = {
      ...(fullMsg.message.messageContextInfo || {}),
      ...content.contextInfo
    }
  }

  const additionalNodes = resolveAdditionalNodes(fullMsg.message, extra)

  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes,
    statusJidList: extra.statusJidList,
    useCachedGroupMetadata: extra.useCachedGroupMetadata !== false
  })
  return fullMsg
}

async function prepareMedia(sock, mediaContent, extra = {}) {
  const options = buildGenOptions(sock, extra)
  return prepareWAMessageMedia(mediaContent, {
    upload: options.upload,
    logger: options.logger,
    mediaTypeOverride: extra.mediaTypeOverride,
    mediaUploadTimeoutMs: options.mediaUploadTimeoutMs,
    jid: extra.jid
  })
}

module.exports = {
  relayHelper,
  relayRaw,
  prepareMedia,
  buildMediaAnnotations,
  injectNewsletterAnnotation,
  resolveAdditionalNodes,
  interactiveBizNodes,
  statusMentionNodes
}
