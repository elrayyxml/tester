'use strict'

const { getContentType, normalizeMessageContent, getBodyFromMessage, getContextInfo } = require('../utils/message')
const { getDevice } = require('../utils/functions')

function defaultBotDetector(id = '') {
  const value = String(id)
  return /^3EB0.{15,}$/i.test(value) || /^BAE[A-Z0-9]{10,}$/i.test(value)
}

function serialize(sock, message, options = {}, depth = 0) {
  const raw = message || {}
  const key = raw.key || {}
  const chat = key.remoteJid || ''
  const content = normalizeMessageContent(raw.message || {})
  const type = getContentType(content)
  const contextInfo = getContextInfo(content)
  const sender = key.participant || contextInfo.participant || chat
  const senderLid = key.participantAlt || contextInfo.participantAlt || (String(sender).endsWith('@lid') ? sender : undefined)
  const body = getBodyFromMessage(content)
  const result = {
    ...raw,
    key,
    id: key.id,
    chat,
    sender,
    senderLid,
    fromMe: Boolean(key.fromMe),
    isGroup: chat.endsWith('@g.us'),
    isPrivate: chat.endsWith('@s.whatsapp.net'),
    isBot: (options.bot || defaultBotDetector)(key.id || ''),
    device: getDevice(key.id || ''),
    type,
    msg: type ? content[type] : content,
    body,
    mentionedJid: contextInfo.mentionedJid || [],
    expiration: contextInfo.expiration,
    pushName: raw.pushName,
    timestamp: raw.messageTimestamp
  }
  const quotedRaw = contextInfo.quotedMessage && depth < 1 ? {
    key: {
      remoteJid: chat,
      id: contextInfo.stanzaId,
      fromMe: Boolean(contextInfo.participant && contextInfo.participant === sock.user?.id),
      participant: contextInfo.participant
    },
    message: contextInfo.quotedMessage,
    pushName: contextInfo.remoteJid
  } : undefined
  if (quotedRaw) result.quoted = serialize(sock, quotedRaw, options, depth + 1)
  result.reply = (text, opts) => sock.sendText(chat, text, result, opts)
  result.react = emoji => sock.sendReact(chat, emoji, key)
  result.download = async () => {
    const media = result.msg
    if (!media || typeof sock.downloadMediaMessage !== 'function') return undefined
    return sock.downloadMediaMessage(raw)
  }
  return result
}

module.exports = { serialize, defaultBotDetector }
