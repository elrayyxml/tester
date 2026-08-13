'use strict'

const { getContentType, normalizeMessageContent, getBodyFromMessage } = require('../utils/message')
const { getDevice, defaultIsBot } = require('../utils/functions')

/**
 * Serialize a raw WAMessage from messages.upsert into a convenient object.
 * Pure function – never mutates the original message.
 *
 * @param {import('baileys').WASocket} sock
 * @param {import('baileys').WAMessage} msg
 * @param {object} [options]
 * @returns {object}
 */
function serialize(sock, msg, options = {}) {
  if (!msg) return null

  const key = msg.key || {}
  const id = key.id
  const chat = key.remoteJid
  const fromMe = !!key.fromMe
  const isGroup = typeof chat === 'string' && chat.endsWith('@g.us')
  const isPrivate = typeof chat === 'string' && chat.endsWith('@s.whatsapp.net')
  const isNewsletter = typeof chat === 'string' && chat.endsWith('@newsletter')

  // Normalize sender (prefer phone number / participantAlt when available)
  let sender = key.participantAlt || key.participant || key.remoteJidAlt || chat
  if (fromMe && sock.user?.id) {
    sender = sock.user.id
  }
  // Prefer PN over LID when both exist
  if (key.participantAlt && key.participantAlt.includes('@s.whatsapp.net')) {
    sender = key.participantAlt
  }

  const senderLid = key.participant && key.participant.includes('@lid')
    ? key.participant
    : (key.remoteJid && key.remoteJid.includes('@lid') ? key.remoteJid : undefined)

  const isBotFn = typeof options.bot === 'function' ? options.bot : defaultIsBot
  const isBot = isBotFn(id)

  const device = getDevice(id)

  const rawContent = msg.message || {}
  const content = normalizeMessageContent(rawContent)
  const type = getContentType(content) || getContentType(rawContent) || 'unknown'
  const msgContent = type && content ? content[type] : content

  const body = getBodyFromMessage(rawContent)

  // Mentions
  let mentionedJid = []
  const ctx = msgContent?.contextInfo || content?.extendedTextMessage?.contextInfo || content?.messageContextInfo
  if (ctx?.mentionedJid) {
    mentionedJid = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []
  }

  // Quoted (one level deep)
  let quoted = null
  if (ctx?.quotedMessage) {
    const qKey = {
      remoteJid: chat,
      fromMe: ctx.participant ? false : fromMe,
      id: ctx.stanzaId,
      participant: ctx.participant
    }
    const qMsg = {
      key: qKey,
      message: ctx.quotedMessage,
      pushName: ctx.participant || undefined
    }
    quoted = serialize(sock, qMsg, options)
    // strip recursive helpers to avoid circularity noise
    if (quoted) {
      quoted.reply = undefined
      quoted.react = undefined
    }
  }

  const expiration = ctx?.expiration

  const m = {
    key,
    id,
    chat,
    sender,
    senderLid,
    fromMe,
    isGroup,
    isPrivate,
    isNewsletter,
    isBot,
    device,
    type,
    msg: msgContent,
    body,
    mentionedJid,
    quoted,
    expiration,
    pushName: msg.pushName,
    messageTimestamp: msg.messageTimestamp,
    broadcast: msg.broadcast,
    // keep original for advanced use
    message: rawContent,
    fakeObj: msg
  }

  // Shortcut helpers bound to this message
  m.reply = async function reply(text, opts = {}) {
    return sock.sendText(chat, text, m, opts)
  }

  m.react = async function react(emoji) {
    return sock.sendReact(chat, emoji, key)
  }

  return m
}

module.exports = {
  serialize
}
