'use strict'

var baileys = require('baileys')
var generateWAMessage = baileys.generateWAMessage
var generateWAMessageFromContent = baileys.generateWAMessageFromContent
var prepareWAMessageMedia = baileys.prepareWAMessageMedia
var generateMessageId = require('../utils/functions').generateMessageId
var NexrayError = require('../constant/errors').NexrayError
var ErrorMessages = require('../constant/errors').ErrorMessages

var DEFAULT_POLYGON = [
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
        contentType: ann.contentType != null ? ann.contentType : 1,
        accessibilityText: ann.accessibilityText || ann.newsletterName || ''
      }
    }
  ]
}

function injectNewsletterAnnotation(message, ann) {
  if (!message || !ann) return
  var annotations = buildMediaAnnotations(ann)
  if (!annotations) return
  var keys = ['imageMessage', 'videoMessage', 'ptvMessage', 'documentMessage']
  for (var i = 0; i < keys.length; i++) {
    if (message[keys[i]]) message[keys[i]].annotations = annotations
  }
  if (message.ephemeralMessage && message.ephemeralMessage.message) {
    injectNewsletterAnnotation(message.ephemeralMessage.message, ann)
  }
  if (message.viewOnceMessage && message.viewOnceMessage.message) {
    injectNewsletterAnnotation(message.viewOnceMessage.message, ann)
  }
  if (message.viewOnceMessageV2 && message.viewOnceMessageV2.message) {
    injectNewsletterAnnotation(message.viewOnceMessageV2.message, ann)
  }
}

/**
 * Normalize quoted input: accept serialized m, raw WAMessage, or { key, message }.
 */
function normalizeQuoted(quoted) {
  if (!quoted) return undefined
  const fallbackMessage = quoted.msg && quoted.type ? { [quoted.type]: quoted.msg } : quoted.msg
  const message = quoted.message || quoted.fakeObj?.message || fallbackMessage
  if (quoted.key && message) {
    return {
      key: {
        remoteJid: quoted.key.remoteJid,
        fromMe: !!quoted.key.fromMe,
        id: quoted.key.id,
        participant: quoted.key.participant
      },
      message,
      messageTimestamp: quoted.messageTimestamp,
      participant: quoted.participant || quoted.key.participant,
      pushName: quoted.pushName
    }
  }
  if (quoted.key) {
    return {
      key: quoted.key,
      message,
      messageTimestamp: quoted.messageTimestamp,
      participant: quoted.participant || quoted.key.participant
    }
  }
  return quoted
}

function mergeContextInfo(message, contextInfo) {
  if (!message || !contextInfo || typeof contextInfo !== 'object') return message
  if (message.ephemeralMessage?.message) {
    mergeContextInfo(message.ephemeralMessage.message, contextInfo)
    return message
  }
  if (message.viewOnceMessage?.message) {
    mergeContextInfo(message.viewOnceMessage.message, contextInfo)
    return message
  }
  if (message.viewOnceMessageV2?.message) {
    mergeContextInfo(message.viewOnceMessageV2.message, contextInfo)
    return message
  }
  const type = Object.keys(message).find(key => key !== 'messageContextInfo')
  if (!type || !message[type] || typeof message[type] !== 'object') return message
  message[type].contextInfo = Object.assign({}, message[type].contextInfo || {}, contextInfo)
  return message
}

function ensureQuotedContext(message, quoted, userJid, jid) {
  const normalizedQuoted = normalizeQuoted(quoted)
  if (!message || !normalizedQuoted?.key || !normalizedQuoted.message) return message
  const { normalizeMessageContent, getContentType } = require('../utils/message')
  const normalizedContent = normalizeMessageContent(normalizedQuoted.message)
  const quotedType = getContentType(normalizedContent)
  if (!quotedType || !normalizedContent?.[quotedType]) return message
  const quotedValue = normalizedContent[quotedType]
  const quotedMessage = {
    [quotedType]: quotedValue && typeof quotedValue === 'object' ? { ...quotedValue } : quotedValue
  }
  if (quotedMessage[quotedType] && typeof quotedMessage[quotedType] === 'object' && quotedMessage[quotedType].contextInfo) {
    delete quotedMessage[quotedType].contextInfo
  }

  let target = message
  while (target?.ephemeralMessage?.message || target?.viewOnceMessage?.message || target?.viewOnceMessageV2?.message) {
    target = target.ephemeralMessage?.message || target.viewOnceMessage?.message || target.viewOnceMessageV2?.message
  }
  const messageType = Object.keys(target || {}).find(key => key !== 'messageContextInfo')
  if (!messageType || !target[messageType] || typeof target[messageType] !== 'object') return message
  const participant = normalizedQuoted.key.fromMe
    ? userJid
    : normalizedQuoted.participant || normalizedQuoted.key.participant || normalizedQuoted.key.remoteJid
  const contextInfo = {
    ...(target[messageType].contextInfo || {}),
    participant,
    stanzaId: normalizedQuoted.key.id,
    quotedMessage
  }
  if (jid && normalizedQuoted.key.remoteJid && jid !== normalizedQuoted.key.remoteJid && !String(jid).endsWith('@newsletter')) {
    contextInfo.remoteJid = normalizedQuoted.key.remoteJid
  }
  target[messageType].contextInfo = contextInfo
  return message
}

function resolveAdditionalNodes(message, extra) {
  extra = extra || {}
  if (extra.additionalNodes) return extra.additionalNodes
  if (!message) return undefined

  if (message.interactiveMessage) {
    var flowName = extra.nativeFlowName || 'mixed'
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

  if (
    message.pollCreationMessage ||
    message.pollCreationMessageV2 ||
    message.pollCreationMessageV3 ||
    message.pollCreationMessageV5
  ) {
    return [{ tag: 'meta', attrs: { polltype: 'creation' } }]
  }

  if (message.eventMessage) {
    return [{ tag: 'meta', attrs: { event_type: 'creation' } }]
  }

  if (extra.asBot || extra.bizBot) {
    return [
      { tag: 'bot', attrs: { biz_bot: '1' } },
      { tag: 'biz', attrs: {} }
    ]
  }

  return undefined
}

function interactiveBizNodes(flowName) {
  return resolveAdditionalNodes({ interactiveMessage: {} }, { nativeFlowName: flowName || 'mixed' })
}

function statusMentionNodes(jids) {
  return [
    {
      tag: 'meta',
      attrs: {},
      content: [
        {
          tag: 'mentioned_users',
          attrs: {},
          content: (jids || []).map(function (jid) {
            return { tag: 'to', attrs: { jid: jid }, content: undefined }
          })
        }
      ]
    }
  ]
}

function buildGenOptions(sock, extra) {
  extra = extra || {}
  var quoted = normalizeQuoted(extra.quoted)
  return {
    userJid: (sock.user && sock.user.id) || (sock.authState && sock.authState.creds && sock.authState.creds.me && sock.authState.creds.me.id),
    upload: sock.waUploadToServer,
    mediaCache: sock._nexrayMediaCache || extra.mediaCache,
    logger:
      extra.logger ||
      sock.logger || {
        child: function () {
          return { info: noop, error: noop, warn: noop, debug: noop, trace: noop }
        }
      },
    messageId: extra.messageId || generateMessageId(sock.user && sock.user.id, extra.messageIdPrefix),
    quoted: quoted,
    ephemeralExpiration: extra.ephemeral,
    mediaUploadTimeoutMs: extra.mediaUploadTimeoutMs,
    jid: extra.jid
  }
}

function noop() {}

/**
 * Relay pre-built WAMessageContent (raw proto).
 */
async function relayRaw(sock, jid, messageContent, extra) {
  extra = extra || {}
  if (!jid) throw new NexrayError(ErrorMessages.MISSING_JID, { code: 'MISSING_JID' })
  if (!messageContent) throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: 'MISSING_CONTENT' })

  var options = buildGenOptions(sock, Object.assign({}, extra, { jid: jid }))
  var fullMsg = generateWAMessageFromContent(jid, messageContent, options)

  if (extra.newsletterAnnotation && fullMsg.message) {
    injectNewsletterAnnotation(fullMsg.message, extra.newsletterAnnotation)
  }
  if (fullMsg.message && extra.messageContextInfo) {
    fullMsg.message.messageContextInfo = Object.assign(
      {},
      fullMsg.message.messageContextInfo || {},
      extra.messageContextInfo
    )
  }
  if (fullMsg.message && extra.contextInfo) mergeContextInfo(fullMsg.message, extra.contextInfo)
  if (fullMsg.message && options.quoted) ensureQuotedContext(fullMsg.message, options.quoted, options.userJid, jid)

  var additionalNodes = resolveAdditionalNodes(fullMsg.message, extra)
  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes: additionalNodes,
    statusJidList: extra.statusJidList,
    useCachedGroupMetadata: extra.useCachedGroupMetadata !== false
  })
  return fullMsg
}

/**
 * High-level AnyMessageContent path.
 */
async function relayHelper(sock, jid, content, quoted, extra) {
  extra = extra || {}
  if (!jid) throw new NexrayError(ErrorMessages.MISSING_JID, { code: 'MISSING_JID' })
  if (!content) throw new NexrayError(ErrorMessages.MISSING_CONTENT, { code: 'MISSING_CONTENT' })

  var options = buildGenOptions(
    sock,
    Object.assign({}, extra, { jid: jid, quoted: quoted || extra.quoted })
  )

  var fullMsg
  if (content.raw === true) {
    var rest = Object.assign({}, content)
    delete rest.raw
    fullMsg = generateWAMessageFromContent(jid, rest, options)
  } else {
    fullMsg = await generateWAMessage(jid, content, options)
  }

  if (extra.newsletterAnnotation && fullMsg.message) {
    injectNewsletterAnnotation(fullMsg.message, extra.newsletterAnnotation)
  }
  if (fullMsg.message && extra.generationOptions && extra.generationOptions.messageContextInfo) {
    fullMsg.message.messageContextInfo = Object.assign(
      {},
      fullMsg.message.messageContextInfo || {},
      extra.generationOptions.messageContextInfo
    )
  }
  if (fullMsg.message && content.contextInfo) {
    fullMsg.message.messageContextInfo = Object.assign(
      {},
      fullMsg.message.messageContextInfo || {},
      content.contextInfo
    )
  }
  if (fullMsg.message && extra.contextInfo) mergeContextInfo(fullMsg.message, extra.contextInfo)
  if (fullMsg.message && options.quoted) ensureQuotedContext(fullMsg.message, options.quoted, options.userJid, jid)

  var additionalNodes = resolveAdditionalNodes(fullMsg.message, extra)
  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalAttributes: extra.additionalAttributes,
    additionalNodes: additionalNodes,
    statusJidList: extra.statusJidList,
    useCachedGroupMetadata: extra.useCachedGroupMetadata !== false
  })
  return fullMsg
}

async function prepareMedia(sock, mediaContent, extra) {
  extra = extra || {}
  var options = buildGenOptions(sock, extra)
  return prepareWAMessageMedia(mediaContent, {
    upload: options.upload,
    mediaCache: options.mediaCache,
    logger: options.logger,
    mediaTypeOverride: extra.mediaTypeOverride,
    mediaUploadTimeoutMs: options.mediaUploadTimeoutMs,
    jid: extra.jid
  })
}

exports.relayHelper = relayHelper;
exports.relayRaw = relayRaw;
exports.prepareMedia = prepareMedia;
exports.buildMediaAnnotations = buildMediaAnnotations;
exports.injectNewsletterAnnotation = injectNewsletterAnnotation;
exports.resolveAdditionalNodes = resolveAdditionalNodes;
exports.interactiveBizNodes = interactiveBizNodes;
exports.statusMentionNodes = statusMentionNodes;
exports.normalizeQuoted = normalizeQuoted;
exports.mergeContextInfo = mergeContextInfo;
exports.ensureQuotedContext = ensureQuotedContext;
