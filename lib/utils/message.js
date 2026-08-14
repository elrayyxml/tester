'use strict'

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage']

function getContentType(message) {
  if (!message || typeof message !== 'object') return undefined
  return Object.keys(message).find(key => !key.endsWith('MessageContextInfo') && message[key] !== undefined)
}

function normalizeMessageContent(content) {
  let current = content || {}
  let changed = true
  while (changed && current && typeof current === 'object') {
    changed = false
    for (const wrapper of WRAPPERS) {
      if (current[wrapper]?.message) {
        current = current[wrapper].message
        changed = true
        break
      }
    }
  }
  return current
}

function extractMessageContent(content) {
  return normalizeMessageContent(content)
}

function parseNativeFlowBody(nativeFlow) {
  const raw = nativeFlow?.paramsJson
  if (!raw) return ''
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed?.id || parsed?.selectedId || parsed?.title || parsed?.text || parsed?.display_text || ''
  } catch {
    return String(raw)
  }
}

function getBodyFromMessage(message) {
  const content = normalizeMessageContent(message)
  if (!content) return ''
  if (typeof content.conversation === 'string') return content.conversation
  if (typeof content.extendedTextMessage?.text === 'string') return content.extendedTextMessage.text
  for (const type of ['imageMessage', 'videoMessage', 'documentMessage']) {
    if (typeof content[type]?.caption === 'string') return content[type].caption
  }
  if (typeof content.buttonsResponseMessage?.selectedDisplayText === 'string') return content.buttonsResponseMessage.selectedDisplayText
  if (typeof content.listResponseMessage?.singleSelectReply?.selectedRowId === 'string') return content.listResponseMessage.singleSelectReply.selectedRowId
  if (typeof content.listResponseMessage?.title === 'string') return content.listResponseMessage.title
  if (typeof content.templateButtonReplyMessage?.selectedDisplayText === 'string') return content.templateButtonReplyMessage.selectedDisplayText
  if (typeof content.interactiveResponseMessage?.nativeFlowResponseMessage?.name === 'string') {
    return parseNativeFlowBody(content.interactiveResponseMessage.nativeFlowResponseMessage)
  }
  if (content.reactionMessage?.text) return content.reactionMessage.text
  return ''
}

function getContextInfo(content) {
  const normalized = normalizeMessageContent(content)
  const type = getContentType(normalized)
  return normalized?.[type]?.contextInfo || normalized?.contextInfo || {}
}

module.exports = { getContentType, normalizeMessageContent, extractMessageContent, getBodyFromMessage, getContextInfo, parseNativeFlowBody }
