'use strict'

/**
 * Get the primary content type key of a WAMessage content.
 * @param {object} message
 * @returns {string|undefined}
 */
function getContentType(message) {
  if (!message || typeof message !== 'object') return undefined
  const keys = Object.keys(message)
  const ignore = new Set([
    'senderKeyDistributionMessage',
    'messageContextInfo',
    'deviceSentMessage'
  ])
  for (const k of keys) {
    if (!ignore.has(k) && k !== 'protocolMessage') return k
  }
  return keys[0]
}

/**
 * Unwrap ephemeral / viewOnce / documentWithCaption wrappers.
 * @param {object} content
 * @returns {object}
 */
function normalizeMessageContent(content) {
  if (!content) return content
  if (content.ephemeralMessage?.message) {
    return normalizeMessageContent(content.ephemeralMessage.message)
  }
  if (content.viewOnceMessage?.message) {
    return normalizeMessageContent(content.viewOnceMessage.message)
  }
  if (content.viewOnceMessageV2?.message) {
    return normalizeMessageContent(content.viewOnceMessageV2.message)
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return normalizeMessageContent(content.viewOnceMessageV2Extension.message)
  }
  if (content.documentWithCaptionMessage?.message) {
    return normalizeMessageContent(content.documentWithCaptionMessage.message)
  }
  if (content.templateMessage?.hydratedFourRowTemplate) {
    return content.templateMessage.hydratedFourRowTemplate
  }
  if (content.templateMessage?.hydratedTemplate) {
    return content.templateMessage.hydratedTemplate
  }
  return content
}

/**
 * Extract the innermost message content.
 * @param {object} content
 * @returns {object}
 */
function extractMessageContent(content) {
  const normalized = normalizeMessageContent(content)
  if (!normalized) return {}
  const type = getContentType(normalized)
  return type ? normalized[type] : normalized
}

/**
 * Build a normalized body string from various message types.
 * Used by serialize.
 * @param {object} message - full WAMessage.message
 * @returns {string}
 */
function getBodyFromMessage(message) {
  if (!message) return ''
  const content = normalizeMessageContent(message)
  if (!content) return ''

  if (content.conversation) return content.conversation
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text
  if (content.imageMessage?.caption) return content.imageMessage.caption
  if (content.videoMessage?.caption) return content.videoMessage.caption
  if (content.documentMessage?.caption) return content.documentMessage.caption
  if (content.documentWithCaptionMessage?.message) {
    return getBodyFromMessage(content.documentWithCaptionMessage.message)
  }
  if (content.buttonsResponseMessage?.selectedDisplayText) {
    return content.buttonsResponseMessage.selectedDisplayText
  }
  if (content.listResponseMessage?.singleSelectReply?.selectedRowId) {
    const title = content.listResponseMessage.title || ''
    const row = content.listResponseMessage.singleSelectReply.selectedRowId
    return title ? `${title} ${row}` : row
  }
  if (content.listResponseMessage?.title) return content.listResponseMessage.title
  if (content.templateButtonReplyMessage?.selectedDisplayText) {
    return content.templateButtonReplyMessage.selectedDisplayText
  }
  if (content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const params = JSON.parse(content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)
      return params?.id || params?.title || params?.display_text || JSON.stringify(params)
    } catch {
      return content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson
    }
  }
  if (content.reactionMessage?.text) return content.reactionMessage.text
  if (content.protocolMessage?.type === 14 /* MESSAGE_EDIT */) {
    // edited text often lives in editedMessage
    if (content.protocolMessage.editedMessage) {
      return getBodyFromMessage(content.protocolMessage.editedMessage)
    }
  }
  return ''
}

module.exports = {
  getContentType,
  normalizeMessageContent,
  extractMessageContent,
  getBodyFromMessage
}
