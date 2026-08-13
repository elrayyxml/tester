'use strict'

const { relayHelper, relayRaw, prepareMedia } = require('../listener/relay')
const { generateMessageId, defaultIsBot } = require('../utils/functions')
const { getBufferFromUrl, detectMime } = require('../utils/media')
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
  buildContactsContent
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
            { text, linkPreview: preview, mentions: options.mentions },
            quoted,
            genOpts(options)
          )
        }
      } catch {}
    }

    return relayRaw(sock, jid, content, { ...genOpts(options), quoted })
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
      mediaInput = { audio: buffer, mimetype: mime, ptt: !!options.ptt }
    }
    if (options.viewOnce) mediaInput.viewOnce = true

    return relayHelper(sock, jid, mediaInput, quoted, genOpts(options))
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
  sock.sendContact = async function (jid, contacts, quoted) {
    return relayRaw(sock, jid, buildContactsContent({ contacts }), { ...genOpts(), quoted })
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
      const isVideo = mime.startsWith('video/') || !!item.video
      if (isVideo) videoCount++
      else imageCount++
      prepared.push({ buffer, mime, isVideo, caption: item.caption })
    }

    // 1) album header
    const header = await relayRaw(
      sock,
      jid,
      buildAlbumHeader({ imageCount, videoCount }),
      { ...genOpts(options), quoted }
    )

    // 2) children with association
    const results = [header]
    for (const item of prepared) {
      const mediaInput = item.isVideo
        ? { video: item.buffer, caption: item.caption, mimetype: item.mime }
        : { image: item.buffer, caption: item.caption, mimetype: item.mime }

      // prepare media first then attach association via raw
      const preparedMedia = await prepareMedia(sock, mediaInput, genOpts(options))
      const childContent = {
        ...preparedMedia,
        messageContextInfo: {
          messageAssociation: {
            associationType: 1, // MEDIA_ALBUM
            parentMessageKey: header.key
          }
        }
      }
      const child = await relayRaw(sock, jid, childContent, genOpts(options))
      results.push(child)
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
    if (options.image || options.video || options.media) {
      const mediaSrc = options.media || (options.image ? { image: options.image } : { video: options.video })
      try {
        headerMedia = await prepareMedia(sock, mediaSrc, genOpts(options))
      } catch (e) {
        opts.logger?.warn?.({ err: e }, 'interactive header media failed')
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
      headerMedia
    })

    return relayRaw(sock, jid, content, { ...genOpts(options), quoted })
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
  sock.sendLegacyButton = async function (jid, buttons, quoted, options = {}) {
    let headerMedia = null
    if (options.image || options.video || options.media) {
      const mediaSrc = options.media || (options.image ? { image: options.image } : { video: options.video })
      try {
        headerMedia = await prepareMedia(sock, mediaSrc, genOpts(options))
      } catch {}
    }
    const content = buildButtonsContent({
      buttons,
      text: options.text || options.caption,
      caption: options.caption,
      footer: options.footer,
      headerMedia
    })
    return relayRaw(sock, jid, content, { ...genOpts(options), quoted })
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

module.exports = { Extend }
