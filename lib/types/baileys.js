/**
 * Conceptual contracts for the Baileys-compatible engine.
 * These are JSDoc / documentation contracts — not runtime TypeScript types.
 *
 * @module types/baileys
 */

/**
 * Minimal capability set an injected engine must expose.
 *
 * @typedef {Object} EngineCapabilities
 * @property {object} proto - WAProto namespace
 * @property {Function} generateMessageIDV2
 * @property {Function} [getAudioWaveform]
 * @property {Function} [toBuffer]
 * @property {Function} [getStream]
 * @property {Function} [generateThumbnail]
 * @property {Function} generateWAMessageFromContent
 * @property {Function} generateWAMessageContent
 * @property {Function} generateWAMessage
 * @property {Function} getContentType
 * @property {Function} normalizeMessageContent
 * @property {Function} [getDevice]
 * @property {Function} prepareWAMessageMedia
 * @property {Function} relayMessage - bound to the socket instance
 */

/**
 * Normalized engine context used by core.
 *
 * @typedef {Object} EngineContext
 * @property {object} primary - Primary (engines[0]) normalized engine
 * @property {object[]} engines - All injected engines
 * @property {EngineCapabilities} caps - Capability map from primary
 * @property {object} sock - Original augmented socket
 */

/**
 * Client configuration after normalization.
 *
 * @typedef {Object} NormalizedClientOptions
 * @property {Function|boolean|null} bot
 * @property {string|null} customId
 * @property {string|null} stealth - 'ios'|'android'|'web'|'desktop'|null
 * @property {NewsletterAnnotationConfig|null} newsletterAnnotation
 * @property {boolean} secureMetaServiceLabel
 * @property {boolean} debug
 */

/**
 * Newsletter annotation public config.
 *
 * @typedef {Object} NewsletterAnnotationConfig
 * @property {string} newsletterJid
 * @property {string} [newsletterName]
 * @property {string} [accessibilityText]
 * @property {number|string} [contentType]
 */

/**
 * Media input accepted by helpers.
 * @typedef {Buffer|string|{url: string}|{stream: import('stream').Readable}} MediaInput
 */

/**
 * Message options shared across helpers.
 *
 * @typedef {Object} MessageOptions
 * @property {object} [contextInfo]
 * @property {string[]} [mentions]
 * @property {boolean} [mentionsAll]
 * @property {boolean} [ai]
 * @property {boolean} [viewOnce]
 * @property {boolean} [ephemeral]
 * @property {number} [ephemeralExpiration]
 * @property {object} [externalAdReply]
 * @property {boolean} [groupStatus]
 * @property {boolean} [spoiler]
 * @property {object[]} [additionalNodes]
 * @property {object} [additionalAttributes]
 * @property {string} [messageId]
 * @property {boolean} [ptt]
 * @property {boolean} [ptv]
 * @property {boolean} [gif]
 * @property {string} [mimetype]
 * @property {string} [fileName]
 * @property {*} [backgroundColor]
 */

export {};
