'use strict'

const { randomBytes } = require('crypto')
const { NexrayError } = require('../constant/errors')

/**
 * Build proto-ready message content objects that work with
 * generateWAMessageFromContent (raw path) on official Baileys.
 * Structures mirror the fork's generateWAMessageContent.
 */

/**
 * @param {object} opts
 * @returns {object} WAMessageContent
 */
function buildTextContent(opts) {
  const { text, mentions, mentionAll, contextInfo: extraCtx } = opts
  const contextInfo = { ...(extraCtx || {}) }
  if (Array.isArray(mentions) && mentions.length) {
    contextInfo.mentionedJid = mentions
  }
  if (mentionAll) {
    contextInfo.nonJidMentions = 1
  }
  return {
    extendedTextMessage: {
      text: String(text || ''),
      contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
    }
  }
}

/**
 * Classic buttonsMessage (legacy reply buttons).
 * @param {object} opts
 * @returns {object}
 */
function buildButtonsContent(opts) {
  const buttons = (opts.buttons || []).map((button, i) => {
    const buttonText = button.text || button.buttonText || button.displayText
    if (button.nativeFlowInfo || button.name) {
      return {
        buttonId: button.id || button.buttonId || `btn_${i}`,
        buttonText: typeof buttonText === 'string' ? { displayText: buttonText } : buttonText,
        nativeFlowInfo: button.nativeFlowInfo || {
          name: button.name,
          paramsJson: typeof button.paramsJson === 'string'
            ? button.paramsJson
            : JSON.stringify(button.paramsJson || {})
        },
        type: button.type || 2 // NATIVE_FLOW
      }
    }
    return {
      buttonId: button.id || button.buttonId || `btn_${i}`,
      buttonText: typeof buttonText === 'string' ? { displayText: buttonText } : buttonText,
      type: button.type || 1 // RESPONSE
    }
  })

  const buttonsMessage = {
    buttons,
    contentText: opts.text || opts.caption || '',
    headerType: opts.headerType || 1, // EMPTY
    footerText: opts.footer || undefined
  }

  // If media header was prepared, merge it
  if (opts.headerMedia) {
    Object.assign(buttonsMessage, opts.headerMedia)
    const type = Object.keys(opts.headerMedia)[0] || ''
    const map = {
      imageMessage: 4,
      videoMessage: 5,
      documentMessage: 3,
      locationMessage: 2
    }
    buttonsMessage.headerType = map[type] || 1
  }

  return { buttonsMessage }
}

/**
 * List message (legacy sections).
 * @param {object} opts
 * @returns {object}
 */
function buildListContent(opts) {
  return {
    listMessage: {
      sections: opts.sections || [],
      buttonText: opts.buttonText || 'Select',
      title: opts.title || '',
      footerText: opts.footer || '',
      description: opts.text || opts.description || '',
      listType: opts.listType || 1 // SINGLE_SELECT
    }
  }
}

/**
 * Interactive / nativeFlow message.
 * @param {object} opts
 * @returns {object}
 */
function buildInteractiveContent(opts) {
  const buttonsField = Array.isArray(opts.buttons)
    ? opts.buttons
    : Array.isArray(opts.interactiveButtons)
      ? opts.interactiveButtons
      : opts.nativeFlowMessage?.buttons || []

  let paramsJson = opts.messageParamsJson || opts.paramsJson || ''
  if (typeof paramsJson === 'object' && paramsJson !== null) {
    paramsJson = JSON.stringify(paramsJson)
  }

  const interactiveMessage = {
    nativeFlowMessage: {
      buttons: buttonsField,
      messageParamsJson: paramsJson || undefined
    }
  }

  if (opts.text || opts.caption) {
    interactiveMessage.body = { text: opts.text || opts.caption }
  }
  if (opts.footer) {
    interactiveMessage.footer = { text: opts.footer }
  }
  if (opts.title || opts.subtitle || opts.headerMedia) {
    interactiveMessage.header = {
      title: opts.title || '',
      subtitle: opts.subtitle || '',
      hasMediaAttachment: !!opts.headerMedia
    }
    if (opts.headerMedia) {
      Object.assign(interactiveMessage.header, opts.headerMedia)
    }
  }
  if (opts.thumbnail) {
    interactiveMessage.jpegThumbnail = opts.thumbnail
  }

  return { interactiveMessage }
}

/**
 * Album header only (children sent separately with association).
 * @param {{ imageCount: number, videoCount: number }} counts
 * @returns {object}
 */
function buildAlbumHeader(counts) {
  return {
    albumMessage: {
      expectedImageCount: counts.imageCount || 0,
      expectedVideoCount: counts.videoCount || 0
    }
  }
}

/**
 * Poll creation.
 * @param {object} opts
 * @returns {object}
 */
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
  const result = {
    messageContextInfo: { messageSecret }
  }

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

  return result
}

/**
 * Poll result snapshot.
 * @param {object} opts - { name, votes: [{ name, voteCount }], pollType? }
 * @returns {object}
 */
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
    return { pollResultSnapshotMessageV3: pollResultSnapshotMessage }
  }
  return { pollResultSnapshotMessage }
}

/**
 * React.
 */
function buildReactContent(opts) {
  return {
    reactionMessage: {
      text: opts.emoji || opts.text || '',
      key: opts.key
    }
  }
}

/**
 * Location.
 */
function buildLocationContent(opts) {
  return {
    locationMessage: {
      degreesLatitude: opts.latitude,
      degreesLongitude: opts.longitude,
      name: opts.name || '',
      address: opts.address || ''
    }
  }
}

/**
 * Contacts.
 */
function buildContactsContent(opts) {
  const contacts = opts.contacts || []
  return {
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
}

function buildVCard(c) {
  const name = c.fullName || c.displayName || c.name || 'Contact'
  const phone = String(c.phoneNumber || c.number || '').replace(/\D/g, '')
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\nEND:VCARD`
}

module.exports = {
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
}
