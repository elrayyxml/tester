'use strict'

const { randomBytes } = require('crypto')

/**
 * Proto-ready content builders.
 * Prefer WAProto.Message.create when available; fall back to plain objects
 * that generateWAMessageFromContent accepts.
 */

function getProto() {
  try {
    const b = require('baileys')
    return b.proto || b.WAProto || null
  } catch {
    return null
  }
}

function createMessage(obj) {
  const proto = getProto()
  if (proto?.Message?.create) {
    try {
      return proto.Message.create(obj)
    } catch {
      return obj
    }
  }
  return obj
}

/** Apply mentions / mentionAll / custom contextInfo onto the primary content key */
function applyContextInfo(m, opts = {}) {
  if (!m || typeof m !== 'object') return m
  const type = Object.keys(m).find(k => k !== 'messageContextInfo')
  if (!type) return m
  const key = m[type]
  if (!key || typeof key !== 'object') return m

  const ctx = { ...(key.contextInfo || {}) }
  if (Array.isArray(opts.mentions) && opts.mentions.length) {
    ctx.mentionedJid = opts.mentions
  }
  if (opts.mentionAll) {
    ctx.nonJidMentions = 1
  }
  if (opts.contextInfo && typeof opts.contextInfo === 'object') {
    Object.assign(ctx, opts.contextInfo)
  }
  if (Object.keys(ctx).length) {
    key.contextInfo = ctx
  }
  return m
}

function buildTextContent(opts) {
  const m = {
    extendedTextMessage: {
      text: String(opts.text || '')
    }
  }
  return createMessage(applyContextInfo(m, opts))
}

function buildButtonsContent(opts) {
  const buttons = (opts.buttons || []).map((button, i) => {
    const buttonText = button.text || button.buttonText || button.displayText
    if (button.nativeFlowInfo || button.name) {
      return {
        buttonId: button.id || button.buttonId || `btn_${i}`,
        buttonText: typeof buttonText === 'string' ? { displayText: buttonText } : buttonText,
        nativeFlowInfo: button.nativeFlowInfo || {
          name: button.name,
          paramsJson:
            typeof button.paramsJson === 'string'
              ? button.paramsJson
              : JSON.stringify(button.paramsJson || {})
        },
        type: button.type || 2
      }
    }
    return {
      buttonId: button.id || button.buttonId || `btn_${i}`,
      buttonText: typeof buttonText === 'string' ? { displayText: buttonText } : buttonText,
      type: button.type || 1
    }
  })

  const buttonsMessage = {
    buttons,
    contentText: opts.text || opts.caption || '',
    headerType: 1,
    footerText: opts.footer || undefined
  }

  if (opts.headerMedia) {
    Object.assign(buttonsMessage, opts.headerMedia)
    const type = Object.keys(opts.headerMedia)[0] || ''
    const map = { imageMessage: 4, videoMessage: 5, documentMessage: 3, locationMessage: 2 }
    buttonsMessage.headerType = map[type] || 1
  }

  return createMessage(applyContextInfo({ buttonsMessage }, opts))
}

function buildListContent(opts) {
  const m = {
    listMessage: {
      sections: opts.sections || [],
      buttonText: opts.buttonText || 'Select',
      title: opts.title || '',
      footerText: opts.footer || '',
      description: opts.text || opts.description || '',
      listType: opts.listType || 1
    }
  }
  return createMessage(applyContextInfo(m, opts))
}

/**
 * Full interactive / nativeFlow builder.
 * Supports:
 *  - buttons / interactiveButtons / nativeFlow
 *  - header: image / video / document / location / product (already prepared)
 *  - body, footer, title, subtitle
 *  - messageParamsJson
 *  - mentions / mentionAll
 */
function buildInteractiveContent(opts) {
  const nativeFlowSource = opts.nativeFlowMessage || opts.nativeFlow || {}
  const buttonsField = Array.isArray(opts.buttons)
    ? opts.buttons
    : Array.isArray(opts.interactiveButtons)
      ? opts.interactiveButtons
      : Array.isArray(opts.nativeFlow)
        ? opts.nativeFlow
        : nativeFlowSource.buttons || []

  let paramsJson =
    opts.messageParamsJson ||
    opts.paramsJson ||
    (typeof nativeFlowSource === 'object' ? nativeFlowSource.messageParamsJson || nativeFlowSource.paramsJson : '') ||
    ''
  if (typeof paramsJson === 'object' && paramsJson !== null) {
    paramsJson = JSON.stringify(paramsJson)
  }

  const normalizedButtons = buttonsField.map(button => {
    if (!button || typeof button !== 'object') return button
    if (button.name && (button.buttonParamsJson !== undefined || button.paramsJson !== undefined)) {
      const buttonParamsJson = button.buttonParamsJson ?? button.paramsJson
      return {
        ...button,
        buttonParamsJson: typeof buttonParamsJson === 'string' ? buttonParamsJson : JSON.stringify(buttonParamsJson || {})
      }
    }
    return button
  })

  const interactiveMessage = {
    nativeFlowMessage: {
      buttons: normalizedButtons,
      messageParamsJson: paramsJson || undefined
    }
  }

  if (opts.text || opts.caption) {
    interactiveMessage.body = { text: opts.text || opts.caption }
  }
  if (opts.footer) {
    interactiveMessage.footer = { text: opts.footer }
  }

  const hasHeader =
    opts.title ||
    opts.subtitle ||
    opts.headerMedia ||
    opts.locationMessage ||
    opts.productMessage ||
    opts.header

  if (hasHeader) {
    interactiveMessage.header = {
      title: opts.header?.title || opts.title || '',
      subtitle: opts.header?.subtitle || opts.subtitle || '',
      hasMediaAttachment: !!(
        opts.headerMedia ||
        opts.locationMessage ||
        opts.productMessage ||
        opts.header?.hasMediaAttachment
      )
    }

    // Merge prepared media into header
    if (opts.headerMedia) {
      Object.assign(interactiveMessage.header, opts.headerMedia)
    }
    // Location header
    if (opts.locationMessage) {
      interactiveMessage.header.locationMessage = createLocationMessage(opts.locationMessage)
      interactiveMessage.header.hasMediaAttachment = true
    }
    // Product header
    if (opts.productMessage) {
      interactiveMessage.header.productMessage = opts.productMessage
      interactiveMessage.header.hasMediaAttachment = true
    }
  }

  if (opts.thumbnail) {
    interactiveMessage.jpegThumbnail = opts.thumbnail
  }

  // contextInfo on interactiveMessage itself
  const ctx = {}
  if (Array.isArray(opts.mentions) && opts.mentions.length) ctx.mentionedJid = opts.mentions
  if (opts.mentionAll) ctx.nonJidMentions = 1
  if (opts.contextInfo) Object.assign(ctx, opts.contextInfo)
  if (Object.keys(ctx).length) interactiveMessage.contextInfo = ctx

  return createMessage({ interactiveMessage })
}

function buildAlbumHeader(counts) {
  return createMessage({
    albumMessage: {
      expectedImageCount: counts.imageCount || 0,
      expectedVideoCount: counts.videoCount || 0
    }
  })
}

function buildPollContent(opts) {
  const values = opts.values || []
  const selectableCount = opts.selectableCount ?? 1
  const pollCreationMessage = {
    name: opts.name || 'Poll',
    selectableOptionsCount: selectableCount,
    options: values.map(optionName => ({ optionName: String(optionName) })),
    endTime: opts.endDate ? new Date(opts.endDate).getTime() : undefined,
    hideParticipantName: opts.hideVoter ?? false,
    allowAddOption: opts.canAddOption ?? false
  }

  const messageSecret = opts.messageSecret || randomBytes(32)
  const result = { messageContextInfo: { messageSecret } }

  if (opts.toAnnouncementGroup) {
    result.pollCreationMessageV2 = pollCreationMessage
  } else if (opts.correctAnswer !== undefined || opts.pollType === 1) {
    result.pollCreationMessageV5 = {
      ...pollCreationMessage,
      correctAnswer: { optionName: String(opts.correctAnswer) },
      pollType: 1,
      selectableOptionsCount: 1
    }
  } else if (selectableCount === 1) {
    result.pollCreationMessageV3 = pollCreationMessage
  } else {
    result.pollCreationMessage = pollCreationMessage
  }

  return createMessage(result)
}

function buildPollResultContent(opts) {
  const pollResultSnapshotMessage = {
    name: opts.name || 'Results',
    pollVotes: (opts.votes || []).map(vote => ({
      optionName: vote.name || vote.optionName,
      optionVoteCount: parseInt(vote.voteCount ?? vote.count ?? 0, 10)
    })),
    pollType: opts.pollType === 1 ? 1 : 0
  }
  if (opts.pollType === 1) {
    return createMessage({ pollResultSnapshotMessageV3: pollResultSnapshotMessage })
  }
  return createMessage({ pollResultSnapshotMessage })
}

function buildReactContent(opts) {
  return createMessage({
    reactionMessage: {
      text: opts.emoji || opts.text || '',
      key: opts.key
    }
  })
}

function createLocationMessage(opts = {}) {
  const value = {
    degreesLatitude: opts.degreesLatitude ?? opts.latitude ?? 0,
    degreesLongitude: opts.degreesLongitude ?? opts.longitude ?? 0,
    name: opts.name || '',
    address: opts.address || '',
    url: opts.url || '',
    jpegThumbnail: opts.jpegThumbnail || opts.thumbnail
  }
  const proto = getProto()
  if (proto?.Message?.LocationMessage?.create) {
    try {
      return proto.Message.LocationMessage.create(value)
    } catch {}
  }
  return value
}

function buildLocationContent(opts) {
  const m = { locationMessage: createLocationMessage(opts) }
  return createMessage(applyContextInfo(m, opts))
}

function buildContactsContent(opts) {
  const contacts = opts.contacts || []
  const m = {
    contactsArrayMessage: {
      displayName:
        contacts.length === 1
          ? contacts[0].fullName || contacts[0].displayName || 'Contact'
          : `${contacts.length} contacts`,
      contacts: contacts.map(c => ({
        displayName: c.fullName || c.displayName || c.name || 'Contact',
        vcard: c.vcard || buildVCard(c)
      }))
    }
  }
  return createMessage(applyContextInfo(m, opts))
}

function buildVCard(c) {
  const name = c.fullName || c.displayName || c.name || 'Contact'
  const phone = String(c.phoneNumber || c.number || '').replace(/\D/g, '')
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\nEND:VCARD`
}

/**
 * Build productMessage object (after image is prepared via prepareWAMessageMedia).
 */
function buildProductMessage(opts, imageMessage) {
  return {
    product: {
      productImage: imageMessage,
      productId: opts.productId || '',
      title: opts.title || '',
      description: opts.description || '',
      currencyCode: opts.currencyCode || 'IDR',
      priceAmount1000: opts.priceAmount1000 ?? 0,
      retailerId: opts.retailerId || '',
      url: opts.url || '',
      productImageCount: opts.productImageCount ?? 1
    },
    businessOwnerJid: opts.businessOwnerJid
  }
}

exports.getProto = getProto;
exports.createMessage = createMessage;
exports.applyContextInfo = applyContextInfo;
exports.buildTextContent = buildTextContent;
exports.buildButtonsContent = buildButtonsContent;
exports.buildListContent = buildListContent;
exports.buildInteractiveContent = buildInteractiveContent;
exports.buildAlbumHeader = buildAlbumHeader;
exports.buildPollContent = buildPollContent;
exports.buildPollResultContent = buildPollResultContent;
exports.buildReactContent = buildReactContent;
exports.buildLocationContent = buildLocationContent;
exports.createLocationMessage = createLocationMessage;
exports.buildContactsContent = buildContactsContent;
exports.buildProductMessage = buildProductMessage;
