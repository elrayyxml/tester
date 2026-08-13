'use strict'

const { relayHelper } = require('../listener/relay')
const { generateMessageId, defaultIsBot } = require('../utils/functions')
const { getBufferFromUrl, detectMime } = require('../utils/media')
const { getUrlInfo } = require('../utils/link-preview')
const { NexrayError, ErrorMessages } = require('../constant/errors')
const { serialize } = require('./serialize')

/**
 * Attach all sendX helpers to an existing Baileys socket.
 * Does NOT install any event listeners.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 * @returns {Promise<import('baileys').WASocket>}
 */
async function Extend(sock, options = {}) {
  if (!sock || typeof sock.relayMessage !== 'function') {
    throw new NexrayError('Extend requires a valid Baileys socket instance', { code: 'INVALID_SOCKET' })
  }

  const opts = {
    bot: options.bot || defaultIsBot,
    stealth: options.stealth,
    messageIdPrefix: options.messageIdPrefix,
    updateProtoOnStartup: options.updateProtoOnStartup !== false,
    autoFollowNewsletter: options.autoFollowNewsletter || false,
    newsletterAnnotation: options.newsletterAnnotation || false,
    logger: options.logger || sock.logger || noopLogger()
  }

  // Store options on socket for serialize / other helpers
  sock._nexray = opts

  // ---------- serialize ----------
  sock.serialize = function (msg) {
    return serialize(sock, msg, opts)
  }

  // ---------- common generation options ----------
  function genOpts(extra = {}) {
    return {
      messageIdPrefix: opts.messageIdPrefix,
      logger: opts.logger,
      newsletterAnnotation: opts.newsletterAnnotation,
      ...extra
    }
  }

  // ---------- sendText ----------
  sock.sendText = async function (jid, text, quoted, options = {}) {
    const content = { text }

    // mentions[] or mentionAll
    if (Array.isArray(options.mentions) && options.mentions.length) {
      content.mentions = options.mentions
    }
    if (options.mentionAll) {
      // Baileys / WA uses contextInfo.nonJidMentions = 1 for @everyone-style
      content.contextInfo = {
        ...(content.contextInfo || {}),
        nonJidMentions: 1,
        ...(options.mentions ? { mentionedJid: options.mentions } : {})
      }
      // also keep mentions array if provided so generateWAMessage can merge
      if (options.mentions) content.mentions = options.mentions
    }

    // auto link preview unless disabled
    if (options.linkPreview !== false && !options.disablePreview) {
      const preview = await getUrlInfo(text, { uploadImage: true })
      if (preview) {
        content.linkPreview = preview
      }
    }

    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- sendAdText (manual link preview) ----------
  sock.sendAdText = async function (jid, text, quoted, options = {}) {
    const content = {
      text,
      linkPreview: {
        'matched-text': options.matchedText || text,
        title: options.title || '',
        description: options.description || '',
        previewType: options.previewType ?? 0,
        jpegThumbnail: options.thumbnail,
        thumbnailUrl: options.thumbnailUrl,
        highQualityThumbnail: options.highQualityThumbnail,
        favicon: options.favicon,
        largeThumbnail: options.largeThumbnail,
        width: options.width,
        height: options.height
      }
    }
    if (options.mentions) content.mentions = options.mentions
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- sendReact ----------
  sock.sendReact = async function (jid, emoji, key) {
    const content = {
      react: {
        text: emoji,
        key
      }
    }
    return relayHelper(sock, jid, content, null, genOpts())
  }

  // ---------- sendMedia ----------
  sock.sendMedia = async function (jid, bufferOrUrl, caption, quoted, options = {}) {
    const buffer = await getBufferFromUrl(bufferOrUrl)
    const mime = options.mimetype || options.mime || (await detectMime(buffer))

    let content
    if (options.document || mime.startsWith('application/')) {
      content = {
        document: buffer,
        mimetype: mime,
        fileName: options.fileName || 'file',
        caption: caption || options.caption
      }
    } else if (mime.startsWith('image/')) {
      content = {
        image: buffer,
        caption: caption || options.caption,
        mimetype: mime
      }
    } else if (mime.startsWith('video/')) {
      content = {
        video: buffer,
        caption: caption || options.caption,
        mimetype: mime,
        gifPlayback: !!options.gif
      }
    } else if (mime.startsWith('audio/')) {
      content = {
        audio: buffer,
        mimetype: mime,
        ptt: !!options.ptt
      }
    } else {
      content = {
        document: buffer,
        mimetype: mime,
        fileName: options.fileName || 'file',
        caption: caption || options.caption
      }
    }

    if (options.viewOnce) content.viewOnce = true
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- sendPtv ----------
  sock.sendPtv = async function (jid, bufferOrUrl, quoted, options = {}) {
    const buffer = await getBufferFromUrl(bufferOrUrl)
    const content = {
      video: buffer,
      ptv: true,
      ...options
    }
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- sendSticker ----------
  sock.sendSticker = async function (jid, bufferOrUrl, quoted, options = {}) {
    const buffer = await getBufferFromUrl(bufferOrUrl)
    const content = {
      sticker: buffer,
      ...options
    }
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- sendStickerPack ----------
  sock.sendStickerPack = async function (jid, buffersOrUrls, quoted, options = {}) {
    const stickers = []
    for (const item of buffersOrUrls) {
      const buf = await getBufferFromUrl(item)
      stickers.push(buf)
    }
    const content = {
      stickers,
      cover: options.cover ? await getBufferFromUrl(options.cover) : undefined,
      caption: options.caption,
      name: options.name,
      publisher: options.publisher,
      description: options.description
    }
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- sendContact ----------
  sock.sendContact = async function (jid, contacts, quoted) {
    const content = {
      contacts: {
        displayName: contacts.length === 1 ? contacts[0].fullName || contacts[0].displayName : `${contacts.length} contacts`,
        contacts: contacts.map(c => ({
          vcard: c.vcard || buildVCard(c)
        }))
      }
    }
    return relayHelper(sock, jid, content, quoted, genOpts())
  }

  // ---------- sendLocation ----------
  sock.sendLocation = async function (jid, loc, quoted) {
    const content = {
      location: {
        degreesLatitude: loc.latitude,
        degreesLongitude: loc.longitude,
        name: loc.name,
        address: loc.address
      }
    }
    return relayHelper(sock, jid, content, quoted, genOpts())
  }

  // ---------- sendAlbum ----------
  // Album = albumMessage header + sequential child media with messageAssociation
  sock.sendAlbum = async function (jid, items, quoted, options = {}) {
    if (!Array.isArray(items) || items.length < 2) {
      throw new NexrayError('Album requires at least 2 media items', { code: 'INVALID_ALBUM' })
    }

    let imageCount = 0
    let videoCount = 0
    const prepared = []

    for (const item of items) {
      const buffer = await getBufferFromUrl(item.buffer || item.url || item)
      const mime = item.mimetype || item.mime || (await detectMime(buffer))
      if (mime.startsWith('video/')) videoCount++
      else imageCount++
      prepared.push({ buffer, mime, caption: item.caption })
    }

    // 1) Send album header
    const albumHeader = await relayHelper(
      sock,
      jid,
      {
        raw: true,
        albumMessage: {
          expectedImageCount: imageCount,
          expectedVideoCount: videoCount
        }
      },
      quoted,
      genOpts(options)
    )

    // 2) Send each media as child with association to the album
    const results = [albumHeader]
    for (let i = 0; i < prepared.length; i++) {
      const { buffer, mime, caption } = prepared[i]
      let mediaContent
      if (mime.startsWith('video/')) {
        mediaContent = { video: buffer, caption, mimetype: mime }
      } else {
        mediaContent = { image: buffer, caption, mimetype: mime }
      }

      const child = await relayHelper(sock, jid, mediaContent, null, {
        ...genOpts(options),
        generationOptions: {
          // association pointing to the album parent
          messageContextInfo: {
            messageAssociation: {
              associationType: 1, // MEDIA_ALBUM
              parentMessageKey: albumHeader.key
            }
          }
        }
      })
      results.push(child)
    }
    return results
  }

  // ---------- Poll ----------
  sock.sendPoll = async function (jid, values, quoted, options = {}) {
    const content = {
      poll: {
        name: options.name || 'Poll',
        values,
        selectableCount: options.selectableCount ?? 1,
        toAnnouncementGroup: options.toAnnouncementGroup,
        messageSecret: options.messageSecret
      }
    }
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  sock.sendQuiz = async function (newsletterJid, values, quoted, options = {}) {
    if (!newsletterJid || !newsletterJid.endsWith('@newsletter')) {
      throw new NexrayError(ErrorMessages.INVALID_NEWSLETTER_JID, { code: 'INVALID_NEWSLETTER_JID' })
    }
    if (options.correctAnswer === undefined) {
      throw new NexrayError(ErrorMessages.QUIZ_MISSING_CORRECT, { code: 'QUIZ_MISSING_CORRECT' })
    }
    const content = {
      poll: {
        name: options.name || 'Quiz',
        values,
        selectableCount: 1,
        correctAnswer: options.correctAnswer
      }
    }
    return relayHelper(sock, newsletterJid, content, quoted, genOpts(options))
  }

  sock.sendPollResult = async function (jid, name, votes, quoted) {
    const content = {
      pollResult: {
        name,
        votes
      }
    }
    return relayHelper(sock, jid, content, quoted, genOpts())
  }

  sock.sendQuizResult = async function (jid, name, votes, quoted) {
    return sock.sendPollResult(jid, name, votes, quoted)
  }

  // ---------- Interactive (nativeFlowMessage + interactiveButtons) ----------
  // Builds { interactiveMessage: { nativeFlowMessage: { buttons, messageParamsJson }, body, header, footer } }
  // so it works both on official Baileys (via raw) and forks that understand interactiveButtons.
  sock.sendInteractive = async function (jid, buttons, quoted, options = {}) {
    const buttonsField = Array.isArray(buttons) ? buttons : (buttons?.buttons || [])
    let paramsJson = options.messageParamsJson || options.paramsJson || ''
    if (typeof paramsJson === 'object' && paramsJson !== null) {
      paramsJson = JSON.stringify(paramsJson)
    }

    // Prefer high-level keys that generateWAMessageContent understands on forks;
    // also provide a raw interactiveMessage fallback path.
    const content = {
      interactiveButtons: buttonsField,
      messageParamsJson: paramsJson,
      caption: options.caption || options.text,
      title: options.title,
      subtitle: options.subtitle,
      footer: options.footer,
      thumbnail: options.thumbnail
    }

    // Optional media header (image / video / document)
    if (options.media) {
      Object.assign(content, options.media)
    } else if (options.image) {
      content.image = options.image
    } else if (options.video) {
      content.video = options.video
    }

    // mention support
    if (options.mentions) content.mentions = options.mentions
    if (options.mentionAll) {
      content.contextInfo = {
        ...(content.contextInfo || {}),
        nonJidMentions: 1
      }
    }

    // If official Baileys does not understand interactiveButtons, fall back to raw
    // interactiveMessage structure (still works with relayMessage).
    try {
      return await relayHelper(sock, jid, content, quoted, genOpts(options))
    } catch (err) {
      // Build raw interactiveMessage manually
      const interactiveMessage = {
        nativeFlowMessage: {
          buttons: buttonsField,
          messageParamsJson: paramsJson
        }
      }
      if (options.caption || options.text) {
        interactiveMessage.body = { text: options.caption || options.text }
      }
      if (options.title || options.subtitle || options.media || options.image || options.video) {
        interactiveMessage.header = {
          title: options.title || '',
          subtitle: options.subtitle || '',
          hasMediaAttachment: !!(options.media || options.image || options.video)
        }
      }
      if (options.footer) {
        interactiveMessage.footer = { text: options.footer }
      }
      if (options.thumbnail) {
        interactiveMessage.jpegThumbnail = options.thumbnail
      }

      return relayHelper(
        sock,
        jid,
        { raw: true, interactiveMessage },
        quoted,
        genOpts(options)
      )
    }
  }

  // Convenience alias – cards → carousel-style interactiveMessage
  sock.sendCarousel = async function (jid, cards, quoted, options = {}) {
    return sock.sendInteractive(jid, [], quoted, {
      ...options,
      cards
    })
  }

  // ---------- Legacy ----------
  sock.sendLegacyButton = async function (jid, buttons, quoted, options = {}) {
    const content = {
      buttons,
      ...options
    }
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  sock.sendLegacyList = async function (jid, sections, quoted, options = {}) {
    if (jid.endsWith('@g.us')) {
      throw new NexrayError(ErrorMessages.LEGACY_LIST_IN_GROUP, { code: 'LEGACY_LIST_IN_GROUP' })
    }
    const content = {
      sections,
      ...options
    }
    return relayHelper(sock, jid, content, quoted, genOpts(options))
  }

  // ---------- Other ----------
  sock.sendOrderMessage = async function (jid, thumbnail, text, quoted) {
    const content = {
      order: {
        thumbnail,
        orderId: generateMessageId(),
        status: 1,
        surface: 1,
        message: text,
        itemCount: 1
      }
    }
    return relayHelper(sock, jid, content, quoted, genOpts())
  }

  sock.sendCopyMessage = async function (jid, quoted, options = {}) {
    // Simple forward
    const content = {
      forward: quoted
    }
    return relayHelper(sock, jid, content, null, genOpts(options))
  }

  sock.sendStatus = async function (jids, content, options = {}) {
    // status@broadcast
    const results = []
    for (const jid of Array.isArray(jids) ? jids : [jids]) {
      const r = await relayHelper(sock, 'status@broadcast', content, null, {
        ...genOpts(options),
        statusJidList: [jid]
      })
      results.push(r)
    }
    return results
  }

  sock.sendGroupStatus = async function (jid, content, options = {}) {
    return relayHelper(sock, jid, content, null, genOpts(options))
  }

  // ---------- findUserId (best-effort from local store) ----------
  sock.findUserId = function (jid) {
    const store = sock.store || sock.signalRepository?.lidMapping
    let phoneNumber, lid
    if (jid.endsWith('@s.whatsapp.net')) {
      phoneNumber = jid
      // try store
      if (store?.getLIDForPN) {
        try { lid = store.getLIDForPN(jid) } catch {}
      }
    } else if (jid.endsWith('@lid')) {
      lid = jid
      if (store?.getPNForLID) {
        try { phoneNumber = store.getPNForLID(jid) } catch {}
      }
    }
    return { phoneNumber, lid }
  }

  // ---------- Newsletter helpers (only if socket already has them) ----------
  if (typeof sock.newsletterFollow !== 'function') {
    sock.newsletterFollow = async function (jid) {
      if (sock.query) {
        // fallback generic – most modern baileys already expose it
        return sock.query({
          tag: 'iq',
          attrs: { to: jid, type: 'set', xmlns: 'newsletter' },
          content: [{ tag: 'follow', attrs: {} }]
        })
      }
      throw new NexrayError('newsletterFollow is not available on this socket', { code: 'NOT_SUPPORTED' })
    }
  }
  if (typeof sock.newsletterUnfollow !== 'function') {
    sock.newsletterUnfollow = async function (jid) {
      if (sock.query) {
        return sock.query({
          tag: 'iq',
          attrs: { to: jid, type: 'set', xmlns: 'newsletter' },
          content: [{ tag: 'unfollow', attrs: {} }]
        })
      }
      throw new NexrayError('newsletterUnfollow is not available on this socket', { code: 'NOT_SUPPORTED' })
    }
  }

  // Auto-follow only when explicitly configured
  if (opts.autoFollowNewsletter) {
    const list = Array.isArray(opts.autoFollowNewsletter)
      ? opts.autoFollowNewsletter
      : [opts.autoFollowNewsletter]
    for (const njid of list) {
      if (njid && typeof njid === 'string' && njid.endsWith('@newsletter')) {
        try {
          await sock.newsletterFollow(njid)
        } catch (e) {
          opts.logger?.warn?.({ err: e }, 'autoFollowNewsletter failed')
        }
      }
    }
  }

  return sock
}

function buildVCard(c) {
  const name = c.fullName || c.displayName || c.name || 'Contact'
  const phone = c.phoneNumber || c.number || ''
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${phone.replace(/\D/g, '')}:+${phone.replace(/\D/g, '')}\nEND:VCARD`
}

function noopLogger() {
  const n = () => {}
  return { child: () => ({ info: n, error: n, warn: n, debug: n, trace: n }), info: n, error: n, warn: n, debug: n, trace: n }
}

module.exports = {
  Extend
}
