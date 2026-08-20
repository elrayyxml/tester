/**
 * Message core: relay pipeline, message builders, and message helpers.
 *
 * Every outgoing message flows through the centralized relay pipeline:
 *
 *   Public Helper
 *     -> Validate Arguments
 *     -> Normalize Options
 *     -> Resolve Media
 *     -> Build Message
 *     -> Apply Context
 *     -> Apply Newsletter Annotation
 *     -> Apply Recipient Configuration
 *     -> Generate Message
 *     -> Generate/Apply Message ID
 *     -> relayMessage()
 *     -> Return Result
 *
 * No helper implements its own transport; everything goes through
 * {@link relayMessage}.
 *
 * @module core/message
 */

import {
    ErrorCodes,
    createError,
    toNexrayError,
    DEFAULT_MESSAGE_ID_PREFIX
} from '../constant/index.js'
import {
    resolveQuoted,
    getRandom,
    generateMessageIDV2,
    isJidGroup,
    isJidNewsletter,
    isJidUser,
    isJidLid,
    assertJid
} from '../utils/function.js'
import { resolveMedia } from '../utils/converter.js'
import {
    isWebP,
    setWebpExif
} from '../utils/exif.js'
import { toWebP, buildStickerPackPayload, toJpegThumbnail } from '../utils/sticker-pack.js'
import {
    makeMessageSecret,
    randomBytes
} from '../utils/cryptokey.js'
import { NODES, normalizeAdditionalNodes } from './node.js'

const DEFAULT_POLYGON_VERTICES = [
    { x: 60.71664810180664, y: -36.39784622192383 },
    { x: -16.710189819335938, y: 49.263675689697266 },
    { x: -56.585853576660156, y: 37.85963439941406 },
    { x: 20.840980529785156, y: -47.80188751220703 }
]

/**
 * Returns the internal engine context attached to a socket by the Client.
 *
 * @param {object} sock - The augmented engine socket.
 * @returns {object} The engine context (`sock.__nexray`).
 * @throws {NexrayError} INVALID_SOCKET when the socket is not initialized by a Client.
 */
export function getContext(sock) {
    if (!sock || typeof sock !== 'object' || !sock.__nexray) {
        throw createError(
            'Socket is not initialized. Wrap it with Client() first.',
            ErrorCodes.INVALID_SOCKET
        )
    }
    return sock.__nexray
}

/**
 * Generates a stealth message ID that matches the requested device format.
 *
 * @param {string} device - Device identifier (ios, android, web, desktop).
 * @returns {string} Message ID shaped like the target device.
 */
export function generateStealthId(device) {
    switch (device) {
        case 'ios':
            return '3A' + getRandom(18)
        case 'web':
            return '3E' + getRandom(20)
        case 'android':
            return getRandom(32)
        case 'desktop':
            return '3F' + getRandom(18)
        default:
            return DEFAULT_MESSAGE_ID_PREFIX + getRandom(36).toLowerCase()
    }
}

/**
 * Generates the message ID for a relay operation.
 *
 * Priority: explicit `messageId` option, then `custom_id` prefix, then
 * stealth device format, then the default 3EB0 format.
 *
 * The `custom_id` value is injected into a whatsmeow-style hex ID
 * (`3EB0` + 18 hex chars) at a pseudo-random position, mirroring the
 * fork's `generateMessageIDV2`.
 *
 * @param {object} context - Engine context.
 * @param {object} [options] - Message options.
 * @returns {string} Message ID.
 */
export function makeMessageId(context, options = {}) {
    if (typeof options.messageId === 'string' && options.messageId.length > 0) {
        return options.messageId
    }
    const config = context.config || {}
    if (typeof config.custom_id === 'string' && config.custom_id.length > 0) {
        return generateMessageIDV2(context.sock?.user?.id, config.custom_id)
    }
    if (config.stealth) {
        return generateStealthId(config.stealth)
    }
    return generateMessageIDV2(context.sock?.user?.id)
}

/**
 * Detects whether a message ID belongs to a bot using the configured detector.
 *
 * Safe against undefined, null, and non-string IDs.
 *
 * @param {object} config - Client configuration.
 * @param {string} id - Message ID.
 * @returns {boolean} True when the ID is considered bot generated.
 */
export function detectBotId(config, id) {
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
 * Builds the newsletter media annotation from the normalized config.
 *
 * @param {object} context - Engine context.
 * @param {object} annotationConfig - Newsletter annotation configuration.
 * @returns {object} The annotation payload.
 */
export function buildNewsletterAnnotation(context, annotationConfig) {
    const proto = context.engine?.proto
    const contentType = proto?.ContextInfo?.ForwardedNewsletterMessageInfo?.ContentType?.UPDATE ?? 1
    return {
        polygonVertices: annotationConfig.polygonVertices || DEFAULT_POLYGON_VERTICES,
        newsletter: {
            newsletterJid: annotationConfig.newsletterJid,
            newsletterName: annotationConfig.newsletterName,
            contentType: annotationConfig.contentType ?? contentType,
            accessibilityText: annotationConfig.accessibilityText || annotationConfig.newsletterName || ''
        }
    }
}

/**
 * Resolves the newsletter annotation for a message.
 *
 * @param {object} context - Engine context.
 * @param {object} options - Message options (may override global config).
 * @param {string} jid - Destination JID.
 * @returns {object|null} Annotation payload or null.
 */
export function resolveNewsletterAnnotation(context, options = {}, jid) {
    if (!isJidNewsletter(jid)) {
        return null
    }
    const config = context.config || {}
    const annotationConfig = options.newsletterAnnotation ?? config.newsletterAnnotation
    if (!annotationConfig) {
        return null
    }
    return buildNewsletterAnnotation(context, annotationConfig)
}

/**
 * Validates that a JID is a newsletter JID.
 *
 * @param {string} jid - JID to validate.
 * @throws {NexrayError} NEWSLETTER_ONLY when the JID is not a newsletter.
 */
export function assertNewsletterJid(jid) {
    if (!isJidNewsletter(jid)) {
        throw createError(
            'This message type is only supported for newsletter JIDs (@newsletter).',
            ErrorCodes.NEWSLETTER_ONLY
        )
    }
}

/**
 * Builds a context info object for a message.
 *
 * @param {object} options - Context options.
 * @param {object|null} [options.quoted] - Quoted message.
 * @param {number|string} [options.expiration] - Ephemeral expiration seconds.
 * @param {string[]} [options.mentions] - Mentioned JIDs.
 * @param {object} [options.extra] - Extra context info fields.
 * @returns {object} Context info object.
 */
export function buildContextInfo({ quoted, expiration, mentions, extra } = {}) {
    const contextInfo = {}
    if (quoted) {
        const key = quoted.key || {}
        contextInfo.stanzaId = key.id
        contextInfo.participant = key.fromMe
            ? undefined
            : key.participant || key.remoteJid
        contextInfo.quotedMessage = quoted.message || null
        if (key.remoteJid) {
            contextInfo.remoteJid = key.remoteJid
        }
    }
    if (expiration) {
        contextInfo.expiration = expiration
    }
    if (Array.isArray(mentions) && mentions.length > 0) {
        contextInfo.mentionedJid = mentions
    }
    if (extra && typeof extra === 'object') {
        Object.assign(contextInfo, extra)
    }
    return contextInfo
}

/**
 * Resolves mention configuration for a message.
 *
 * `mentionAll` does not resolve participant JIDs. Instead it marks the
 * message with `nonJidMentions = 1` (mention-all without a JID list).
 *
 * @param {object} sock - The augmented engine socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object} options - Message options.
 * @param {boolean} [options.mentionAll=false] - Mention all chat participants.
 * @returns {Promise<{mentions: string[], mentionAll: boolean}>} Resolved mentions.
 */
export async function resolveMentions(sock, remoteJid, options = {}) {
    const mentionAll = options.mentionAll === true || options.mentionsAll === true
    let mentions = options.mentions || options.mentionedJid || []
    if (!Array.isArray(mentions)) {
        mentions = []
    }
    return { mentions, mentionAll }
}

/**
 * Prepares media for a message using the engine's prepareWAMessageMedia.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {string} mediaType - Media type (image, video, audio, document, sticker).
 * @param {import('../types/baileys.js').MediaInput} mediaInput - Media input.
 * @param {object} [options] - Media options.
 * @returns {Promise<object>} The prepared media message object.
 */
export async function prepareMedia(sock, mediaType, mediaInput, options = {}) {
    if (mediaInput == null) {
        throw createError(`Media input for ${mediaType} is empty.`, ErrorCodes.INVALID_MEDIA)
    }
    const context = getContext(sock)
    const prepare = context.engine.prepareWAMessageMedia
    if (typeof prepare !== 'function') {
        throw createError(
            'The configured engine does not expose "prepareWAMessageMedia".',
            ErrorCodes.NOT_IMPLEMENTED
        )
    }

    let media
    if (Buffer.isBuffer(mediaInput)) {
        media = mediaInput
    } else if (typeof mediaInput === 'string') {
        media = { url: mediaInput }
    } else if (mediaInput && typeof mediaInput === 'object') {
        media = mediaInput
    } else {
        throw createError(`Unsupported media input for ${mediaType}.`, ErrorCodes.INVALID_MEDIA)
    }

    const message = { [mediaType]: media }
    if (options.extraContent && typeof options.extraContent === 'object') {
        Object.assign(message, options.extraContent)
    }

    const annotation = resolveNewsletterAnnotation(context, options, options.jid)
    if (annotation && (mediaType === 'image' || mediaType === 'video')) {
        message.annotations = [annotation]
    }

    const prepared = await prepare(message, {
        upload: sock.waUploadToServer || sock.upload,
        mediaTypeOverride: options.mediaTypeOverride,
        jid: options.jid,
        logger: context.logger,
        mediaAnnotation: annotation || undefined,
        options: options.engineOptions
    })

    const preparedMessage = prepared[`${mediaType}Message`] || (
        mediaType === 'video' && message.ptv ? prepared.ptvMessage : undefined
    )
    if (!preparedMessage) {
        throw createError(
            `Engine did not return a ${mediaType}Message from prepareWAMessageMedia.`,
            ErrorCodes.NOT_IMPLEMENTED
        )
    }
    return preparedMessage
}

/**
 * Detects whether a payload already carries a message-type key.
 *
 * Mirrors the engine's `getContentType`: keys are either `conversation` or
 * end with `Message`. Semantic payloads (`text`, `product`, `buttons`, ...)
 * do NOT qualify — they must be expanded by the engine first.
 *
 * @param {object} content - Message payload.
 * @returns {boolean} True when the payload has a message-type key.
 */
export function hasMessageContentKey(content) {
    if (!content || typeof content !== 'object') {
        return false
    }
    return Object.keys(content).some((key) => key === 'conversation' || key.includes('Message'))
}

/**
 * Generates a WAMessage from a raw protobuf payload through the engine.
 *
 * Semantic payloads (e.g. `{ text }`, `{ product }`) are expanded through
 * the engine's `generateWAMessageContent` first — exactly like the engine's
 * own `generateWAMessage` — so the payload always lands on a message-type
 * key before `generateWAMessageFromContent` runs. Without this expansion the
 * engine crashes with "Cannot use 'in' operator ... in undefined" whenever a
 * quoted message is applied.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {string} jid - Destination JID.
 * @param {object} content - Raw message payload.
 * @param {object} [options] - Generation options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function generateMessage(sock, jid, content, options = {}) {
    const context = getContext(sock)
    const generate = context.engine.generateWAMessageFromContent
    if (typeof generate !== 'function') {
        throw createError(
            'The configured engine does not expose "generateWAMessageFromContent".',
            ErrorCodes.NOT_IMPLEMENTED
        )
    }
    const messageId = makeMessageId(context, options)

    let payload = content
    const transform = context.engine.generateWAMessageContent
    if (!hasMessageContentKey(content) && typeof transform === 'function') {
        payload = await transform(content, {
            upload: sock.waUploadToServer || sock.upload,
            jid,
            logger: context.logger,
            mediaAnnotation: options.mediaAnnotation,
            ...(options.engineOptions && typeof options.engineOptions === 'object' ? options.engineOptions : {})
        })
    }

    return generate(jid, payload, {
        userJid: sock.user?.id,
        quoted: options.quoted || null,
        messageId,
        upload: sock.waUploadToServer || sock.upload,
        ephemeralExpiration: options.ephemeralExpiration,
        ...options.engineOptions
    })
}

/**
 * The centralized relay pipeline.
 *
 * Every message helper routes through this function. It applies the
 * newsletter annotation, generates/applies the message ID, normalizes
 * additional nodes, and forwards recipient configuration to the engine.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {string} jid - Destination JID.
 * @param {object} message - Protobuf message payload.
 * @param {object} [options] - Relay options.
 * @param {string} [options.messageId] - Explicit message ID.
 * @param {object} [options.additionalAttributes] - Extra stanza attributes.
 * @param {object[]|object|function} [options.additionalNodes] - Extra binary nodes.
 * @param {object} [options.recipientOverrides] - Recipient-specific message overrides (engine dependent).
 * @param {string[]} [options.specificRecipient] - Only deliver to these recipients (engine dependent).
 * @returns {Promise<any>} The engine relay result (usually the message ID).
 * @throws {NexrayError} NOT_IMPLEMENTED when the socket has no relayMessage.
 * @throws {NexrayError} RELAY_FAILED when the relay throws.
 */
export async function relayMessage(sock, jid, message, options = {}) {
    const context = getContext(sock)

    if (typeof sock.relayMessage !== 'function') {
        throw createError(
            'The engine socket does not expose relayMessage().',
            ErrorCodes.NOT_IMPLEMENTED
        )
    }

    const messageId = makeMessageId(context, options)
    const additionalNodes = normalizeAdditionalNodes(options.additionalNodes, { jid, message })

    const relayOptions = {
        messageId,
        additionalAttributes: options.additionalAttributes,
        additionalNodes,
        participant: options.participant,
        statusJidList: options.statusJidList,
        useCachedGroupMetadata: options.useCachedGroupMetadata
    }
    if (options.recipientOverrides !== undefined) {
        relayOptions.recipientOverrides = options.recipientOverrides
    }
    if (options.specificRecipient !== undefined) {
        relayOptions.specificRecipient = options.specificRecipient
    }

    try {
        return await sock.relayMessage(jid, message, relayOptions)
    } catch (error) {
        throw toNexrayError(error, 'Failed to relay message.', ErrorCodes.RELAY_FAILED)
    }
}

/**
 * Normalizes a color value into an ARGB integer (WhatsApp format).
 *
 * @param {string|number|undefined} color - Color input (`#RRGGBB`, `#AARRGGBB`, or number).
 * @returns {number|undefined} ARGB integer or undefined.
 */
export function normalizeColor(color) {
    if (color == null) {
        return undefined
    }
    if (typeof color === 'number') {
        return color > 0 ? color : 0xffffffff + Number(color) + 1
    }
    let hex = String(color).trim().replace('#', '')
    if (hex.length <= 6) {
        hex = 'FF' + hex.padStart(6, '0')
    }
    return parseInt(hex, 16)
}

/**
 * Normalizes a date-like value into a Date.
 *
 * @param {Date|string|number} value - Date value.
 * @param {string} label - Field label for errors.
 * @returns {Date} Validated date.
 * @throws {NexrayError} INVALID_DATE when the value is not a valid date.
 */
export function normalizeDate(value, label = 'date') {
    if (value == null) {
        throw createError(`${label} is required.`, ErrorCodes.INVALID_DATE)
    }
    let date
    if (value instanceof Date) {
        date = value
    } else if (typeof value === 'number' || typeof value === 'string') {
        date = new Date(value)
    } else {
        date = new Date(NaN)
    }
    if (Number.isNaN(date.getTime())) {
        throw createError(`${label} must be a valid date.`, ErrorCodes.INVALID_DATE)
    }
    return date
}

/**
 * Sends a text message through the injected messaging engine.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {string} text - Message text.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {boolean} [options.ai=false] - Mark the message as AI generated (private chats only).
 * @param {boolean} [options.mentionAll=false] - Mention all chat participants.
 * @param {string[]} [options.mentions] - Mentioned JIDs.
 * @param {string[]} [options.mentionedJid] - Alias for mentions.
 * @param {object} [options.contextInfo] - Extra context info fields.
 * @param {number} [options.expiration] - Ephemeral expiration seconds.
 * @param {string} [options.messageId] - Explicit message ID.
 * @returns {Promise<object>} Generated WAMessage.
 * @throws {NexrayError} INVALID_JID when the JID is missing.
 * @throws {NexrayError} INVALID_MESSAGE when the text is missing.
 */
export async function sendText(sock, remoteJid, text, quoted = null, options = {}) {
    assertJid(remoteJid)
    if (typeof text !== 'string' || text.length === 0) {
        throw createError('sendText requires a non-empty text.', ErrorCodes.INVALID_MESSAGE)
    }
    const context = getContext(sock)
    quoted = resolveQuoted(quoted, options)

    if (options.ai && !(isJidUser(remoteJid) || isJidLid(remoteJid))) {
        throw createError('The AI label is only supported in private chats.', ErrorCodes.INVALID_OPTIONS)
    }

    const { mentions, mentionAll } = await resolveMentions(sock, remoteJid, options)
    const contextInfo = buildContextInfo({
        quoted,
        expiration: options.expiration,
        mentions,
        extra: {
            ...options.contextInfo,
            ...(mentionAll ? { nonJidMentions: 1 } : {})
        }
    })
    const content = {
        text,
        mentions: mentions.length > 0 ? mentions : undefined,
        linkPreview: options.linkPreview === false ? null : undefined,
        contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
    }

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: options.messageId,
        ephemeralExpiration: options.expiration,
        engineOptions: options.engineOptions
    })

    const nodes = normalizeAdditionalNodes(options.additionalNodes, { jid: remoteJid, message: msg.message })
    if (options.ai) {
        nodes.push(...NODES.bot_ai)
        if (msg.message?.messageContextInfo) {
            msg.message.messageContextInfo.supportPayload = 'eyJjcHBBYmxhdGlvbiI6IjAiLCJjYXBhYmlsaXRpZXMiOiJbInBheWxvYWRzIl0ifQ=='
        }
    }

    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: nodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a text message quoting another message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {string} text - Message text.
 * @param {object} quoted - Quoted message.
 * @param {object} [options={}] - Message options (see {@link sendText}).
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function reply(sock, remoteJid, text, quoted, options = {}) {
    if (!quoted) {
        throw createError('reply requires a quoted message.', ErrorCodes.INVALID_OPTIONS)
    }
    return sendText(sock, remoteJid, text, quoted, options)
}

/**
 * Sends a reaction to a message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {string} emoji - Reaction emoji.
 * @param {object} key - Message key to react to.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendReact(sock, remoteJid, emoji, key, options = {}) {
    assertJid(remoteJid)
    if (typeof emoji !== 'string' || emoji.length === 0) {
        throw createError('sendReact requires an emoji.', ErrorCodes.INVALID_MESSAGE)
    }
    if (key && key.key && typeof key.key === 'object') {
        key = key.key
    }
    if (typeof key === 'string') {
        key = { id: key, remoteJid, fromMe: false }
    }
    if (!key || typeof key !== 'object' || !key.id) {
        throw createError('sendReact requires a message key.', ErrorCodes.INVALID_MESSAGE)
    }
    const msg = await generateMessage(sock, remoteJid, {
        reactionMessage: {
            text: emoji,
            key,
            senderTimestampMs: Date.now()
        }
    }, {
        quoted: resolveQuoted(null, options),
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

/**
 * Sends an image message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').MediaInput} image - Image media (Buffer, path, or URL).
 * @param {string} [caption=''] - Optional caption.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {boolean} [options.mentionAll=false] - Mention all chat participants.
 * @param {string[]} [options.mentions] - Mentioned JIDs.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendImage(sock, remoteJid, image, caption = '', quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    const { mentions, mentionAll } = await resolveMentions(sock, remoteJid, options)
    const contextInfo = buildContextInfo({
        quoted,
        expiration: options.expiration,
        mentions,
        extra: {
            ...options.contextInfo,
            ...(mentionAll ? { nonJidMentions: 1 } : {})
        }
    })
    const imageMessage = await prepareMedia(sock, 'image', image, {
        jid: remoteJid,
        mediaTypeOverride: options.mediaTypeOverride,
        engineOptions: options.engineOptions
    })
    if (caption) {
        imageMessage.caption = caption
    }
    if (Object.keys(contextInfo).length) {
        imageMessage.contextInfo = contextInfo
    }
    const msg = await generateMessage(sock, remoteJid, { imageMessage }, {
        quoted,
        messageId: options.messageId,
        ephemeralExpiration: options.expiration,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a video message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').MediaInput} video - Video media (Buffer, path, or URL).
 * @param {string} [caption=''] - Optional caption.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {boolean} [options.ptv=false] - Send as a PTV (video note, sent as `ptvMessage`).
 * @param {boolean} [options.gif=false] - Send as an animated GIF.
 * @param {boolean} [options.mentionAll=false] - Mention all chat participants.
 * @param {string[]} [options.mentions] - Mentioned JIDs.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendVideo(sock, remoteJid, video, caption = '', quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    const { mentions, mentionAll } = await resolveMentions(sock, remoteJid, options)
    const contextInfo = buildContextInfo({
        quoted,
        expiration: options.expiration,
        mentions,
        extra: {
            ...options.contextInfo,
            ...(mentionAll ? { nonJidMentions: 1 } : {})
        }
    })
    const videoMessage = await prepareMedia(sock, 'video', video, {
        jid: remoteJid,
        mediaTypeOverride: options.mediaTypeOverride,
        engineOptions: options.engineOptions,
        extraContent: {
            ...(options.ptv ? { ptv: true } : {}),
            ...(options.gif ? { gifPlayback: true } : {})
        }
    })
    if (caption) {
        videoMessage.caption = caption
    }
    if (Object.keys(contextInfo).length) {
        videoMessage.contextInfo = contextInfo
    }
    const content = options.ptv ? { ptvMessage: videoMessage } : { videoMessage }
    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: options.messageId,
        ephemeralExpiration: options.expiration,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends an audio message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').MediaInput} audio - Audio media (Buffer, path, or URL).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {boolean} [options.ptt=false] - Send as a voice note.
 * @param {string} [options.mimetype] - Audio mimetype.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendAudio(sock, remoteJid, audio, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })

    let waveform
    if (options.ptt) {
        const resolved = await resolveMedia(audio)
        const { default: audioDecode } = await import('audio-decode')
        const getAudioWaveform = getContext(sock).engine.getAudioWaveform
        if (typeof getAudioWaveform === 'function') {
            waveform = await getAudioWaveform(resolved.buffer, {
                decode: audioDecode,
                logger: getContext(sock).logger
            })
        }
    }

    const audioMessage = await prepareMedia(sock, 'audio', audio, {
        jid: remoteJid,
        mediaTypeOverride: options.mediaTypeOverride,
        engineOptions: options.engineOptions,
        extraContent: {
            ...(options.ptt ? { ptt: true } : {}),
            ...(waveform ? { waveform } : {}),
            ...(options.mimetype ? { mimetype: options.mimetype } : {})
        }
    })
    if (Object.keys(contextInfo).length) {
        audioMessage.contextInfo = contextInfo
    }
    const msg = await generateMessage(sock, remoteJid, { audioMessage }, {
        quoted,
        messageId: options.messageId,
        ephemeralExpiration: options.expiration,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a document/file message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').MediaInput} file - File media (Buffer, path, or URL).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {string} [options.fileName] - Document file name.
 * @param {string} [options.mimetype] - Document mimetype.
 * @param {string} [options.caption] - Optional caption.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendFile(sock, remoteJid, file, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })
    const documentMessage = await prepareMedia(sock, 'document', file, {
        jid: remoteJid,
        mediaTypeOverride: options.mediaTypeOverride,
        engineOptions: options.engineOptions,
        extraContent: {
            ...(options.fileName ? { fileName: options.fileName } : {}),
            ...(options.mimetype ? { mimetype: options.mimetype } : {})
        }
    })
    if (options.caption) {
        documentMessage.caption = options.caption
    }
    if (Object.keys(contextInfo).length) {
        documentMessage.contextInfo = contextInfo
    }
    const msg = await generateMessage(sock, remoteJid, { documentMessage }, {
        quoted,
        messageId: options.messageId,
        ephemeralExpiration: options.expiration,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a location message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object} location - Location payload.
 * @param {number} location.degreesLatitude - Latitude.
 * @param {number} location.degreesLongitude - Longitude.
 * @param {string} [location.name] - Location name.
 * @param {string} [location.address] - Location address.
 * @param {Buffer} [location.jpegThumbnail] - Location thumbnail.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object|null} [button=null] - Optional interactive button payload.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
/**
 * Sends a location message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object|Buffer} location - Location payload or thumbnail buffer (Buffer form uses `options.header` as name).
 * @param {number} [location.degreesLatitude] - Latitude.
 * @param {number} [location.degreesLongitude] - Longitude.
 * @param {string} [location.name] - Location name (also used as the interactive body when no caption).
 * @param {string} [location.address] - Location address.
 * @param {string} [location.url] - Location URL.
 * @param {import('../types/baileys.js').MediaInput} [location.jpegThumbnail] - Thumbnail media (resized to 300x300).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [button=null] - Optional single interactive button.
 * @param {object} [options={}] - Message options.
 * @param {string} [options.header] - Location name when `location` is a Buffer.
 * @param {string} [options.caption] - Caption text.
 * @param {string} [options.footer] - Interactive footer text (requires buttons).
 * @param {Array<object>} [options.buttons] - Interactive native flow buttons.
 * @param {object} [options.contextInfo] - Extra context info fields (merged with mentions).
 * @param {string[]} [options.mentions] - Mention JIDs.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendLocation(sock, remoteJid, location, quoted = null, button = null, options = {}) {
    assertJid(remoteJid)
    const isBufferForm = Buffer.isBuffer(location)
    if (!location || (typeof location !== 'object' && !isBufferForm)) {
        throw createError('sendLocation requires a location object.', ErrorCodes.INVALID_MESSAGE)
    }
    quoted = resolveQuoted(quoted, options)

    const source = isBufferForm ? {} : location
    const jpegThumbnailInput = isBufferForm ? location : (source.jpegThumbnail || source.thumbnail)
    let jpegThumbnail
    if (jpegThumbnailInput != null) {
        try {
            const resolved = await resolveMedia(jpegThumbnailInput)
            jpegThumbnail = await toJpegThumbnail(resolved.buffer, 300)
        } catch (error) {
            const context = getContext(sock)
            context.logger?.warn({ trace: error.stack }, 'failed to prepare location thumbnail')
            jpegThumbnail = undefined
        }
    }

    const caption = options.caption || source.caption || ''
    const mentions = options.mentions || options.mentionedJid || []
    const extraContext = { ...(options.contextInfo || {}) }
    if (Array.isArray(mentions) && mentions.length > 0) {
        extraContext.mentionedJid = mentions
    }

    const locationMessage = {
        degreesLatitude: source.degreesLatitude || source.degressLatitude || source.latitude || 0,
        degreesLongitude: source.degreesLongitude || source.degressLongitude || source.longitude || 0,
        name: source.name || options.header || '',
        address: source.address || '',
        url: source.url || '',
        ...(jpegThumbnail ? { jpegThumbnail } : {})
    }
    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: extraContext })
    if (Object.keys(contextInfo).length) {
        locationMessage.contextInfo = contextInfo
    }

    const buttons = button ? [button] : (options.buttons || [])
    let content = { locationMessage }
    let nodes = options.additionalNodes
    if (buttons.length > 0) {
        const plainButtons = buttons.map((item) => {
            if (item.name) {
                return item
            }
            return {
                buttonId: item.buttonId || item.id || `button_${Math.random().toString(36).slice(2, 8)}`,
                buttonText: {
                    displayText: item.buttonText?.displayText || item.text || item.label || ''
                },
                type: 1
            }
        })
        content = {
            buttonsMessage: {
                contentText: caption || locationMessage.name || 'Location',
                ...(options.footer ? { footerText: options.footer } : {}),
                headerType: 5,
                locationMessage,
                buttons: plainButtons,
                contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
            }
        }
        nodes = normalizeAdditionalNodes(nodes).concat(NODES.mixed)
    }

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: nodes
    })
    return msg
}

/**
 * Builds sticker EXIF metadata from sticker options.
 *
 * @param {object} options - Sticker options.
 * @param {string} [options.packname] - Sticker pack name.
 * @param {string} [options.author] - Sticker pack publisher.
 * @param {string[]} [options.categories] - Sticker emojis/categories.
 * @param {boolean} [options.isAnimated] - Animated sticker flag (EXIF `is-animated`).
 * @param {boolean} [options.isAvatar] - Avatar sticker flag (EXIF `is-avatar-sticker`).
 * @param {boolean} [options.isAiSticker] - AI sticker flag (EXIF `is-ai-sticker`).
 * @param {boolean} [options.isLottie] - Lottie sticker flag.
 * @param {number|boolean} [options.premium] - Premium sticker flag (EXIF `premium`).
 * @param {object} [options.metadata] - Additional EXIF metadata fields.
 * @returns {object} EXIF metadata object.
 */
export function buildStickerMetadata(options = {}) {
    return {
        'sticker-pack-id': options.packId || 'https://github.com/@nexray/lib',
        'sticker-pack-name': options.packname || 'Made by Nexray',
        'sticker-pack-publisher': options.author || '',
        'emojis': options.categories || [''],
        ...(options.premium ? { premium: 1 } : {}),
        ...(options.isAnimated ? { 'is-animated': 1 } : {}),
        ...(options.isAvatar ? { 'is-avatar-sticker': 1 } : {}),
        ...(options.isAiSticker ? { 'is-ai-sticker': 1 } : {}),
        ...(options.isLottie ? { 'is-lottie-sticker': 1 } : {}),
        ...(options.metadata || {})
    }
}

/**
 * Sends a sticker message.
 *
 * EXIF metadata is always embedded when a sticker is sent (pack name,
 * publisher, emojis, and premium/AI/avatar flags).
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').MediaInput} sticker - Sticker media (Buffer, path, or URL).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {string} [options.packname] - Sticker pack name (embedded via EXIF).
 * @param {string} [options.author] - Sticker pack publisher (embedded via EXIF).
 * @param {string[]} [options.categories] - Sticker emojis.
 * @param {boolean} [options.isAnimated] - Animated sticker flag.
 * @param {number} [options.stickerSentTs] - Sticker sent timestamp.
 * @param {boolean} [options.isAvatar] - Avatar sticker flag.
 * @param {boolean} [options.isAiSticker] - AI sticker flag.
 * @param {boolean} [options.isLottie] - Lottie sticker flag.
 * @param {number|boolean} [options.premium] - Premium sticker flag (also marks the message as premium sharing-limited).
 * @param {object} [options.extraFields] - Any other StickerMessage fields to set.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendSticker(sock, remoteJid, sticker, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)

    const resolved = await resolveMedia(sticker)
    let stickerBuffer = resolved.buffer
    if (!isWebP(stickerBuffer)) {
        stickerBuffer = await toWebP(stickerBuffer, { animated: false })
    }
    stickerBuffer = setWebpExif(stickerBuffer, buildStickerMetadata(options))

    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })
    const stickerMessage = await prepareMedia(sock, 'sticker', stickerBuffer, {
        jid: remoteJid,
        mediaTypeOverride: options.mediaTypeOverride,
        engineOptions: options.engineOptions
    })
    const stickerExtras = {}
    for (const key of ['isAnimated', 'stickerSentTs', 'isAvatar', 'isAiSticker', 'isLottie', 'premium']) {
        if (options[key] !== undefined) {
            stickerExtras[key] = options[key]
        }
    }
    if (options.extraFields && typeof options.extraFields === 'object') {
        Object.assign(stickerExtras, options.extraFields)
    }
    if (Object.keys(stickerExtras).length) {
        Object.assign(stickerMessage, stickerExtras)
    }
    if (Object.keys(contextInfo).length) {
        stickerMessage.contextInfo = contextInfo
    }

    const content = { stickerMessage }
    if (options.premium || options.isAiSticker === true || options.isAvatar === true) {
        content.messageContextInfo = {
            limitSharingV2: {
                sharingLimited: true,
                trigger: 1,
                limitSharingSettingTimestamp: Date.now(),
                initiatedByMe: true
            }
        }
    }

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a sticker pack message.
 *
 * Accepts a plain array of stickers (Buffer, path, URL, or
 * `{ media, name, emojis, accessibilityLabel }` items). The legacy
 * `{ stickers, cover, name, publisher, description }` payload object is
 * still supported.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {Array<import('../types/baileys.js').MediaInput|object>|import('../types/utils.js').StickerPackPayload} stickers - Sticker pack stickers.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {import('../types/baileys.js').MediaInput} [options.cover] - Sticker pack cover image.
 * @param {string} [options.caption] - Sticker pack caption/description.
 * @param {string} [options.name] - Sticker pack name.
 * @param {string} [options.publisher] - Sticker pack publisher.
 * @param {string[]} [options.emojis] - Sticker pack default emojis.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendStickerPack(sock, remoteJid, stickers, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)

    const legacy = stickers && !Array.isArray(stickers) && typeof stickers === 'object'
        ? stickers
        : null
    const stickerItems = legacy ? legacy.stickers : stickers
    if (!Array.isArray(stickerItems) || stickerItems.length < 1) {
        throw createError('sendStickerPack requires a stickers array.', ErrorCodes.INVALID_MESSAGE)
    }

    const payload = await buildStickerPackPayload({
        stickers: stickerItems,
        cover: options.cover ?? legacy?.cover,
        name: options.name ?? legacy?.name,
        publisher: options.publisher ?? legacy?.publisher,
        description: options.caption ?? options.description ?? legacy?.description ?? legacy?.caption,
        emojis: options.emojis ?? legacy?.emojis
    }, sock, options)

    const msg = await generateMessage(sock, remoteJid, payload, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Validates album media items and computes expected media counts.
 *
 * @param {Array<object>} items - Album items.
 * @returns {{ imageCount: number, videoCount: number }} Media counts.
 * @throws {NexrayError} INVALID_MESSAGE when the album is invalid.
 */
export function validateAlbum(items) {
    if (!Array.isArray(items) || items.length < 1) {
        throw createError('sendAlbum requires at least 1 media item.', ErrorCodes.INVALID_MESSAGE)
    }
    let imageCount = 0
    let videoCount = 0
    for (const item of items) {
        if (item?.image) {
            imageCount++
        } else if (item?.video) {
            videoCount++
        } else {
            throw createError('Each album item must contain an image or video.', ErrorCodes.INVALID_MESSAGE)
        }
    }
    if (imageCount + videoCount < 1) {
        throw createError('Minimum provide 1 media to upload album message.', ErrorCodes.INVALID_MESSAGE)
    }
    return { imageCount, videoCount }
}

/**
 * Sends an album (multiple media grouped in one bubble).
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {Array<{image?: import('../types/baileys.js').MediaInput, video?: import('../types/baileys.js').MediaInput, caption?: string}>} items - Album items.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} The album root WAMessage.
 */
export async function sendAlbum(sock, remoteJid, items, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    const { imageCount, videoCount } = validateAlbum(items)

    const albumContent = {
        messageContextInfo: {
            messageSecret: makeMessageSecret()
        },
        albumMessage: {
            expectedImageCount: imageCount,
            expectedVideoCount: videoCount
        }
    }

    const album = await generateMessage(sock, remoteJid, albumContent, {
        quoted,
        messageId: options.messageId,
        ephemeralExpiration: options.expiration,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, album.message, {
        messageId: album.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })

    await Promise.all(items.map(async (item) => {
        const mediaType = item.image ? 'image' : 'video'
        const mediaMessage = await prepareMedia(sock, mediaType, item.image || item.video, {
            jid: remoteJid,
            engineOptions: options.engineOptions,
            extraContent: item.caption ? { caption: item.caption } : {}
        })
        const mediaMsg = await generateMessage(sock, remoteJid, { [mediaType + 'Message']: mediaMessage }, {
            messageId: options.messageId,
            engineOptions: options.engineOptions
        })
        mediaMsg.message.messageContextInfo = {
            messageSecret: makeMessageSecret(),
            messageAssociation: {
                associationType: 1,
                parentMessageKey: album.key
            }
        }
        return relayMessage(sock, remoteJid, mediaMsg.message, {
            messageId: mediaMsg.key.id
        })
    }))

    return album
}

/**
 * Builds an interactive message payload from options.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {object} payload - Interactive payload.
 * @returns {Promise<{content: object, nodes: object[]}>} Interactive content and nodes.
 */
export async function buildInteractiveMessage(sock, payload = {}) {
    const contextInfo = buildContextInfo({
        quoted: payload.quoted || null,
        mentions: payload.mentions || payload.mentionedJid,
        extra: payload.contextInfo
    })
    const interactiveMessage = {
        body: { text: payload.text || payload.caption || '' }
    }
    if (payload.footer) {
        interactiveMessage.footer = { text: payload.footer }
    }
    if (Object.keys(contextInfo).length) {
        interactiveMessage.contextInfo = contextInfo
    }

    const buttons = normalizeFlowButtons(payload.interactiveButtons || payload.buttons || [])
    let messageParamsJson = payload.messageParamsJson ?? payload.paramsJson
    if (messageParamsJson != null && typeof messageParamsJson === 'object') {
        try {
            messageParamsJson = JSON.stringify(messageParamsJson)
        } catch (error) {
            throw createError('messageParamsJson must contain valid JSON.', ErrorCodes.INVALID_OPTIONS, { cause: error })
        }
    }
    interactiveMessage.nativeFlowMessage = {
        buttons,
        messageParamsJson: messageParamsJson || ''
    }

    const headerContext = Object.keys(contextInfo).length ? contextInfo : undefined
    let header = null

    if (payload.image) {
        const imageMessage = await prepareMedia(sock, 'image', payload.image, {
            jid: payload.jid,
            engineOptions: payload.engineOptions
        })
        header = {
            title: payload.title || '',
            hasMediaAttachment: true,
            imageMessage,
            ...(headerContext ? { contextInfo: headerContext } : {})
        }
    } else if (payload.video) {
        const videoMessage = await prepareMedia(sock, 'video', payload.video, {
            jid: payload.jid,
            engineOptions: payload.engineOptions
        })
        header = {
            title: payload.title || '',
            hasMediaAttachment: true,
            videoMessage,
            ...(headerContext ? { contextInfo: headerContext } : {})
        }
    } else if (payload.location && typeof payload.location === 'object') {
        const thumb = payload.location.jpegThumbnail || payload.location.thumbnail
        let jpegThumbnail
        if (thumb) {
            try {
                const resolved = await resolveMedia(thumb)
                jpegThumbnail = await toJpegThumbnail(resolved.buffer, 300)
            } catch (error) {
                jpegThumbnail = undefined
            }
        }
        header = {
            title: payload.title || payload.location.name || 'Location',
            hasMediaAttachment: !!jpegThumbnail,
            locationMessage: {
                degreesLatitude: payload.location.degreesLatitude || payload.location.degressLatitude || 0,
                degreesLongitude: payload.location.degreesLongitude || payload.location.degressLongitude || 0,
                name: payload.location.name || '',
                address: payload.location.address || '',
                ...(jpegThumbnail ? { jpegThumbnail } : {})
            },
            ...(headerContext ? { contextInfo: headerContext } : {})
        }
    } else if (payload.title) {
        header = {
            title: payload.title,
            hasMediaAttachment: false,
            ...(headerContext ? { contextInfo: headerContext } : {})
        }
    }
    if (header) {
        interactiveMessage.header = header
    }

    if (payload.bizJid) {
        interactiveMessage.collectionMessage = {
            bizJid: payload.bizJid,
            id: payload.id || `collection_${Date.now()}`,
            messageVersion: 1
        }
    } else if (payload.shopSurface) {
        interactiveMessage.shopStorefrontMessage = {
            surface: payload.shopSurface,
            id: payload.id || `shop_${Date.now()}`,
            messageVersion: 1
        }
    }

    const nodes = normalizeAdditionalNodes(payload.additionalNodes)
    if (payload.attachInteractiveNode !== false) {
        nodes.push(...NODES.mixed)
    }
    return { content: { interactiveMessage }, nodes }
}

/**
 * Sends an interactive (native flow) message.
 *
 * Supports multiple call forms:
 * - `sendInteractive(jid, payload, quoted, options)`
 * - `sendInteractive(jid, payload, options)`
 * - `sendInteractive(jid, buttons, quoted, options)`
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object|object[]} payloadOrButtons - Interactive payload or button array.
 * @param {object|null|object[]} [quotedOrOptions] - Quoted message or options.
 * @param {object} [maybeOptions] - Options when quoted is provided positionally.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendInteractive(sock, remoteJid, payloadOrButtons, quotedOrOptions, maybeOptions) {
    assertJid(remoteJid)
    let quoted = null
    let options = {}
    let payload = payloadOrButtons

    if (Array.isArray(payloadOrButtons)) {
        payload = { interactiveButtons: payloadOrButtons }
    }
    if (isQuotedLike(quotedOrOptions)) {
        quoted = quotedOrOptions
        options = maybeOptions || {}
    } else {
        options = quotedOrOptions || {}
    }

    const { content, nodes } = await buildInteractiveMessage(sock, {
        ...payload,
        jid: remoteJid,
        quoted,
        engineOptions: options.engineOptions
    })

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: nodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Checks whether a value looks like a quoted message object.
 *
 * @param {unknown} value - Value to test.
 * @returns {boolean} True when the value looks like a quoted message.
 */
export function isQuotedLike(value) {
    return !!value && typeof value === 'object' &&
        !Array.isArray(value) &&
        (value.key || value.id || value.remoteJid || value.message)
}

/**
 * Builds the vcard string for a contact payload.
 *
 * Supports both shorthand fields (`name`, `org`, `email`, `website`,
 * `location`, `other`, `number`) and classic fields (`fullName`,
 * `organization`, `url`, `address`, `note`, `phone`), plus business card
 * fields (`bizName` -> X-WA-BIZ-NAME, `bizDescription` ->
 * X-WA-BIZ-DESCRIPTION).
 *
 * @param {import('../types/baileys.js').ContactPayload} contact - Contact payload.
 * @returns {string} VCard 3.0 string.
 */
export function buildVCard(contact) {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0']
    const name = contact.name || contact.fullName
    if (name) {
        lines.push(`N:${name};;;;`)
        lines.push(`FN:${name}`)
    }
    const org = contact.org || contact.organization
    if (org) {
        lines.push(`ORG:${org}`)
    }
    if (Array.isArray(contact.phones)) {
        for (const phone of contact.phones) {
            const number = typeof phone === 'string' ? phone : phone.number
            const type = typeof phone === 'string' ? 'WORK' : (phone.type || 'WORK')
            lines.push(`TEL;TYPE=${type};waid=${String(number).replace(/\D/g, '')}:${number}`)
        }
    } else {
        const number = contact.number || contact.phone
        if (number) {
            lines.push(`TEL;TYPE=WORK;waid=${String(number).replace(/\D/g, '')}:${number}`)
        }
    }
    if (contact.email) {
        lines.push(`EMAIL;type=INTERNET:${contact.email}`)
    }
    const url = contact.website || contact.url
    if (url) {
        lines.push(`URL:${url}`)
    }
    const address = contact.location || contact.address
    if (address) {
        lines.push(`ADR;TYPE=WORK:;;${address};;;`)
    }
    const note = contact.other || contact.note
    if (note) {
        lines.push(`NOTE:${note}`)
    }
    const bizName = contact.title || contact.bizName || contact.businessName
    if (bizName) {
        lines.push(`X-WA-BIZ-NAME:${bizName}`)
    }
    const bizDescription = contact.description ?? contact.bizDescription ?? contact.businessDescription
    if (bizDescription !== undefined) {
        lines.push(`X-WA-BIZ-DESCRIPTION:${bizDescription}`)
    }
    lines.push('END:VCARD')
    return lines.join('\n')
}

/**
 * Sends a contact message.
 *
 * Accepts a single contact object, an array of contacts (combined into one
 * vcard), or a raw vcard string.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').ContactPayload|import('../types/baileys.js').ContactPayload[]|string} contact - Contact payload, array of contacts, or raw vcard.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendContact(sock, remoteJid, contact, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    let vcard
    let displayName = ''
    if (typeof contact === 'string') {
        vcard = contact
        displayName = (contact.match(/^FN:(.*)$/m)?.[1] || '').trim()
    } else {
        const contacts = Array.isArray(contact) ? contact : [contact]
        if (contacts.length === 0) {
            throw createError('sendContact requires at least one contact.', ErrorCodes.INVALID_MESSAGE)
        }
        displayName = contacts.map((item) => item.name || item.fullName || '').join(', ')
        vcard = contacts.map((item) => buildVCard(item)).join('')
    }
    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })
    const contactMessage = {
        displayName,
        vcard,
        contextInfo: Object.keys(contextInfo).length ? contextInfo : undefined
    }
    const msg = await generateMessage(sock, remoteJid, { contactMessage }, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a product message with native flow buttons.
 *
 * The `{ productMessage }` protobuf payload is built here directly so the
 * engine does not re-upload the product image: `productImage` is prepared
 * once and embedded.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object} product - Product payload.
 * @param {import('../types/baileys.js').MediaInput} product.image - Product image (Buffer, URL, or path).
 * @param {string} product.title - Product title.
 * @param {string} product.productId - Product ID.
 * @param {string} [product.currencyCode] - Currency code (e.g. 'IDR').
 * @param {number} [product.price] - Price in rupiah (converted to `priceAmount1000`).
 * @param {number} [product.priceAmount1000] - Price in 1000ths (takes precedence over `price`).
 * @param {number} [product.productImageCount=1] - Number of product images.
 * @param {string} [product.firstImageUrl] - First image URL.
 * @param {number} [product.salePriceAmount1000] - Sale price in 1000ths.
 * @param {string} [product.retailerId] - Retailer ID.
 * @param {string} product.businessOwnerJid - Business owner JID.
 * @param {string} [product.caption] - Caption text.
 * @param {string} [product.footer] - Footer text.
 * @param {Array<object>} [product.interactiveButtons] - Native flow buttons (`{ name, buttonParamsJson }`).
 * @param {Array<object>} [product.buttons] - Alias for interactiveButtons.
 * @param {boolean} [product.hasMediaAttachment=true] - Whether the product has a media attachment.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendProduct(sock, remoteJid, product, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    if (!product || typeof product !== 'object') {
        throw createError('sendProduct requires a product object.', ErrorCodes.INVALID_MESSAGE)
    }
    if (!product.productId) {
        throw createError('sendProduct requires a productId.', ErrorCodes.INVALID_MESSAGE)
    }
    if (!product.businessOwnerJid) {
        throw createError('sendProduct requires a businessOwnerJid.', ErrorCodes.INVALID_MESSAGE)
    }

    let productImage = product.image ?? product.productImage
    if (productImage != null) {
        if (productImage && typeof productImage === 'object' && !Buffer.isBuffer(productImage)
            && (productImage.mediaKey || productImage.directPath)) {
            // Already a prepared ImageMessage — pass it through untouched.
        } else {
            productImage = await prepareMedia(sock, 'image', productImage, {
                jid: remoteJid,
                mediaTypeOverride: options.mediaTypeOverride,
                engineOptions: options.engineOptions
            })
        }
    }

    const buttons = product.interactiveButtons || product.buttons || []
    const productMessage = {
        product: {
            productImage,
            title: product.title || '',
            productId: product.productId,
            currencyCode: product.currencyCode,
            priceAmount1000: product.priceAmount1000 ?? (product.price != null ? product.price * 1000 : undefined),
            productImageCount: product.productImageCount ?? 1,
            firstImageUrl: product.firstImageUrl,
            salePriceAmount1000: product.salePriceAmount1000,
            retailerId: product.retailerId
        },
        businessOwnerJid: product.businessOwnerJid,
        caption: product.caption,
        footer: product.footer,
        hasMediaAttachment: product.hasMediaAttachment !== false
    }
    if (buttons.length) {
        productMessage.interactiveButtons = buttons
    }
    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })
    if (Object.keys(contextInfo).length) {
        productMessage.contextInfo = contextInfo
    }

    const msg = await generateMessage(sock, remoteJid, { productMessage }, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

/**
 * Sends a live photo message (paired photo + video).
 *
 * The image message is relayed first with `contextInfo.pairedMediaType = 5`,
 * then the video message follows with `pairedMediaType = 6` and a
 * `messageAssociation` (type 12) pointing at the image message key.
 * The image is optional — when omitted it is derived from the video
 * thumbnail.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object|import('../types/baileys.js').MediaInput} media - `{ video, image? }` payload.
 * @param {import('../types/baileys.js').MediaInput} media.video - Live photo video.
 * @param {import('../types/baileys.js').MediaInput} [media.image] - Live photo image (falls back to the video thumbnail).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @param {string} [options.caption] - Optional caption.
 * @returns {Promise<object>} Generated WAMessage (the video message).
 */
export async function sendLivePhoto(sock, remoteJid, media, videoOrQuoted = null, quotedOrOptions = null, maybeOptions = {}) {
    assertJid(remoteJid)

    let image
    let video
    let quoted
    let options
    if (media && typeof media === 'object' && !Buffer.isBuffer(media) && !Array.isArray(media) && media.video) {
        image = media.image
        video = media.video
        quoted = resolveQuoted(videoOrQuoted, quotedOrOptions)
        options = quotedOrOptions && typeof quotedOrOptions === 'object' && !(quotedOrOptions.key || quotedOrOptions.message)
            ? quotedOrOptions
            : maybeOptions
    } else {
        image = media
        video = videoOrQuoted
        quoted = resolveQuoted(quotedOrOptions, maybeOptions)
        options = maybeOptions
    }
    const context = getContext(sock)

    const videoMessage = await prepareMedia(sock, 'video', video, {
        jid: remoteJid,
        engineOptions: options.engineOptions,
        extraContent: {
            contextInfo: { pairedMediaType: 6, statusSourceType: 0 }
        }
    })

    if (!image) {
        if (videoMessage.jpegThumbnail) {
            image = videoMessage.jpegThumbnail
        } else {
            const generateThumbnail = context.engine.generateThumbnail
            if (typeof generateThumbnail === 'function') {
                const resolvedVideo = await resolveMedia(video)
                const { thumbnail } = await generateThumbnail(resolvedVideo.buffer, 'video', {
                    logger: context.logger
                })
                if (thumbnail) {
                    image = thumbnail
                }
            }
        }
    }

    let imageMsg = null
    if (image != null) {
        const imageMessage = await prepareMedia(sock, 'image', image, {
            jid: remoteJid,
            engineOptions: options.engineOptions,
            extraContent: {
                contextInfo: { pairedMediaType: 5, statusSourceType: 0 }
            }
        })

        const generateThumbnail = context.engine.generateThumbnail
        if (typeof generateThumbnail === 'function' && !imageMessage.jpegThumbnail) {
            const resolvedImage = await resolveMedia(image)
            const { thumbnail, originalImageDimensions } = await generateThumbnail(resolvedImage.buffer, 'image', {
                logger: context.logger
            })
            if (thumbnail) {
                imageMessage.jpegThumbnail = thumbnail
            }
            if (originalImageDimensions) {
                imageMessage.originalImageDimensions = originalImageDimensions
            }
        }

        if (options.caption) {
            imageMessage.caption = options.caption
        }
        const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })
        if (Object.keys(contextInfo).length) {
            imageMessage.contextInfo = { ...imageMessage.contextInfo, ...contextInfo }
        }

        imageMsg = await generateMessage(sock, remoteJid, { imageMessage }, {
            quoted,
            messageId: options.messageId,
            engineOptions: options.engineOptions
        })
        await relayMessage(sock, remoteJid, imageMsg.message, {
            messageId: imageMsg.key.id,
            additionalAttributes: options.additionalAttributes,
            additionalNodes: options.additionalNodes,
            recipientOverrides: options.recipientOverrides,
            specificRecipient: options.specificRecipient
        })
    }

    const videoContent = { videoMessage }
    if (imageMsg) {
        videoContent.messageContextInfo = {
            messageAssociation: {
                associationType: 12,
                parentMessageKey: imageMsg.key
            }
        }
    }
    const videoMsg = await generateMessage(sock, remoteJid, videoContent, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, videoMsg.message, {
        messageId: videoMsg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return videoMsg
}

/**
 * Resolves the display dimension for a link preview thumbnail.
 *
 * @param {'landscape'|'portrait'|'square'|string} [ratio='landscape'] - Target ratio.
 * @returns {{ height: number, width: number }} Image dimensions.
 */
export const dimension = (ratio = 'landscape') => ({
    landscape: { height: 1080, width: 1920 },
    portrait:  { height: 1920, width: 1080 },
    square:    { height: 1080, width: 1080 }
})[String(ratio).toLowerCase()] ?? { height: 1080, width: 1920 }

/**
 * Sends a text message with a link thumbnail preview.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {string} text - Message text.
 * @param {object} [opts={}] - Link preview options.
 * @param {string} [opts.title=''] - Preview title.
 * @param {string} [opts.body=''] - Preview description.
 * @param {boolean} [opts.largeThumb=false] - Use a large (high quality) thumbnail.
 * @param {'landscape'|'portrait'|'square'} [opts.ratio='landscape'] - Thumbnail ratio when largeThumb is true.
 * @param {import('../types/baileys.js').MediaInput} [opts.thumbnail] - Thumbnail media (Buffer, URL, or path).
 * @param {string} [opts.url=''] - Preview link (matched-text).
 * @param {import('../types/baileys.js').MediaInput} [opts.icon] - Favicon media (Buffer, URL, or path).
 * @param {number} [opts.duration=0] - linkMediaDuration in seconds (video/audio content).
 * @param {number} [opts.postType=1] - socialMediaPostType: 0=NONE, 1=REEL, 2=LIVE_VIDEO, 3=LONG_VIDEO, 4=SINGLE_IMAGE, 5=CAROUSEL.
 * @param {object|null} [message=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendThumbnailPreview(sock, remoteJid, text, opts = {}, message = null, options = {}) {
    assertJid(remoteJid)
    if (!text || typeof text !== 'string') {
        throw createError('Parameter text harus berupa string yang tidak kosong', ErrorCodes.INVALID_MESSAGE)
    }

    const { title = '', body = '', largeThumb = false, ratio = 'landscape', thumbnail = null, url = '', icon = null, duration = 0, postType = 1 } = opts

    const thumbBuffer = thumbnail != null ? (await resolveMedia(thumbnail)).buffer : null
    const linkPreviewBase = {
        'matched-text': url,
        title,
        description: body,
        previewType: 0,
        ...(thumbBuffer && { jpegThumbnail: thumbBuffer })
    }

    let content
    if (!largeThumb) {
        content = { text, linkPreview: linkPreviewBase }
    } else {
        if (!thumbBuffer) {
            throw createError('Parameter thumbnail wajib diisi untuk largeThumb: true', ErrorCodes.INVALID_MESSAGE)
        }
        const image = await prepareMedia(sock, 'image', thumbBuffer, {
            jid: remoteJid,
            mediaTypeOverride: 'thumbnail-link',
            engineOptions: options.engineOptions
        })
        Object.assign(image, dimension(ratio))

        const faviconBuffer = icon != null ? (await resolveMedia(icon)).buffer : null
        content = {
            text,
            linkPreview: {
                ...linkPreviewBase,
                highQualityThumbnail: image,
                linkPreviewMetadata: { linkMediaDuration: duration, socialMediaPostType: postType }
            },
            ...(faviconBuffer && { favicon: faviconBuffer })
        }
    }

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted: message || null,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

/**
 * Normalizes flow/native buttons into the protobuf shape.
 *
 * `buttonParamsJson` objects are JSON-stringified (the engine expects a
 * string) and the `paramsJson` alias is folded in.
 *
 * @param {Array<object>} [buttons=[]] - Raw buttons.
 * @returns {Array<{name: string, buttonParamsJson: string}>} Normalized buttons.
 * @throws {NexrayError} INVALID_OPTIONS when buttons is not an array.
 */
export function normalizeFlowButtons(buttons = []) {
    if (!Array.isArray(buttons)) {
        throw createError('Buttons must be an array.', ErrorCodes.INVALID_OPTIONS)
    }
    return buttons.map((button) => {
        const params = button.buttonParamsJson ?? button.paramsJson
        const normalized = { ...button }
        if (params != null && typeof params === 'object') {
            try {
                normalized.buttonParamsJson = JSON.stringify(params)
            } catch (error) {
                throw createError('buttonParamsJson must contain valid JSON.', ErrorCodes.INVALID_OPTIONS, { cause: error })
            }
        }
        delete normalized.paramsJson
        return normalized
    })
}

/**
 * Sends a carousel card message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/utils.js').CardPayload} payload - Card payload.
 * @param {string} [payload.text=''] - Carousel body text.
 * @param {string} [payload.footer] - Carousel footer text.
 * @param {Array<object>} payload.cards - Card entries.
 * @param {import('../types/baileys.js').MediaInput} payload.cards[].image - Card image.
 * @param {import('../types/baileys.js').MediaInput} payload.cards[].video - Card video.
 * @param {string} [payload.cards[].caption] - Card body text.
 * @param {string} [payload.cards[].title] - Card header title.
 * @param {string} [payload.cards[].subtitle] - Card header subtitle.
 * @param {string} [payload.cards[].footer] - Card footer text.
 * @param {Array<object>} [payload.cards[].buttons] - Card native flow buttons (`{ name, buttonParamsJson }`).
 * @param {Array<object>} [payload.cards[].interactiveButtons] - Alias for buttons.
 * @param {Array<object>} [payload.cards[].nativeFlow] - Alias for buttons.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendCard(sock, remoteJid, payload, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    if (!payload || !Array.isArray(payload.cards) || payload.cards.length === 0) {
        throw createError('sendCard requires a cards array.', ErrorCodes.INVALID_MESSAGE)
    }
    const cards = []
    for (const card of payload.cards) {
        if (!card.image && !card.video) {
            throw createError('Each card requires an image or video.', ErrorCodes.INVALID_MESSAGE)
        }
        const buttons = normalizeFlowButtons(card.buttons || card.interactiveButtons || card.nativeFlow)
        let mediaMessage
        let mediaKey
        if (card.image) {
            mediaMessage = await prepareMedia(sock, 'image', card.image, {
                jid: remoteJid,
                engineOptions: options.engineOptions
            })
            mediaKey = 'imageMessage'
        } else {
            mediaMessage = await prepareMedia(sock, 'video', card.video, {
                jid: remoteJid,
                engineOptions: options.engineOptions
            })
            mediaKey = 'videoMessage'
        }
        const entry = {
            nativeFlowMessage: {
                buttons,
                messageParamsJson: card.messageParamsJson != null
                    ? (typeof card.messageParamsJson === 'object'
                        ? JSON.stringify(card.messageParamsJson)
                        : card.messageParamsJson)
                    : ''
            },
            header: {
                title: card.title || '',
                subtitle: card.subtitle || '',
                hasMediaAttachment: true,
                [mediaKey]: mediaMessage
            },
            body: { text: card.caption || card.text || '' }
        }
        if (card.footer) {
            entry.footer = { text: card.footer }
        }
        cards.push(entry)
    }
    const contextInfo = buildContextInfo({
        quoted,
        expiration: options.expiration,
        extra: payload.contextInfo || options.contextInfo
    })
    const interactiveMessage = {
        body: { text: payload.text || payload.caption || '' },
        carouselMessage: {
            cards,
            carouselCardType: 0,
            messageVersion: 1
        }
    }
    if (payload.footer) {
        interactiveMessage.footer = { text: payload.footer }
    }
    if (Object.keys(contextInfo).length) {
        interactiveMessage.contextInfo = contextInfo
    }
    const msg = await generateMessage(sock, remoteJid, { interactiveMessage }, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: normalizeAdditionalNodes(options.additionalNodes).concat(NODES.mixed),
        recipientOverrides: options.recipientOverrides,
        specificRecipient: options.specificRecipient
    })
    return msg
}

/**
 * Sends a poll message.
 *
 * New form: `sendPoll(jid, values, quoted?, options?)` with
 * `options.name` as the question.
 * Legacy form: `sendPoll(jid, name, values, options?, quotedOrOptions?)`
 * is still supported.
 *
 * A single-select poll (`selectableCount === 1`) is sent as
 * `pollCreationMessageV3`, and `toAnnouncementGroup` polls use
 * `pollCreationMessageV2`.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {string|string[]} nameOrValues - Poll question (legacy) or poll options (new form).
 * @param {string[]|object|null} valuesOrQuoted - Poll options (legacy) or quoted message (new form).
 * @param {object|null} [options=null] - Poll options or quoted message (legacy form).
 * @param {object} [quotedOrOptions={}] - Quoted message or options (legacy form).
 * @param {string} [options.name] - Poll question (new form).
 * @param {number} [options.selectableCount=0] - Number of selectable options.
 * @param {number} [options.selectableOptionsCount] - Alias for selectableCount.
 * @param {boolean} [options.toAnnouncementGroup=false] - Send as an announcement-group poll.
 * @param {Date|number} [options.endDate] - Poll end date (ms).
 * @param {boolean} [options.hideVoter=false] - Hide voters.
 * @param {boolean} [options.canAddOption=false] - Allow adding options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendPoll(sock, remoteJid, nameOrValues, valuesOrQuoted = null, options = null, quotedOrOptions = {}) {
    assertJid(remoteJid)

    let name
    let values
    let pollOptions = {}
    let quoted = null
    let messageOptions = {}

    if (Array.isArray(nameOrValues)) {
        values = nameOrValues
        if (values.length === 0) {
            throw createError('sendPoll requires poll options.', ErrorCodes.INVALID_MESSAGE)
        }
        name = (options && typeof options === 'object' && options.name) || ''
        if (typeof name !== 'string' || name.length === 0) {
            throw createError('sendPoll requires a poll name (options.name).', ErrorCodes.INVALID_MESSAGE)
        }
        quoted = resolveQuoted(valuesOrQuoted, quotedOrOptions)
        pollOptions = (options && typeof options === 'object' && !isQuotedLike(options)) ? options : {}
        messageOptions = pollOptions
    } else {
        name = nameOrValues
        values = valuesOrQuoted
        if (typeof name !== 'string' || name.length === 0) {
            throw createError('sendPoll requires a poll name.', ErrorCodes.INVALID_MESSAGE)
        }
        if (!Array.isArray(values) || values.length === 0) {
            throw createError('sendPoll requires poll options.', ErrorCodes.INVALID_MESSAGE)
        }
        if (isQuotedLike(options)) {
            quoted = options
            messageOptions = quotedOrOptions || {}
        } else if (options && typeof options === 'object') {
            pollOptions = options
            if (isQuotedLike(quotedOrOptions)) {
                quoted = quotedOrOptions
            } else {
                messageOptions = quotedOrOptions || {}
            }
        }
        quoted = resolveQuoted(quoted, messageOptions)
    }

    const selectableCount = pollOptions.selectableCount ?? pollOptions.selectableOptionsCount ?? 0
    const optionsPayload = values.map((optionName) => ({ optionName }))
    const pollBase = {
        name,
        options: optionsPayload,
        selectableOptionsCount: selectableCount,
        endTime: pollOptions.endDate != null
            ? (pollOptions.endDate instanceof Date ? pollOptions.endDate.getTime() : Number(pollOptions.endDate))
            : undefined,
        hideParticipantName: pollOptions.hideVoter ?? false,
        allowAddOption: pollOptions.canAddOption ?? false
    }

    let content
    if (selectableCount === 1) {
        content = { pollCreationMessageV3: pollBase }
    } else if (pollOptions.toAnnouncementGroup === true) {
        content = { pollCreationMessageV2: { ...pollBase, toAnnouncementGroup: true } }
    } else {
        content = { pollCreationMessage: pollBase }
    }
    content.messageContextInfo = { messageSecret: makeMessageSecret() }

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: messageOptions.messageId,
        engineOptions: messageOptions.engineOptions
    })
    const nodes = normalizeAdditionalNodes(messageOptions.additionalNodes).concat(NODES.poll_creation)
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: messageOptions.additionalAttributes,
        additionalNodes: nodes
    })
    return msg
}

/**
 * Sends a quiz (poll with a single correct answer). Newsletters only.
 *
 * New form: `sendQuiz(jid, values, quoted?, options?)` with
 * `options.name` and `options.correctAnswer`.
 * Legacy form: `sendQuiz(jid, name, values, correctOption, quoted?, options?)`
 * is still supported.
 *
 * Quizzes are sent as `pollCreationMessageV5` with `pollType: 1`.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID (must be a newsletter).
 * @param {string|string[]} nameOrValues - Quiz question (legacy) or quiz options (new form).
 * @param {string[]|number|object|null} valuesOrCorrect - Quiz options (legacy), correct option index (legacy), or quoted message (new form).
 * @param {number|object|null} [correctOrQuoted=null] - Correct option index (legacy) or quoted message (new form).
 * @param {object|null} [quoted=null] - Optional quoted message (legacy form).
 * @param {object} [options={}] - Quiz options (legacy form).
 * @param {string} [options.name] - Quiz question (new form).
 * @param {string} [options.correctAnswer] - Correct option text (new form).
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendQuiz(sock, remoteJid, nameOrValues, valuesOrCorrect = null, correctOrQuoted = null, quoted = null, options = {}) {
    assertJid(remoteJid)
    if (!isJidNewsletter(remoteJid)) {
        throw createError('sendQuiz requires a newsletter JID.', ErrorCodes.INVALID_JID)
    }

    let name
    let values
    let correctOption = null
    let quotedMessage = null
    let messageOptions = {}

    if (Array.isArray(nameOrValues)) {
        values = nameOrValues
        if (values.length === 0) {
            throw createError('sendQuiz requires quiz options.', ErrorCodes.INVALID_MESSAGE)
        }
        const quizOptions = (correctOrQuoted && typeof correctOrQuoted === 'object' && !isQuotedLike(correctOrQuoted))
            ? correctOrQuoted
            : (options && typeof options === 'object') ? options : {}
        name = quizOptions.name || ''
        if (typeof name !== 'string' || name.length === 0) {
            throw createError('sendQuiz requires a quiz name (options.name).', ErrorCodes.INVALID_MESSAGE)
        }
        correctOption = quizOptions.correctAnswer
        quotedMessage = resolveQuoted(valuesOrCorrect, correctOrQuoted)
        messageOptions = quizOptions
    } else {
        name = nameOrValues
        values = valuesOrCorrect
        if (typeof name !== 'string' || name.length === 0) {
            throw createError('sendQuiz requires a quiz name.', ErrorCodes.INVALID_MESSAGE)
        }
        if (!Array.isArray(values) || values.length === 0) {
            throw createError('sendQuiz requires quiz options.', ErrorCodes.INVALID_MESSAGE)
        }
        if (typeof correctOrQuoted === 'number') {
            correctOption = correctOrQuoted
            quotedMessage = resolveQuoted(quoted, options)
            messageOptions = options || {}
        } else {
            correctOption = valuesOrCorrect
            if (typeof correctOrQuoted === 'object' && !isQuotedLike(correctOrQuoted)) {
                messageOptions = correctOrQuoted
                quotedMessage = resolveQuoted(quoted, correctOrQuoted)
            } else {
                quotedMessage = resolveQuoted(correctOrQuoted, options)
                messageOptions = options || {}
            }
        }
    }

    let correctAnswer
    if (typeof correctOption === 'number') {
        if (correctOption < 1 || correctOption > values.length) {
            throw createError('sendQuiz requires a valid correctOption (1-based index).', ErrorCodes.INVALID_MESSAGE)
        }
        correctAnswer = values[correctOption - 1]
    } else if (typeof correctOption === 'string') {
        if (!values.includes(correctOption)) {
            throw createError('sendQuiz requires correctAnswer to match one of the options.', ErrorCodes.INVALID_MESSAGE)
        }
        correctAnswer = correctOption
    } else {
        throw createError('sendQuiz requires a correct answer (correctAnswer string or 1-based index).', ErrorCodes.INVALID_MESSAGE)
    }

    const content = {
        pollCreationMessageV5: {
            name,
            options: values.map((optionName) => ({ optionName })),
            selectableOptionsCount: 1,
            pollType: 1,
            correctAnswer: { optionName: correctAnswer }
        }
    }
    content.messageContextInfo = { messageSecret: makeMessageSecret() }

    const msg = await generateMessage(sock, remoteJid, content, {
        quoted: quotedMessage,
        messageId: messageOptions.messageId,
        engineOptions: messageOptions.engineOptions
    })
    const nodes = normalizeAdditionalNodes(messageOptions.additionalNodes).concat(NODES.quiz_creation)
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: messageOptions.additionalAttributes,
        additionalNodes: nodes
    })
    return msg
}

/**
 * Sends a poll result (a message revealing the poll answer).
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {string} name - Poll question.
 * @param {string[]} values - Poll options.
 * @param {object} key - The poll message key.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendPollResult(sock, remoteJid, name, values, key, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    const pollUpdateMessageKey = key
    const pollUpdateMessageEncKey = randomBytes(32)
    const msg = await generateMessage(sock, remoteJid, {
        pollUpdateMessage: {
            pollEncKey: pollUpdateMessageEncKey,
            vote: {
                selectedOptions: values.map((_, index) => index + 1),
                senderTimestampMs: Date.now()
            },
            senderTimestampMs: Date.now()
        }
    }, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    msg.message.pollUpdateMessage.pollUpdateMessageKey = pollUpdateMessageKey
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

/**
 * Builds a group status message payload.
 *
 * @param {object} payload - Group status payload.
 * @param {string} payload.text - Status text.
 * @param {string|number} [payload.color='#0EABF4'] - Background color.
 * @param {string|number} [payload.textColor='#FFFFFF'] - Text color.
 * @param {string|number} [payload.font] - Font style.
 * @param {string} [payload.fontSize] - Font size.
 * @param {boolean} [payload.closeFriends=false] - Send only to close friends.
 * @param {string} [payload.backgroundArgb] - Background ARGB hex.
 * @param {string} [payload.textArgb] - Text ARGB hex.
 * @returns {object} Group status message payload.
 */
export function buildGroupStatus({ text, color = '#0EABF4', textColor = '#FFFFFF', font = 0, fontSize = '', closeFriends = false, backgroundArgb = '#00000000', textArgb = '#FFFFFFFF' }) {
    const textColorValue = normalizeColor(textColor)
    const backgroundColorValue = normalizeColor(color)
    return {
        text,
        font,
        fontSize,
        textColor: textColorValue,
        backgroundColor: backgroundColorValue,
        closeFriends,
        backgroundArgb: String(backgroundArgb),
        textArgb: String(textArgb)
    }
}

/**
 * Sends a group status message (must be called from a group chat).
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} text - Status text.
 * @param {object} [options={}] - Message options.
 * @param {string} [options.jid] - Group JID (defaults to current chat).
 * @param {string|number} [options.color='#0EABF4'] - Background color.
 * @param {boolean} [options.closeFriends=false] - Close friends only.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendGroupStatus(sock, text, options = {}) {
    const jid = options.jid
    if (!jid || !isJidGroup(jid)) {
        throw createError('sendGroupStatus must be called with a group JID.', ErrorCodes.INVALID_JID)
    }
    if (typeof text !== 'string' || text.length === 0) {
        throw createError('sendGroupStatus requires status text.', ErrorCodes.INVALID_MESSAGE)
    }
    const msg = await generateMessage(sock, jid, {
        groupStatusMessage: buildGroupStatus({
            text,
            color: options.color,
            textColor: options.textColor,
            font: options.font,
            fontSize: options.fontSize,
            closeFriends: options.closeFriends,
            backgroundArgb: options.backgroundArgb,
            textArgb: options.textArgb
        })
    }, {
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, jid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

/**
 * Sends a status message with a list of mentioned users.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} text - Status text.
 * @param {string[]} jidList - User JIDs to mention.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendStatusMentions(sock, text, jidList, options = {}) {
    if (!Array.isArray(jidList) || jidList.length === 0) {
        throw createError('sendStatusMentions requires a non-empty jidList.', ErrorCodes.INVALID_MESSAGE)
    }
    const jid = options.jid || 'status@broadcast'
    const msg = await generateMessage(sock, jid, {
        statusMentionMessage: { text }
    }, {
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, jid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes,
        statusJidList: jidList
    })
    return msg
}

/**
 * Sends an event message.
 *
 * The eventMessage is built with `isCanceled`, a message secret, and a
 * call join link (resolved through the engine's `getCallLink` when the
 * event carries `call`).
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {import('../types/baileys.js').EventOptions} event - Event payload.
 * @param {string} event.name - Event name (required).
 * @param {string} [event.description=''] - Event description.
 * @param {Date|number|string} [event.startDate] - Event start (required).
 * @param {Date|number|string} [event.endDate] - Event end.
 * @param {boolean} [event.isCancelled=false] - Whether the event is cancelled (proto field `isCanceled`).
 * @param {boolean} [event.isCanceled] - Alias for isCancelled.
 * @param {boolean} [event.extraGuestsAllowed] - Allow extra guests.
 * @param {boolean} [event.isScheduleCall=false] - Schedule a call.
 * @param {object|string} [event.location] - Location (`{ degreesLatitude, degreesLongitude, name, address }` or a string).
 * @param {string} [event.joinLink] - Direct join link.
 * @param {object} [event.call] - Call options (`{ isVideo }`) resolved via `getCallLink`.
 * @param {string} [event.jid] - Event owner JID.
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendEvent(sock, remoteJid, event, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    if (!event || !event.name) {
        throw createError('sendEvent requires an event name.', ErrorCodes.INVALID_MESSAGE)
    }
    const startTime = normalizeDate(event.startDate ?? event.startTime, 'startDate')
    const endTime = event.endDate != null || event.endTime != null
        ? normalizeDate(event.endDate ?? event.endTime, 'endDate')
        : null

    let location = event.location
    if (typeof location === 'string') {
        location = { name: location, address: location }
    }

    const context = getContext(sock)
    let joinLink = event.joinLink || ''
    if (event.call) {
        const getCallLink = context.engine.getCallLink
        if (typeof getCallLink !== 'function') {
            throw createError(
                'The configured engine does not expose "getCallLink" for event calls.',
                ErrorCodes.NOT_IMPLEMENTED
            )
        }
        const { joinLink: resolvedJoinLink } = await getCallLink(event.call, { startTime: startTime.getTime() })
        if (resolvedJoinLink) {
            joinLink = resolvedJoinLink
        }
    }

    const eventMessage = {
        name: event.name,
        startTime: Math.floor(startTime.getTime() / 1000),
        description: event.description || '',
        isCanceled: event.isCancelled ?? event.isCanceled ?? false
    }
    if (endTime) {
        eventMessage.endTime = Math.floor(endTime.getTime() / 1000)
    }
    if (location) {
        eventMessage.location = location
    }
    if (event.extraGuestsAllowed !== undefined) {
        eventMessage.extraGuestsAllowed = event.extraGuestsAllowed
    }
    if (event.isScheduleCall !== undefined) {
        eventMessage.isScheduleCall = event.isScheduleCall
    }
    if (joinLink) {
        eventMessage.joinLink = joinLink
    }
    if (event.jid) {
        eventMessage.jid = event.jid
    }
    const contextInfo = buildContextInfo({ quoted, extra: options.contextInfo })
    if (Object.keys(contextInfo).length) {
        eventMessage.contextInfo = contextInfo
    }

    const content = {
        eventMessage,
        messageContextInfo: {
            messageSecret: makeMessageSecret()
        }
    }
    const msg = await generateMessage(sock, remoteJid, content, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    const nodes = normalizeAdditionalNodes(options.additionalNodes).concat(NODES.event_creation)
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: nodes
    })
    return msg
}

/**
 * Builds an order message payload.
 *
 * @param {object} order - Order payload.
 * @param {string} order.orderId - Order ID.
 * @param {string} order.thumbnail - Thumbnail URL.
 * @param {number} order.itemCount - Item count.
 * @param {string} order.status - Order status.
 * @param {string} order.surface - Order surface.
 * @param {string} order.message - Order message.
 * @param {string} order.orderTitle - Order title.
 * @param {string} order.sellerJid - Seller JID.
 * @param {string} order.token - Order token.
 * @param {number} order.totalAmount1000 - Total amount (in 1000ths).
 * @param {string} order.totalCurrencyCode - Currency code.
 * @returns {object} Order message payload.
 */
export function buildOrderMessage(order) {
    return {
        orderId: order.orderId,
        thumbnail: order.thumbnail,
        itemCount: order.itemCount,
        status: order.status,
        surface: order.surface,
        message: order.message,
        orderTitle: order.orderTitle,
        sellerJid: order.sellerJid,
        token: order.token,
        totalAmount1000: order.totalAmount1000,
        totalCurrencyCode: order.totalCurrencyCode
    }
}

/**
 * Sends an order message.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object} order - Order payload (see {@link buildOrderMessage}).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendOrder(sock, remoteJid, order, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    if (!order || !order.orderId) {
        throw createError('sendOrder requires an orderId.', ErrorCodes.INVALID_MESSAGE)
    }
    const msg = await generateMessage(sock, remoteJid, {
        orderMessage: buildOrderMessage(order)
    }, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

/**
 * Sends an invoice message.
 *
 * The invoice attachment (image thumbnail) is prepared through the engine
 * and its encrypted fields (`attachmentMediaKey`, `attachmentDirectPath`,
 * `attachmentFileSha256`, ...) are embedded in `invoiceMessage`.
 *
 * @param {object} sock - Initialized client socket.
 * @param {string} remoteJid - Destination JID.
 * @param {object} invoice - Invoice payload.
 * @param {string} invoice.invoiceId - Invoice ID.
 * @param {string} invoice.invoiceUrl - Invoice URL.
 * @param {string} [invoice.currencyCodeIso4217='IDR'] - Currency code (ISO 4217).
 * @param {number} [invoice.amount1000] - Amount (in 1000ths).
 * @param {string} [invoice.invoiceName=''] - Invoice name.
 * @param {string} [invoice.thumbnailUrl=''] - Thumbnail URL.
 * @param {string} [invoice.description=''] - Invoice description.
 * @param {string} [invoice.note=''] - Invoice note.
 * @param {import('../types/baileys.js').MediaInput} [invoice.image] - Invoice image/thumbnail (prepared as the attachment).
 * @param {import('../types/baileys.js').MediaInput} [invoice.thumbnail] - Alias for image.
 * @param {string} [invoice.token] - Invoice token (falls back to a generated one).
 * @param {object|null} [quoted=null] - Optional quoted message.
 * @param {object} [options={}] - Message options.
 * @returns {Promise<object>} Generated WAMessage.
 */
export async function sendInVoice(sock, remoteJid, invoice, quoted = null, options = {}) {
    assertJid(remoteJid)
    quoted = resolveQuoted(quoted, options)
    if (!invoice || !invoice.invoiceId || !invoice.invoiceUrl) {
        throw createError('sendInVoice requires invoiceId and invoiceUrl.', ErrorCodes.INVALID_MESSAGE)
    }
    const invoiceMessage = {
        invoiceId: invoice.invoiceId,
        invoiceUrl: invoice.invoiceUrl,
        currencyCodeIso4217: invoice.currencyCodeIso4217 || 'IDR',
        amount1000: invoice.amount1000,
        invoiceName: invoice.invoiceName || '',
        thumbnailUrl: invoice.thumbnailUrl || '',
        description: invoice.description || '',
        note: invoice.note || '',
        token: invoice.token || generateMessageIDV2()
    }
    const attachmentInput = invoice.image ?? invoice.thumbnail
    if (attachmentInput != null) {
        const imageMessage = await prepareMedia(sock, 'image', attachmentInput, {
            jid: remoteJid,
            engineOptions: options.engineOptions
        })
        Object.assign(invoiceMessage, {
            attachmentType: 1,
            attachmentMimetype: imageMessage.mimetype,
            attachmentMediaKey: imageMessage.mediaKey,
            attachmentMediaKeyTimestamp: imageMessage.mediaKeyTimestamp,
            attachmentDirectPath: imageMessage.directPath,
            attachmentJpegThumbnail: imageMessage.jpegThumbnail,
            attachmentFileSha256: imageMessage.fileSha256,
            attachmentFileEncSha256: imageMessage.fileEncSha256
        })
    }
    const contextInfo = buildContextInfo({ quoted, expiration: options.expiration, extra: options.contextInfo })
    if (Object.keys(contextInfo).length) {
        invoiceMessage.contextInfo = contextInfo
    }
    const msg = await generateMessage(sock, remoteJid, { invoiceMessage }, {
        quoted,
        messageId: options.messageId,
        engineOptions: options.engineOptions
    })
    await relayMessage(sock, remoteJid, msg.message, {
        messageId: msg.key.id,
        additionalAttributes: options.additionalAttributes,
        additionalNodes: options.additionalNodes
    })
    return msg
}

const MESSAGE_HELPERS = {
    sendText,
    reply,
    sendReact,
    sendImage,
    sendVideo,
    sendAudio,
    sendFile,
    sendSticker,
    sendStickerPack,
    sendAlbum,
    sendInteractive,
    sendContact,
    sendProduct,
    sendLivePhoto,
    sendThumbnailPreview,
    sendCard,
    sendPoll,
    sendQuiz,
    sendPollResult,
    sendGroupStatus,
    sendStatusMentions,
    sendEvent,
    sendOrder,
    sendInVoice,
    sendLocation
}

/**
 * Attaches all message helpers to a socket instance.
 *
 * Each helper becomes `sock.<name>(...)` bound to the socket.
 *
 * @param {object} sock - The augmented engine socket.
 * @returns {object} The socket with helpers attached.
 */
export function attachMessageHelpers(sock) {
    for (const [name, helper] of Object.entries(MESSAGE_HELPERS)) {
        sock[name] = (...args) => helper(sock, ...args)
    }
    return sock
}