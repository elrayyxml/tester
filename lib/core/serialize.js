/**
 * Incoming message serialization and normalization.
 *
 * Turns a raw engine message into a consistent shape used by the helpers
 * and by bot applications: message type, quoted message, JID, sender, group
 * info, and bot detection.
 *
 * @module core/serialize
 */

import {
    hasNonNullishProperty
} from '../utils/function.js'
import {
    isJidGroup,
    isJidNewsletter,
    isJidStatusBroadcast
} from '../utils/function.js'
import { createError, ErrorCodes } from '../constant/index.js'

/**
 * Determines the content type key of a message payload.
 *
 * @param {object} content - Message content object.
 * @returns {string|undefined} Content type key (e.g. `extendedTextMessage`).
 */
export function getContentType(content) {
    if (!content) {
        return undefined
    }
    const keys = Object.keys(content)
    return keys.find((key) => (key === 'conversation' || key.endsWith('Message')) && key !== 'senderKeyDistributionMessage')
}

/**
 * Unwraps future-proof message wrappers (ephemeral, view once, etc.).
 *
 * @param {object} content - Message content object.
 * @returns {object|undefined} The unwrapped message content.
 */
export function normalizeMessageContent(content) {
    if (!content) {
        return undefined
    }
    for (let i = 0; i < 5; i++) {
        const inner = getFutureProofMessage(content)
        if (!inner) {
            break
        }
        content = inner.message
    }
    return content

    function getFutureProofMessage(message) {
        return message?.associatedChildMessage ||
            message?.botForwardedMessage ||
            message?.botInvokeMessage ||
            message?.botTaskMessage ||
            message?.documentWithCaptionMessage ||
            message?.editedMessage ||
            message?.ephemeralMessage ||
            message?.eventCoverImage ||
            message?.groupMentionedMessage ||
            message?.groupStatusMentionMessage ||
            message?.groupStatusMessage ||
            message?.groupStatusMessageV2 ||
            message?.limitSharingMessage ||
            message?.lottieStickerMessage ||
            message?.newsletterAdminProfileMessage ||
            message?.newsletterAdminProfileMessageV2 ||
            message?.newsletterAdminProfileStatusMessage ||
            message?.pollCreationMessageV4 ||
            message?.pollCreationOptionImageMessage ||
            message?.questionMessage ||
            message?.questionReplyMessage ||
            message?.spoilerMessage ||
            message?.statusAddYours ||
            message?.statusMentionMessage ||
            message?.viewOnceMessage ||
            message?.viewOnceMessageV2 ||
            message?.viewOnceMessageV2Extension
    }
}

/**
 * Extracts the true content from a message payload.
 *
 * @param {object} content - Message content object.
 * @returns {object} The extracted message content.
 */
export function extractMessageContent(content) {
    content = normalizeMessageContent(content)
    if (content?.buttonsMessage) {
        return extractFromTemplateMessage(content.buttonsMessage)
    }
    if (content?.templateMessage?.hydratedFourRowTemplate) {
        return extractFromTemplateMessage(content.templateMessage.hydratedFourRowTemplate)
    }
    if (content?.templateMessage?.hydratedTemplate) {
        return extractFromTemplateMessage(content.templateMessage.hydratedTemplate)
    }
    if (content?.templateMessage?.fourRowTemplate) {
        return extractFromTemplateMessage(content.templateMessage.fourRowTemplate)
    }
    return content

    function extractFromTemplateMessage(templateMessage) {
        if (templateMessage.imageMessage) {
            return { imageMessage: templateMessage.imageMessage }
        }
        if (templateMessage.documentMessage) {
            return { documentMessage: templateMessage.documentMessage }
        }
        if (templateMessage.videoMessage) {
            return { videoMessage: templateMessage.videoMessage }
        }
        if (templateMessage.locationMessage) {
            return { locationMessage: templateMessage.locationMessage }
        }
        return {
            conversation: 'contentText' in templateMessage
                ? templateMessage.contentText
                : 'hydratedContentText' in templateMessage
                    ? templateMessage.hydratedContentText
                    : ''
        }
    }
}

/**
 * Gets the message type name (e.g. `image`, `text`, `sticker`).
 *
 * @param {object} message - Message content.
 * @returns {string} Message type name.
 */
export function getMessageType(message) {
    if (!message) {
        return 'text'
    }
    const content = extractMessageContent(message)
    if (content?.conversation || content?.extendedTextMessage) {
        return 'text'
    }
    const type = getContentType(content)
    if (type) {
        return type.replace('Message', '')
    }
    return 'text'
}

/**
 * Checks whether a message key belongs to a bot using the configured detector.
 *
 * The detector is safe against undefined/null/non-string IDs.
 *
 * @param {object} config - Client configuration.
 * @param {object} key - Message key.
 * @returns {boolean} True when the message is considered bot generated.
 */
export function isBotMessage(config, key) {
    const id = key?.id
    if (typeof id !== 'string' || id.length === 0) {
        return false
    }
    const detector = config.bot
    if (detector == null) {
        return false
    }
    if (typeof detector === 'function') {
        try {
            return detector(id) === true
        } catch {
            return false
        }
    }
    return detector === true
}

/**
 * Serializes a raw incoming message into a consistent shape.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {object} m - Raw message object.
 * @param {object} config - Client configuration.
 * @returns {import('../types/baileys.js').SerializedMessage} Serialized message.
 */
export function serializeMessage(sock, m, config = {}) {
    if (!m || typeof m !== 'object') {
        throw createError('Cannot serialize an invalid message.', ErrorCodes.INVALID_MESSAGE)
    }
    const key = m.key || {}
    const remoteJid = key.remoteJid || m.remoteJid || ''
    const participant = key.participant || m.participant || null
    const isGroup = isJidGroup(remoteJid)
    const isNewsletter = isJidNewsletter(remoteJid)
    const isStatus = isJidStatusBroadcast(remoteJid)

    const content = m.message || {}
    const type = getMessageType(content)
    let sender = participant
    if (!sender) {
        sender = key.fromMe === true ? (sock.user?.id || remoteJid) : remoteJid
    }

    const quoted = buildQuoted(sock, m, config)
    const text = extractText(content)

    return {
        key,
        message: content,
        type,
        jid: remoteJid,
        sender,
        from: participant,
        isGroup,
        isNewsletter,
        isStatus,
        isBot: isBotMessage(config, key),
        quoted,
        text,
        raw: m,
        pushName: m.pushName,
        timestamp: m.messageTimestamp
    }
}

/**
 * Extracts plain text from a message payload.
 *
 * @param {object} content - Message content.
 * @returns {string} Extracted text.
 */
export function extractText(content) {
    const normalized = normalizeMessageContent(content)
    if (!normalized) {
        return ''
    }
    if (typeof normalized.conversation === 'string') {
        return normalized.conversation
    }
    if (normalized.extendedTextMessage?.text) {
        return normalized.extendedTextMessage.text
    }
    if (normalized.imageMessage?.caption) {
        return normalized.imageMessage.caption
    }
    if (normalized.videoMessage?.caption) {
        return normalized.videoMessage.caption
    }
    if (normalized.documentMessage?.caption) {
        return normalized.documentMessage.caption
    }
    return ''
}

/**
 * Builds a quoted message object from an incoming message.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {object} m - Incoming message.
 * @param {object} config - Client configuration.
 * @returns {object|null} Quoted message object or null.
 */
export function buildQuoted(sock, m, config = {}) {
    const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
        m.message?.imageMessage?.contextInfo ||
        m.message?.videoMessage?.contextInfo ||
        m.message?.documentMessage?.contextInfo ||
        m.message?.audioMessage?.contextInfo ||
        m.message?.stickerMessage?.contextInfo || {}

    const quotedMessage = contextInfo.quotedMessage || null
    if (!quotedMessage) {
        return null
    }

    const quotedKey = {
        remoteJid: m.key?.remoteJid,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant,
        fromMe: contextInfo.participant === sock.user?.id || contextInfo.participant === m.key?.remoteJid
    }

    return {
        key: quotedKey,
        message: quotedMessage,
        type: getMessageType(quotedMessage),
        text: extractText(quotedMessage),
        isBot: isBotMessage(config, quotedKey),
        sender: contextInfo.participant || m.key?.remoteJid,
        isGroup: isJidGroup(m.key?.remoteJid),
        isNewsletter: isJidNewsletter(m.key?.remoteJid)
    }
}