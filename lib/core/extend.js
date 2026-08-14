'use strict'

const { relayHelper } = require('../listener/relay')
const { getBufferFromUrl, detectMime, getFileName } = require('../utils/media')
const { getUrlInfo, isUrl } = { ...require('../utils/link-preview'), ...require('../utils/functions') }
const { wbError } = require('../constant/errors')
const { getGlobalConfig } = require('../constant/configure')

function normalizeQuotedAndOptions(quoted, options) {
  return { quoted: quoted && typeof quoted === 'object' ? quoted : undefined, options: options || {} }
}

function withMentions(options = {}, text = '') {
  const contextInfo = { ...(options.contextInfo || {}) }
  if (Array.isArray(options.mentions)) contextInfo.mentionedJid = options.mentions
  if (options.mentionAll && Array.isArray(options.mentionAll)) contextInfo.mentionedJid = options.mentionAll
  return Object.keys(contextInfo).length ? { contextInfo } : {}
}

function isNewsletterJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@newsletter')
}

async function decodeAudioMetadata(buffer) {
  try {
    const module = await import('audio-decode')
    const decode = module.default || module
    const decoded = await decode(buffer)
    return { seconds: decoded.length / decoded.sampleRate, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels }
  } catch {
    return undefined
  }
}

function makeInteractiveContent(buttons = [], options = {}) {
  const nativeButtons = []
  const legacyButtons = []
  for (const button of buttons || []) {
    const type = button.type || button.kind || 'quick_reply'
    if (type === 'url' || type === 'cta_url') {
      nativeButtons.push({ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: button.text || button.displayText || button.title || 'Open', url: button.url || button.link || '' }) })
    } else if (type === 'call' || type === 'cta_call') {
      nativeButtons.push({ name: 'cta_call', buttonParamsJson: JSON.stringify({ display_text: button.text || button.displayText || button.title || 'Call', phone_number: button.phone || button.phoneNumber || '' }) })
    } else if (type === 'copy' || type === 'cta_copy') {
      nativeButtons.push({ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: button.text || button.displayText || button.title || 'Copy', copy_code: button.code || button.copyCode || '' }) })
    } else if (type === 'list' || type === 'single_select') {
      nativeButtons.push({ name: 'single_select', buttonParamsJson: JSON.stringify({ title: button.title || button.text || 'Select', sections: button.sections || [] }) })
    } else {
      const id = button.id || button.buttonId || button.value || button.text || ''
      nativeButtons.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: button.text || button.displayText || button.title || id, id }) })
      legacyButtons.push({ buttonId: id, buttonText: { displayText: button.text || button.displayText || button.title || id }, type: 1 })
    }
  }
  const body = options.body || options.text || options.caption || ''
  const footer = options.footer || ''
  const header = options.header || (options.title ? { title: options.title, hasMediaAttachment: false } : undefined)
  const nativeFlowMessage = {
    buttons: nativeButtons,
    messageVersion: 1
  }
  if (options.messageParamsJson) nativeFlowMessage.messageParamsJson = options.messageParamsJson
  const interactiveMessage = {
    body: { text: body },
    footer: { text: footer },
    nativeFlowMessage
  }
  if (header) interactiveMessage.header = header
  return { interactiveMessage, legacyButtons }
}

function attachMethod(sock, name, fn) {
  Object.defineProperty(sock, name, { configurable: true, enumerable: false, writable: true, value: fn })
}

async function Extend(sock, options = {}) {
  if (!sock || typeof sock.relayMessage !== 'function') throw wbError('INVALID_SOCKET')
  const merged = { updateProtoOnStartup: true, autoFollowNewsletter: false, newsletterAnnotation: false, ...options }
  sock.__wbOptions = merged
  if (options.baileys) sock.__wbBaileys = options.baileys
  const send = (jid, content, quoted, extra = {}, sendOptions = {}) => relayHelper(sock, jid, content, quoted, {
    ...extra,
    ...(sendOptions.additionalAttributes ? { additionalAttributes: sendOptions.additionalAttributes } : {}),
    ...(sendOptions.additionalNodes ? { additionalNodes: sendOptions.additionalNodes } : {})
  }, { ...sendOptions, patchMessageBeforeSending: sendOptions.patchMessageBeforeSending || merged.patchMessageBeforeSending })

  attachMethod(sock, 'sendText', async (jid, text, quoted, opts = {}) => {
    const { quoted: q, options: o } = normalizeQuotedAndOptions(quoted, opts)
    const linkPreview = o.linkPreview === false ? undefined : await getUrlInfo(text, { timeout: getGlobalConfig().REQUEST_TIMEOUT, uploadImage: o.uploadImage })
    const content = { text: String(text), ...(linkPreview ? { linkPreview } : {}) }
    return send(jid, content, q, o.additionalNodes ? { additionalNodes: o.additionalNodes } : {}, { ...o, ...withMentions(o, text) })
  })

  attachMethod(sock, 'sendAdText', async (jid, text, quoted, opts = {}) => {
    const { quoted: q, options: o } = normalizeQuotedAndOptions(quoted, opts)
    const preview = {}
    if (o.thumbnailUrl) preview.jpegThumbnail = await getBufferFromUrl(o.thumbnailUrl)
    if (o.thumbnail) preview.jpegThumbnail = Buffer.isBuffer(o.thumbnail) ? o.thumbnail : await getBufferFromUrl(o.thumbnail)
    const content = { text: String(text), contextInfo: { externalAdReply: {
      title: o.title || '', body: o.description || '', mediaUrl: o.url || o.canonicalUrl, sourceUrl: o.url || o.canonicalUrl,
      mediaType: o.previewType || 1, thumbnail: preview.jpegThumbnail, showAdAttribution: Boolean(o.showAdAttribution), renderLargerThumbnail: Boolean(o.largeThumbnail)
    } } }
    return send(jid, content, q, {}, { ...o, ...withMentions(o, text) })
  })

  attachMethod(sock, 'sendReact', async (jid, emoji, key) => send(jid, { react: { text: String(emoji), key } }, undefined, {}, {}))

  attachMethod(sock, 'sendMedia', async (jid, input, caption = '', quoted, opts = {}) => {
    const { quoted: q, options: o } = normalizeQuotedAndOptions(quoted, opts)
    const buffer = await getBufferFromUrl(input)
    const mimeType = o.mime || detectMime(buffer, typeof input === 'string' ? input : '')
    const isImage = mimeType.startsWith('image/') && !o.document
    const isVideo = mimeType.startsWith('video/') || Boolean(o.ptv)
    const isAudio = mimeType.startsWith('audio/') || Boolean(o.ptt)
    const filename = o.fileName || getFileName(input, `file.${mimeType.split('/')[1] || 'bin'}`)
    let content
    if (o.sticker || mimeType === 'image/webp') content = { sticker: buffer }
    else if (isImage) content = { image: buffer, caption: caption || undefined, mimetype: mimeType }
    else if (isVideo) content = { video: buffer, caption: caption || undefined, mimetype: mimeType, ptv: Boolean(o.ptv), gifPlayback: Boolean(o.gif) }
    else if (isAudio) {
      content = { audio: buffer, mimetype: o.mime || mimeType, ptt: Boolean(o.ptt) }
      if (o.ptt) {
        const meta = await decodeAudioMetadata(buffer)
        if (meta) content.audioDuration = Math.round(meta.seconds)
      }
    } else content = { document: buffer, mimetype: mimeType, fileName: filename, caption: caption || undefined }
    const contextInfo = { ...(o.contextInfo || {}) }
    const annotation = o.newsletterAnnotation === undefined ? merged.newsletterAnnotation : o.newsletterAnnotation
    if (annotation && (isImage || isVideo)) contextInfo.forwardedNewsletterMessageInfo = annotation
    if (o.mentions || o.mentionAll) Object.assign(contextInfo, withMentions(o).contextInfo)
    if (Object.keys(contextInfo).length) content.contextInfo = contextInfo
    return send(jid, content, q, o.additionalNodes ? { additionalNodes: o.additionalNodes } : {}, o)
  })

  attachMethod(sock, 'sendPtv', async (jid, input, quoted, opts = {}) => sock.sendMedia(jid, input, '', quoted, { ...opts, ptv: true, mime: opts.mime || 'video/mp4' }))

  attachMethod(sock, 'sendSticker', async (jid, input, quoted, opts = {}) => sock.sendMedia(jid, input, '', quoted, { ...opts, sticker: true, mime: opts.mime || 'image/webp' }))

  attachMethod(sock, 'sendStickerPack', async (jid, inputs, quoted, opts = {}) => {
    const stickers = []
    for (const input of inputs || []) stickers.push(await getBufferFromUrl(input))
    return send(jid, { stickers, cover: opts.cover ? await getBufferFromUrl(opts.cover) : undefined, name: opts.name, publisher: opts.publisher, description: opts.description, caption: opts.caption }, quoted, {}, opts)
  })

  attachMethod(sock, 'sendContact', async (jid, contacts, quoted) => send(jid, { contacts: { displayName: contacts?.[0]?.displayName || 'Contacts', contacts } }, quoted, {}, {}))
  attachMethod(sock, 'sendLocation', async (jid, location, quoted) => send(jid, { location }, quoted, {}, {}))

  attachMethod(sock, 'sendAlbum', async (jid, items, quoted) => {
    const sent = []
    for (const item of items || []) sent.push(await sock.sendMedia(jid, item.buffer || item.url || item, item.caption || '', quoted, item.options || {}))
    return sent
  })

  attachMethod(sock, 'sendPoll', async (jid, values, quoted, opts = {}) => send(jid, { poll: { name: opts.name || '', values, selectableCount: opts.selectableCount || 1, toAnnouncementGroup: Boolean(opts.toAnnouncementGroup), pollContentType: opts.pollContentType } }, quoted, {}, opts))

  attachMethod(sock, 'sendQuiz', async (jid, values, quoted, opts = {}) => {
    if (!isNewsletterJid(jid)) throw wbError('NEWSLETTER_ONLY')
    if (opts.correctAnswer === undefined || opts.correctAnswer === null) throw wbError('QUIZ_ANSWER_REQUIRED')
    return send(jid, { poll: { name: opts.name || '', values, selectableCount: 1, correctAnswer: opts.correctAnswer } }, quoted, {}, opts)
  })

  attachMethod(sock, 'sendPollResult', async (jid, name, votes, quoted) => send(jid, { pollResult: { name, votes } }, quoted, {}, {}))
  attachMethod(sock, 'sendQuizResult', async (jid, name, votes, quoted) => send(jid, { pollResult: { name, votes } }, quoted, {}, {}))

  attachMethod(sock, 'sendInteractive', async (jid, buttons, quoted, opts = {}) => {
    const { quoted: q, options: o } = normalizeQuotedAndOptions(quoted, opts)
    const built = makeInteractiveContent(buttons, o)
    let content
    if (o.media) {
      const media = await getBufferFromUrl(o.media)
      const mimeType = o.mime || detectMime(media, typeof o.media === 'string' ? o.media : '')
      built.interactiveMessage.header = { ...(built.interactiveMessage.header || {}), hasMediaAttachment: true, imageMessage: mimeType.startsWith('image/') ? { url: o.media } : undefined, videoMessage: mimeType.startsWith('video/') ? { url: o.media } : undefined }
      content = { interactiveMessage: built.interactiveMessage }
    } else content = { interactiveMessage: built.interactiveMessage }
    if (o.interactiveButtons) content.interactiveMessage.nativeFlowMessage.buttons = o.interactiveButtons
    if (o.nativeFlowMessage) content.interactiveMessage.nativeFlowMessage = { ...content.interactiveMessage.nativeFlowMessage, ...o.nativeFlowMessage }
    if (o.sections) content.interactiveMessage.nativeFlowMessage.buttons.push({ name: 'single_select', buttonParamsJson: JSON.stringify({ title: o.optionTitle || 'Options', sections: o.sections }) })
    const contextInfo = { ...(o.contextInfo || {}) }
    if (o.mentions || o.mentionAll) Object.assign(contextInfo, withMentions(o).contextInfo)
    return send(jid, content, q, {}, { ...o, contextInfo })
  })

  attachMethod(sock, 'sendCarousel', async (jid, cards, quoted, opts = {}) => {
    const content = {
      interactiveMessage: {
        body: { text: opts.body || opts.text || opts.caption || '' },
        footer: { text: opts.footer || '' },
        carouselMessage: { cards: Array.isArray(cards) ? cards : [] }
      }
    }
    if (opts.header) content.interactiveMessage.header = opts.header
    return send(jid, content, quoted, {}, opts)
  })

  attachMethod(sock, 'sendLegacyButton', async (jid, buttons, quoted, opts = {}) => send(jid, { text: opts.text || opts.caption || '', footer: opts.footer || '', buttons, headerType: opts.headerType || 1 }, quoted, {}, opts))
  attachMethod(sock, 'sendLegacyList', async (jid, sections, quoted, opts = {}) => {
    if (String(jid).endsWith('@g.us')) throw wbError('PRIVATE_ONLY')
    return send(jid, { text: opts.text || '', footer: opts.footer || '', title: opts.title || '', buttonText: opts.buttonText || 'Select', sections }, quoted, {}, opts)
  })

  attachMethod(sock, 'sendOrderMessage', async (jid, thumbnail, text, quoted) => send(jid, { orderMessage: { orderId: text || '', thumbnail: await getBufferFromUrl(thumbnail), itemCount: 1, status: 1, surface: 1, message: text || '' } }, quoted, {}, {}))
  attachMethod(sock, 'sendCopyMessage', async (jid, quoted, opts = {}) => send(jid, { ...quoted.message }, undefined, {}, { ...opts, raw: true }))
  attachMethod(sock, 'sendStatus', async (jids, content, opts = {}) => send('status@broadcast', { ...content, statusJidList: jids }, undefined, {}, opts))
  attachMethod(sock, 'sendGroupStatus', async (jid, content, opts = {}) => send(jid, { groupStatusMessageV2: content }, undefined, {}, opts))

  attachMethod(sock, 'findUserId', jid => {
    const raw = String(jid || '')
    if (raw.endsWith('@lid')) return { phoneNumber: undefined, lid: raw }
    if (raw.endsWith('@s.whatsapp.net')) return { phoneNumber: raw, lid: undefined }
    return { phoneNumber: undefined, lid: undefined }
  })

  if (merged.autoFollowNewsletter) {
    const follow = typeof sock.newsletterFollow === 'function' ? sock.newsletterFollow.bind(sock) : undefined
    if (follow) {
      for (const jid of (Array.isArray(merged.autoFollowNewsletter) ? merged.autoFollowNewsletter : [merged.autoFollowNewsletter])) await follow(jid)
    }
  }
  return sock
}

module.exports = { Extend, makeInteractiveContent, decodeAudioMetadata, isNewsletterJid }
