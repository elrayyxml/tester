'use strict'

const { wbError } = require('../constant/errors')
const { generateMessageId } = require('../utils/functions')
const { normalizeMessageContent, getContentType } = require('../utils/message')

function getBaileys(sock) {
  if (sock?.__wbBaileys) return sock.__wbBaileys
  try {
    return require('baileys')
  } catch {
    try {
      return require('@whiskeysockets/baileys')
    } catch {
      throw wbError('BAILEYS_API', 'Install package Baileys resmi sebagai peerDependency.')
    }
  }
}

function mergeContextInfo(content, contextInfo) {
  if (!contextInfo || !content || typeof content !== 'object') return content
  const type = Object.keys(content).find(key => /Message$/.test(key) && content[key] && typeof content[key] === 'object')
  if (!type) return content
  return { ...content, [type]: { ...content[type], contextInfo: { ...content[type].contextInfo, ...contextInfo } } }
}

async function buildWAMessage(sock, jid, content, quoted, options = {}) {
  const baileys = getBaileys(sock)
  const messageId = options.messageId || generateMessageId(sock.user?.id, options.messageIdPrefix)
  const messageOptions = {
    ...options,
    quoted: quoted || options.quoted,
    messageId,
    userJid: sock.user?.id,
    upload: options.upload || sock.waUploadToServer
  }
  delete messageOptions.messageIdPrefix
  delete messageOptions.raw
  delete messageOptions.patchMessageBeforeSending
  delete messageOptions.useNewsletterStanza
  delete messageOptions.additionalAttributes
  delete messageOptions.additionalNodes
  if (typeof baileys.generateWAMessage === 'function') return await baileys.generateWAMessage(jid, content, messageOptions)
  if (typeof baileys.generateWAMessageFromContent === 'function') return baileys.generateWAMessageFromContent(jid, content, messageOptions)
  throw wbError('BAILEYS_API', 'generateWAMessage atau generateWAMessageFromContent tidak ditemukan.')
}

function getMediaType(message) {
  const content = normalizeMessageContent(message)
  if (content?.imageMessage) return 'image'
  if (content?.videoMessage) return content.videoMessage.gifPlayback ? 'gif' : 'video'
  if (content?.stickerMessage) return content.stickerMessage.isLottie ? '1p_sticker' : content.stickerMessage.isAvatar ? 'avatar_sticker' : 'sticker'
  if (content?.audioMessage) return content.audioMessage.ptt ? 'ptt' : 'audio'
  if (content?.albumMessage) return 'collection'
  if (content?.contactMessage) return 'vcard'
  if (content?.documentMessage) return 'document'
  if (content?.contactsArrayMessage) return 'contact_array'
  if (content?.liveLocationMessage) return 'livelocation'
  if (content?.stickerPackMessage) return 'sticker_pack'
  return ''
}

function getNewsletterMessageType(message) {
  const content = normalizeMessageContent(message)
  if (!content) return 'text'
  if (content.reactionMessage || content.encReactionMessage) return 'reaction'
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3 || content.pollCreationMessageV5 || content.pollCreationMessageV6 || content.pollUpdateMessage) return 'poll'
  if (content.eventMessage) return 'event'
  if (getMediaType(content)) return 'media'
  if (content.listMessage) return 'list'
  if (content.orderMessage) return 'order'
  if (content.productMessage) return 'product'
  if (content.interactiveResponseMessage) return 'native_flow_response'
  if (content.interactiveMessage) return 'interactive'
  if (content.extendedTextMessage?.matchedText || content.groupInviteMessage) return 'url'
  const text = content.extendedTextMessage?.text || content.conversation || ''
  if (text.includes('://wa.me/c/')) return 'cataloglink'
  if (text.includes('://wa.me/p/')) return 'productlink'
  return 'text'
}

function isNewsletterJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@newsletter')
}

async function patchMessage(sock, message, options = {}, recipientJids = []) {
  const patcher = options.patchMessageBeforeSending || sock.__wbOptions?.patchMessageBeforeSending
  if (typeof patcher !== 'function') return message
  const patched = await patcher(message, recipientJids)
  if (Array.isArray(patched)) throw wbError('BAILEYS_API', 'patchMessageBeforeSending mengembalikan array untuk newsletter; gunakan satu WebMessage.')
  return patched || message
}

async function relayNewsletterMessage(sock, jid, fullMsg, extra = {}, options = {}) {
  const baileys = getBaileys(sock)
  if (typeof sock.sendNode !== 'function' || typeof baileys.encodeNewsletterMessage !== 'function') return false
  const patched = await patchMessage(sock, fullMsg.message, options, [])
  const bytes = baileys.encodeNewsletterMessage(patched)
  const stanzaAttrs = { ...(options.additionalAttributes || extra.additionalAttributes || {}) }
  const plaintextAttrs = { ...(options.plaintextAttributes || {}) }
  const mediaType = getMediaType(patched)
  if (mediaType) plaintextAttrs.mediatype = mediaType
  const additionalNodes = options.additionalNodes || extra.additionalNodes || []
  const content = []
  if (Array.isArray(additionalNodes)) content.push(...additionalNodes)
  content.push({ tag: 'plaintext', attrs: plaintextAttrs, content: bytes })
  await sock.sendNode({
    tag: 'message',
    attrs: { to: jid, id: fullMsg.key?.id, type: getNewsletterMessageType(patched), ...stanzaAttrs },
    content
  })
  return true
}

async function relayHelper(sock, jid, content, quoted, extra = {}, options = {}) {
  if (!sock || typeof sock.relayMessage !== 'function') throw wbError('INVALID_SOCKET')
  if (typeof jid !== 'string' || !jid.includes('@')) throw wbError('INVALID_JID')
  const prepared = options.raw ? content : mergeContextInfo(content, options.contextInfo)
  const fullMsg = await buildWAMessage(sock, jid, prepared, quoted, {
    ...options,
    messageIdPrefix: sock.__wbOptions?.messageIdPrefix
  })
  if (!fullMsg?.message) throw wbError('BAILEYS_API', 'WAMessage tidak memiliki field message.')
  const newsletterMode = isNewsletterJid(jid) && options.useNewsletterStanza !== false
  if (newsletterMode && await relayNewsletterMessage(sock, jid, fullMsg, extra, options)) return fullMsg
  const patched = await patchMessage(sock, fullMsg.message, options, [jid])
  await sock.relayMessage(jid, patched, {
    messageId: fullMsg.key?.id,
    ...(options.additionalAttributes ? { additionalAttributes: options.additionalAttributes } : {}),
    ...(options.additionalNodes ? { additionalNodes: options.additionalNodes } : {}),
    ...extra
  })
  return fullMsg
}

module.exports = { getBaileys, mergeContextInfo, buildWAMessage, relayHelper, relayNewsletterMessage, getMediaType, getNewsletterMessageType, patchMessage, isNewsletterJid }
