'use strict'

const { relayHelper, relayRaw, prepareMedia, statusMentionNodes, interactiveBizNodes } = require('../listener/relay')
const { generateMessageId, defaultIsBot } = require('../utils/functions')
const { getBufferFromUrl, detectMime, getWaveform } = require('../utils/media')
const { getUrlInfo } = require('../utils/link-preview')
const {
  buildTextContent,
  buildButtonsContent,
  buildListContent,
  buildInteractiveContent,
  buildAlbumHeader,
  buildPollContent,
  buildPollResultContent,
  buildReactContent,
  buildLocationContent,
  buildContactsContent,
  buildProductMessage,
  createMessage
} = require('../utils/content-builder')
const { updateProtoOnStartup } = require('../utils/proto-update')
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

  sock._nexray = opts

  // Simple media cache (Map) for prepareWAMessageMedia hits
  if (!sock._nexrayMediaCache) {
    const cache = new Map()
    sock._nexrayMediaCache = {
      get: async (k) => cache.get(k),
      set: async (k, v) => { cache.set(k, v); if (cache.size > 200) { const first = cache.keys().next().value; cache.delete(first) } }
    }
  }

  // Optional proto refresh (non-fatal)
  if (opts.updateProtoOnStartup) {
    try {
      await updateProtoOnStartup(opts.logger)
    } catch (e) {
      opts.logger?.warn?.({ err: e }, 'proto update skipped')
    }
  }

  sock.serialize = function (msg) {
    return serialize(sock, msg, opts)
  }

  function genOpts(extra = {}) {
    return {
      messageIdPrefix: opts.messageIdPrefix,
      logger: opts.logger,
      newsletterAnnotation: opts.newsletterAnnotation,
      ...extra
    }
  }

  // ===================== TEXT =====================
  sock.sendText = async function (jid, text, quoted, options = {}) {
    if (quoted && typeof quoted === 'object' && !quoted.key && arguments.length === 3) {
      options = quoted
      quoted = options.quoted
    }
    quoted = quoted || options.quoted
    const content = buildTextContent({
      text,
      mentions: options.mentions,
      mentionAll: options.mentionAll,
      contextInfo: options.contextInfo
    })

    // link preview via high-level path when possible
    if (options.linkPreview !== false && !options.disablePreview) {
      try {
        const preview = await getUrlInfo(text, { uploadImage: true })
        if (preview) {
          return relayHelper(
            sock,
            jid,
            {
              text,
              linkPreview: preview,
              mentions: options.mentions,
              contextInfo: {
                ...(options.contextInfo || {}),
                ...(options.mentionAll ? { nonJidMentions: 1 } : {}),
                ...(options.mentions ? { mentionedJid: options.mentions } : {})
              }
            },
            quoted || options.quoted,
            genOpts(options)
          )
        }
      } catch {}
    }

    return relayRaw(sock, jid, content, { ...genOpts(options), quoted: quoted || options.quoted })
  }

  sock.sendAdText = async function (jid, text, quoted, options = {}) {
    return relayHelper(
      sock,
      jid,
      {
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
        },
        mentions: options.mentions
      },
      quoted,
      genOpts(options)
    )
  }

  // ===================== REACT =====================
  sock.sendReact = async function (jid, emoji, key) {
    return relayRaw(sock, jid, buildReactContent({ emoji, key }), genOpts())
  }

  // ===================== MEDIA =====================
  sock.sendMedia = async function (jid, bufferOrUrl, caption, quoted, options = {}) {
    const buffer = await getBufferFromUrl(bufferOrUrl)
    const mime = options.mimetype || options.mime || (await detectMime(buffer))

    let mediaInput
    if (options.document || (!mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/'))) {
      mediaInput = {
        document: buffer,
        mimetype: mime,
        fileName: options.fileName || 'file',
        caption: caption || options.caption
      }
    } else if (mime.startsWith('image/')) {
      mediaInput = { image: buffer, caption: caption || options.caption, mimetype: mime }
    } else if (mime.startsWith('video/')) {
      mediaInput = {
        video: buffer,
        caption: caption || options.caption,
        mimetype: mime,
        gifPlayback: !!options.gif
      }
    } else {
      const ptt = !!(options.ptt)
      mediaInput = {
        audio: buffer,
        mimetype: options.mimetype || mime || (ptt ? 'audio/ogg; codecs=opus' : mime),
        ptt: ptt
      }
      if (ptt) {
        try {
          const wf = options.waveform || (await getWaveform(buffer, opts.logger))
          if (wf) mediaInput.waveform = wf
        } catch (e) {}
      }
      if (options.seconds) mediaInput.seconds = options.seconds
    }
    if (options.viewOnce) mediaInput.viewOnce = true

    // flexible quoted
    if (quoted && typeof quoted === 'object' && !quoted.key && !options.quoted) {
      // quoted was options
    }
    return relayHelper(sock, jid, mediaInput, quoted || options.quoted, genOpts(options))
  }

  sock.sendPtv = async function (jid, bufferOrUrl, quoted, options = {}) {
    const buffer = await getBufferFromUrl(bufferOrUrl)
    return relayHelper(sock, jid, { video: buffer, ptv: true }, quoted, genOpts(options))
  }

  sock.sendSticker = async function (jid, bufferOrUrl, quoted, options = {}) {
    const buffer = await getBufferFromUrl(bufferOrUrl)
    return relayHelper(sock, jid, { sticker: buffer, ...options }, quoted, genOpts(options))
  }

  sock.sendStickerPack = async function (jid, buffersOrUrls, quoted, options = {}) {
    const stickers = []
    for (const item of buffersOrUrls) {
      stickers.push(await getBufferFromUrl(item))
    }
    return relayHelper(
      sock,
      jid,
      {
        stickers,
        cover: options.cover ? await getBufferFromUrl(options.cover) : undefined,
        caption: options.caption,
        name: options.name,
        publisher: options.publisher,
        description: options.description
      },
      quoted,
      genOpts(options)
    )
  }

  // ===================== CONTACT / LOCATION =====================
  sock.sendContact = async function (jid, contacts, quoted, options = {}) {
    // Accept single contact object or array
    const list = Array.isArray(contacts) ? contacts : [contacts]

    const vcards = list.map(c => {
      if (c.vcard) return { displayName: c.fullName || c.displayName || c.name || 'Contact', vcard: c.vcard }
      const name = c.fullName || c.displayName || c.name || 'Contact'
      const number = String(c.phoneNumber || c.number || c.waid || '').replace(/\D/g, '')
      const org = c.org || c.organization || ''
      const title = c.title || ''
      const email = c.email || ''
      const url = c.url || c.website || ''
      const region = c.region || c.address || ''
      const note = c.note || ''
      const bizName = c.bizName || c.businessName || name
      const bizDesc = c.bizDescription || c.businessDescription || ''

      // Business-capable vCard
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${name};;;;`,
        `FN:${name}`,
        org ? `ORG:${org}` : null,
        title ? `TITLE:${title}` : null,
        number ? `TEL;TYPE=WORK;waid=${number}:${number}` : null,
        email ? `EMAIL;type=INTERNET:${email}` : null,
        url ? `URL:${url}` : null,
        region ? `ADR;TYPE=WORK:;;${region};;;` : null,
        note ? `NOTE:${note}` : null,
        `X-WA-BIZ-NAME:${bizName}`,
        bizDesc ? `X-WA-BIZ-DESCRIPTION:${bizDesc}` : null,
        'END:VCARD'
      ].filter(Boolean).join('\n')

      return { displayName: name, vcard }
    })

    const content = buildContactsContent({
      contacts: vcards.map(v => ({ fullName: v.displayName, vcard: v.vcard })),
      mentions: options.mentions,
      mentionAll: options.mentionAll,
      contextInfo: options.contextInfo
    })
    // Override with proper contactsArrayMessage using our vcards
    const msgContent = {
      contactsArrayMessage: {
        displayName: vcards.length === 1 ? vcards[0].displayName : `${vcards.length} contacts`,
        contacts: vcards
      }
    }
    return relayRaw(sock, jid, msgContent, { ...genOpts(options), quoted })
  }


  sock.sendLocation = async function (jid, loc, quoted) {
    return relayRaw(
      sock,
      jid,
      buildLocationContent({
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: loc.name,
        address: loc.address
      }),
      { ...genOpts(), quoted }
    )
  }

  // ===================== ALBUM =====================
  /**
   * sendAlbum(jid, items, quoted?, options?)
   * items: [{ media|image|video|url }, ...]  min 2
   * Follows messages-send.js album loop + handleAlbum header pattern.
   */
  sock.sendAlbum = async function (jid, items, quoted, options) {
    if (quoted && typeof quoted === 'object' && !quoted.key && arguments.length === 3) {
      options = quoted
      quoted = options.quoted
    }
    options = options || {}
    quoted = quoted || options.quoted

    if (!Array.isArray(items) || items.length < 2) {
      throw new NexrayError('Album requires at least 2 media items', { code: 'INVALID_ALBUM' })
    }

    const crypto = require('crypto')
    const baileys = require('baileys')
    const generateWAMessage = baileys.generateWAMessage
    const generateWAMessageFromContent = baileys.generateWAMessageFromContent
    const delayMs = options.delayMs != null ? options.delayMs : 1200

    const array = []
    for (const item of items) {
      const src = (item && (item.image || item.video || item.media || item.buffer || item.url)) || item
      const caption = item && item.caption
      const forceVideo = !!(item && (item.video || item.isVideo))

      let mediaInput
      let isVideo = forceVideo

      if (Buffer.isBuffer(src)) {
        let mime = (item && (item.mimetype || item.mime)) || null
        if (!mime) {
          try { mime = await detectMime(src) } catch (e) { mime = 'image/jpeg' }
        }
        isVideo = forceVideo || (mime && String(mime).startsWith('video/'))
        mediaInput = isVideo
          ? { video: src, caption: caption, mimetype: mime }
          : { image: src, caption: caption, mimetype: mime }
      } else if (typeof src === 'string') {
        const lower = src.toLowerCase()
        isVideo = forceVideo || /\.(mp4|mkv|mov|webm|3gp)(\?|$)/.test(lower)
        mediaInput = isVideo
          ? { video: { url: src }, caption: caption }
          : { image: { url: src }, caption: caption }
      } else if (src && typeof src === 'object' && src.url) {
        const lower = String(src.url).toLowerCase()
        isVideo = forceVideo || /\.(mp4|mkv|mov|webm|3gp)(\?|$)/.test(lower)
        mediaInput = isVideo
          ? { video: { url: src.url }, caption: caption }
          : { image: { url: src.url }, caption: caption }
      } else {
        throw new NexrayError('Invalid album media item', { code: 'INVALID_ALBUM_ITEM' })
      }
      array.push(mediaInput)
    }

    const imageCount = array.filter(a => a.image).length
    const videoCount = array.filter(a => a.video).length

    // Plain object – do NOT run through Message.create (can strip fields on old proto)
    const albumContent = {
      messageContextInfo: {
        messageSecret: crypto.randomBytes(32)
      },
      albumMessage: {
        expectedImageCount: imageCount,
        expectedVideoCount: videoCount
      }
    }

    const quotedNorm = quoted
      ? {
          key: {
            remoteJid: quoted.key && quoted.key.remoteJid,
            fromMe: !!(quoted.key && quoted.key.fromMe),
            id: quoted.key && quoted.key.id,
            participant: quoted.key && quoted.key.participant
          },
          message: quoted.message || { conversation: '' }
        }
      : undefined

    const msg = await generateWAMessageFromContent(jid, albumContent, {
      userJid: sock.user && sock.user.id,
      quoted: quotedNorm,
      upload: sock.waUploadToServer,
      mediaCache: sock._nexrayMediaCache,
      messageId: generateMessageId(sock.user && sock.user.id, opts.messageIdPrefix),
      logger: opts.logger
    })

    // Ensure counts survived
    if (msg.message && msg.message.albumMessage) {
      if (!msg.message.albumMessage.expectedImageCount) {
        msg.message.albumMessage.expectedImageCount = imageCount
      }
      if (!msg.message.albumMessage.expectedVideoCount) {
        msg.message.albumMessage.expectedVideoCount = videoCount
      }
    }

    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })

    const results = [msg]
    const sleep = require('../utils/functions').sleep

    for (const contentItem of array) {
      const mediaMsg = await generateWAMessage(jid, contentItem, {
        upload: sock.waUploadToServer,
        userJid: sock.user && sock.user.id,
        mediaCache: sock._nexrayMediaCache,
        messageId: generateMessageId(sock.user && sock.user.id, opts.messageIdPrefix),
        logger: opts.logger
      })

      if (!mediaMsg.message) continue
      mediaMsg.message.messageContextInfo = mediaMsg.message.messageContextInfo || {}
      mediaMsg.message.messageContextInfo.messageSecret = crypto.randomBytes(32)
      mediaMsg.message.messageContextInfo.messageAssociation = {
        associationType: 1,
        parentMessageKey: msg.key
      }

      await sock.relayMessage(jid, mediaMsg.message, {
        messageId: mediaMsg.key.id
      })
      results.push(mediaMsg)
      if (delayMs > 0) await sleep(delayMs)
    }
    return results
  }





  // ===================== POLL =====================
  sock.sendPoll = async function (jid, values, quoted, options = {}) {
    const content = buildPollContent({
      name: options.name || 'Poll',
      values,
      selectableCount: options.selectableCount ?? 1,
      toAnnouncementGroup: options.toAnnouncementGroup,
      endDate: options.endDate,
      hideVoter: options.hideVoter,
      canAddOption: options.canAddOption,
      messageSecret: options.messageSecret,
      correctAnswer: options.correctAnswer,
      pollType: options.pollType
    })
    return relayRaw(sock, jid, content, { ...genOpts(options), quoted })
  }

  sock.sendQuiz = async function (newsletterJid, values, quoted, options = {}) {
    if (!newsletterJid || !String(newsletterJid).endsWith('@newsletter')) {
      throw new NexrayError(ErrorMessages.INVALID_NEWSLETTER_JID, { code: 'INVALID_NEWSLETTER_JID' })
    }
    if (options.correctAnswer === undefined) {
      throw new NexrayError(ErrorMessages.QUIZ_MISSING_CORRECT, { code: 'QUIZ_MISSING_CORRECT' })
    }
    return sock.sendPoll(newsletterJid, values, quoted, {
      ...options,
      pollType: 1,
      correctAnswer: options.correctAnswer,
      selectableCount: 1
    })
  }

  sock.sendPollResult = async function (jid, name, votes, quoted, options = {}) {
    const content = buildPollResultContent({
      name,
      votes,
      pollType: options.pollType || 0
    })
    return relayRaw(sock, jid, content, { ...genOpts(options), quoted })
  }

  sock.sendQuizResult = async function (jid, name, votes, quoted, options = {}) {
    return sock.sendPollResult(jid, name, votes, quoted, { ...options, pollType: 1 })
  }

  // ===================== INTERACTIVE / NATIVE FLOW =====================
  sock.sendInteractive = async function (jid, buttons, quoted, options = {}) {
    let headerMedia = null
    let locationMessage = null
    let productMessage = null

    // Media header (image / video / document)
    const mediaSrc =
      options.media ||
      (options.image ? { image: options.image } : null) ||
      (options.video ? { video: options.video } : null) ||
      (options.document ? { document: options.document } : null)

    if (mediaSrc && !mediaSrc.location && !mediaSrc.product) {
      try {
        headerMedia = await prepareMedia(sock, mediaSrc, genOpts(options))
      } catch (e) {
        opts.logger?.warn?.({ err: e }, 'interactive header media failed')
      }
    }

    // Location header
    const loc =
      options.location ||
      mediaSrc?.location ||
      options.header?.location ||
      null
    if (loc) {
      locationMessage = {
        degreesLatitude: loc.degreesLatitude ?? loc.latitude ?? 0,
        degreesLongitude: loc.degreesLongitude ?? loc.longitude ?? 0,
        name: loc.name || options.title || '',
        address: loc.address || '',
        jpegThumbnail: loc.jpegThumbnail || loc.thumbnail
      }
    }

    // Product header
    const prod = options.product || mediaSrc?.product || null
    if (prod && (prod.productImage || prod.image || options.productImage)) {
      try {
        const img = prod.productImage || prod.image || options.productImage
        const prepared = await prepareMedia(
          sock,
          { image: img },
          genOpts(options)
        )
        productMessage = buildProductMessage(
          {
            productId: prod.productId || options.productId,
            title: prod.title || options.title,
            description: prod.description,
            currencyCode: prod.currencyCode || options.currencyCode,
            priceAmount1000: prod.priceAmount1000 || options.priceAmount1000,
            productImageCount: prod.productImageCount || options.productImageCount,
            businessOwnerJid: prod.businessOwnerJid || options.businessOwnerJid,
            retailerId: prod.retailerId,
            url: prod.url
          },
          prepared.imageMessage
        )
      } catch (e) {
        opts.logger?.warn?.({ err: e }, 'interactive product header failed')
      }
    }

    const content = buildInteractiveContent({
      buttons,
      interactiveButtons: buttons,
      text: options.text || options.caption,
      caption: options.caption,
      footer: options.footer,
      title: options.title,
      subtitle: options.subtitle,
      thumbnail: options.thumbnail,
      messageParamsJson: options.messageParamsJson || options.paramsJson,
      headerMedia,
      locationMessage,
      productMessage,
      header: options.header,
      mentions: options.mentions,
      mentionAll: options.mentionAll,
      contextInfo: options.contextInfo
    })

    return relayRaw(sock, jid, content, {
      ...genOpts(options),
      quoted,
      nativeFlowName: options.nativeFlowName || 'mixed'
    })
  }

  // Product + optional interactive buttons
  sock.sendProduct = async function (jid, options = {}, quoted) {
    if (!options.businessOwnerJid) {
      throw new NexrayError('businessOwnerJid is required for product message', {
        code: 'MISSING_BUSINESS_OWNER'
      })
    }
    const img = options.productImage || options.image || options.buffer
    if (!img) {
      throw new NexrayError('productImage is required', { code: 'MISSING_PRODUCT_IMAGE' })
    }

    // If interactive buttons present → interactive header with product
    if (options.interactiveButtons?.length || options.buttons?.length) {
      return sock.sendInteractive(
        jid,
        options.interactiveButtons || options.buttons,
        quoted,
        {
          text: options.caption || options.text,
          footer: options.footer,
          title: options.title,
          product: {
            productImage: img,
            productId: options.productId,
            title: options.title,
            description: options.description,
            currencyCode: options.currencyCode,
            priceAmount1000: options.priceAmount1000,
            productImageCount: options.productImageCount,
            businessOwnerJid: options.businessOwnerJid
          },
          businessOwnerJid: options.businessOwnerJid,
          productId: options.productId,
          currencyCode: options.currencyCode,
          priceAmount1000: options.priceAmount1000,
          productImageCount: options.productImageCount,
          mentions: options.mentions,
          mentionAll: options.mentionAll,
          contextInfo: options.contextInfo,
          messageParamsJson: options.messageParamsJson
        }
      )
    }

    // Plain product message
    const prepared = await prepareMedia(sock, { image: img }, genOpts(options))
    const productMessage = buildProductMessage(options, prepared.imageMessage)
    return relayRaw(
      sock,
      jid,
      createMessage({ productMessage }),
      { ...genOpts(options), quoted }
    )
  }

  sock.sendCarousel = async function (jid, cards, quoted, options = {}) {
    // Simplified: send as interactive with cards metadata in params
    return sock.sendInteractive(jid, [], quoted, {
      ...options,
      messageParamsJson: {
        ...(typeof options.messageParamsJson === 'object' ? options.messageParamsJson : {}),
        cards
      }
    })
  }

  // ===================== LEGACY BUTTONS / LIST =====================
  sock.sendLegacyButton = async function (jid, buttons, quoted, options) {
    if (quoted && typeof quoted === 'object' && !quoted.key && arguments.length === 3) {
      options = quoted
      quoted = options.quoted
    }
    options = options || {}
    quoted = quoted || options.quoted

    // Build buttons array
    const btns = (buttons || []).map((button, i) => {
      const buttonText = button.text || button.buttonText || button.displayText
      if (button.nativeFlowInfo || button.name) {
        return {
          buttonId: button.id || button.buttonId || ('btn_' + i),
          buttonText: typeof buttonText === 'string' ? { displayText: buttonText } : buttonText,
          nativeFlowInfo: button.nativeFlowInfo || {
            name: button.name,
            paramsJson: typeof button.paramsJson === 'string' ? button.paramsJson : JSON.stringify(button.paramsJson || {})
          },
          type: button.type || 2
        }
      }
      return {
        buttonId: button.id || button.buttonId || ('btn_' + i),
        buttonText: typeof buttonText === 'string' ? { displayText: buttonText } : (buttonText || { displayText: 'Button' }),
        type: button.type || 1
      }
    })

    const buttonsMessage = {
      buttons: btns,
      contentText: options.text || options.caption || '',
      footerText: options.footer || undefined,
      headerType: 1
    }

    // LOCATION header
    const loc = options.location || (options.media && options.media.location)
    if (loc) {
      buttonsMessage.locationMessage = {
        degreesLatitude: loc.degreesLatitude != null ? loc.degreesLatitude : (loc.latitude || 0),
        degreesLongitude: loc.degreesLongitude != null ? loc.degreesLongitude : (loc.longitude || 0),
        name: loc.name || '',
        address: loc.address || '',
        jpegThumbnail: loc.jpegThumbnail || loc.thumbnail
      }
      buttonsMessage.headerType = 2 // LOCATION
    } else if (options.image || (options.media && options.media.image)) {
      try {
        const prepared = await prepareMedia(sock, { image: options.image || options.media.image }, genOpts(options))
        Object.assign(buttonsMessage, prepared)
        buttonsMessage.headerType = 4 // IMAGE
      } catch (e) {
        opts.logger && opts.logger.warn && opts.logger.warn({ err: e }, 'legacy button image header failed')
      }
    } else if (options.video || (options.media && options.media.video)) {
      try {
        const prepared = await prepareMedia(sock, { video: options.video || options.media.video }, genOpts(options))
        Object.assign(buttonsMessage, prepared)
        buttonsMessage.headerType = 5 // VIDEO
      } catch (e) {}
    }

    // mentions
    if (options.mentions || options.mentionAll) {
      buttonsMessage.contextInfo = buttonsMessage.contextInfo || {}
      if (options.mentions) buttonsMessage.contextInfo.mentionedJid = options.mentions
      if (options.mentionAll) buttonsMessage.contextInfo.nonJidMentions = 1
    }

    return relayRaw(sock, jid, { buttonsMessage }, { ...genOpts(options), quoted })
  }

  sock.sendLegacyList = async function (jid, sections, quoted, options = {}) {
    if (String(jid).endsWith('@g.us')) {
      throw new NexrayError(ErrorMessages.LEGACY_LIST_IN_GROUP, { code: 'LEGACY_LIST_IN_GROUP' })
    }
    const content = buildListContent({
      sections,
      buttonText: options.buttonText,
      title: options.title,
      footer: options.footer,
      text: options.text || options.description
    })
    return relayRaw(sock, jid, content, { ...genOpts(options), quoted })
  }

  // ===================== OTHER =====================
  sock.sendOrderMessage = async function (jid, thumbnail, text, quoted) {
    return relayHelper(
      sock,
      jid,
      {
        order: {
          thumbnail,
          orderId: generateMessageId(),
          status: 1,
          surface: 1,
          message: text,
          itemCount: 1
        }
      },
      quoted,
      genOpts()
    )
  }

  sock.sendCopyMessage = async function (jid, quoted, options = {}) {
    return relayHelper(sock, jid, { forward: quoted }, null, genOpts(options))
  }

  sock.sendStatus = async function (jids, content, options = {}) {
    const list = Array.isArray(jids) ? jids : [jids]
    const results = []
    for (const j of list) {
      results.push(
        await relayHelper(sock, 'status@broadcast', content, null, {
          ...genOpts(options),
          generationOptions: { statusJidList: [j] }
        })
      )
    }
    return results
  }

  sock.sendGroupStatus = async function (jid, content, options = {}) {
    return relayHelper(sock, jid, content, null, genOpts(options))
  }


  // ===================== STATUS MENTION =====================
  // Requires up-to-date WAProto (STATUS_MENTION_MESSAGE / type 25)
  sock.sendStatusMention = async function (jids, content, options = {}) {
    const list = Array.isArray(jids) ? jids : [jids]
    const { generateWAMessage } = require('baileys')
    const STORIES_JID = 'status@broadcast'

    // Expand group JIDs to participants for statusJidList
    let statusJidList = []
    for (const j of list) {
      if (String(j).endsWith('@g.us')) {
        try {
          const meta = await sock.groupMetadata(j)
          statusJidList.push(...(meta.participants || []).map(p => p.id))
        } catch (e) {
          opts.logger?.warn?.({ err: e }, 'status mention groupMetadata failed')
        }
      } else {
        statusJidList.push(j)
      }
    }
    statusJidList = [...new Set(statusJidList)]

    const msg = await generateWAMessage(STORIES_JID, content, {
      upload: sock.waUploadToServer,
      userJid: sock.user?.id,
      messageId: require('../utils/functions').generateMessageId(sock.user?.id, opts.messageIdPrefix),
      logger: opts.logger
    })

    await sock.relayMessage(msg.key.remoteJid, msg.message, {
      messageId: msg.key.id,
      statusJidList,
      additionalNodes: statusMentionNodes(list)
    })

    // Notify each target chat with statusMention / groupStatusMention
    for (const jid of list) {
      const type = String(jid).endsWith('@g.us')
        ? 'groupStatusMentionMessage'
        : 'statusMentionMessage'
      await sock.relayMessage(
        jid,
        {
          [type]: {
            message: {
              protocolMessage: {
                key: msg.key,
                type: 25 // STATUS_MENTION_MESSAGE
              }
            }
          }
        },
        {
          additionalNodes: [
            {
              tag: 'meta',
              attrs: { is_status_mention: 'true' },
              content: undefined
            }
          ]
        }
      )
    }
    return msg
  }

  // ===================== GET USERNAME (USync) =====================
  sock.getUsername = async function (id) {
    try {
      const baileys = require('baileys')
      const USyncQuery = baileys.USyncQuery
      if (!USyncQuery || typeof sock.executeUSyncQuery !== 'function') {
        return { id, username: null }
      }
      const usyncQuery = new USyncQuery()
      usyncQuery.protocols.push({
        name: 'username',
        getQueryElement: () => ({ tag: 'username', attrs: {} }),
        getUserElement: () => null,
        parser: node => {
          if (!node?.content) return null
          if (Buffer.isBuffer(node.content)) return node.content.toString()
          if (node.content?.data) return Buffer.from(node.content.data).toString()
          return node.content
        }
      })
      usyncQuery.users.push({ id })
      const result = await sock.executeUSyncQuery(usyncQuery)
      return {
        id: result?.list?.[0]?.id || id,
        username: result?.list?.[0]?.username || null
      }
    } catch (e) {
      opts.logger?.warn?.({ err: e }, 'getUsername failed')
      return { id, username: null }
    }
  }



  // ===================== NEWSLETTER MEDIA (plaintext query) =====================
  sock.sendNewsletterMedia = async function (newsletterJid, mediaContent, options = {}) {
    if (!newsletterJid || !String(newsletterJid).endsWith('@newsletter')) {
      throw new NexrayError('Invalid newsletter JID', { code: 'INVALID_NEWSLETTER_JID' })
    }
    const baileys = require('baileys')
    const prepared = await baileys.prepareWAMessageMedia(mediaContent, {
      upload: sock.waUploadToServer,
      jid: '@newsletter',
      mediaCache: sock._nexrayMediaCache,
      logger: opts.logger
    })
    const protoMsg = baileys.proto?.Message?.encode
      ? baileys.proto.Message.encode(prepared).finish()
      : null
    if (!protoMsg) {
      // fallback: normal relay
      return relayHelper(sock, newsletterJid, mediaContent, options.quoted, genOpts(options))
    }
    const mediatype = mediaContent.image ? 'image'
      : mediaContent.video ? 'video'
      : mediaContent.audio ? 'audio'
      : mediaContent.document ? 'document'
      : 'image'
    const node = {
      tag: 'message',
      attrs: {
        to: newsletterJid,
        id: baileys.generateMessageIDV2 ? baileys.generateMessageIDV2() : generateMessageId(),
        type: 'media'
      },
      content: [{
        tag: 'plaintext',
        attrs: { mediatype },
        content: protoMsg
      }]
    }
    return sock.query(node)
  }

  sock.findUserId = function (jid) {
    const store = sock.store || sock.signalRepository?.lidMapping
    let phoneNumber
    let lid
    if (String(jid).endsWith('@s.whatsapp.net')) {
      phoneNumber = jid
      try {
        lid = store?.getLIDForPN?.(jid)
      } catch {}
    } else if (String(jid).endsWith('@lid')) {
      lid = jid
      try {
        phoneNumber = store?.getPNForLID?.(jid)
      } catch {}
    }
    return { phoneNumber, lid }
  }

  // Newsletter follow helpers (prefer socket native methods)
  if (typeof sock.newsletterFollow !== 'function') {
    sock.newsletterFollow = async function (njid) {
      throw new NexrayError('newsletterFollow is not available on this socket – upgrade baileys', {
        code: 'NOT_SUPPORTED'
      })
    }
  }
  if (typeof sock.newsletterUnfollow !== 'function') {
    sock.newsletterUnfollow = async function (njid) {
      throw new NexrayError('newsletterUnfollow is not available on this socket – upgrade baileys', {
        code: 'NOT_SUPPORTED'
      })
    }
  }

  // Explicit auto-follow only
  if (opts.autoFollowNewsletter) {
    const list = Array.isArray(opts.autoFollowNewsletter)
      ? opts.autoFollowNewsletter
      : [opts.autoFollowNewsletter]
    for (const njid of list) {
      if (njid && String(njid).endsWith('@newsletter')) {
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

function noopLogger() {
  const n = () => {}
  return {
    child: () => ({ info: n, error: n, warn: n, debug: n, trace: n }),
    info: n,
    error: n,
    warn: n,
    debug: n,
    trace: n
  }
}

exports.Extend = Extend;
