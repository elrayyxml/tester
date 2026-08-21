/**
 * Client: wraps an existing engine socket and injects the Nexray
 * message helpers, configuration, and engine context.
 *
 * The socket is mutated: `sock.__nexray` holds the engine context and
 * every message helper becomes a method on the socket itself.
 *
 * @module core/Client
 */

import {
    ErrorCodes,
    createError
} from '../constant/index.js'
import { createLogger } from '../utils/logs.js'
import { attachMessageHelpers } from './message.js'

const STEALTH_DEVICES = ['ios', 'android', 'web', 'desktop']

/**
 * Validates the engines configuration.
 *
 * @param {unknown} engines - Engines array.
 * @returns {object} The primary engine (first entry).
 * @throws {NexrayError} INVALID_ENGINE when the configuration is invalid.
 */
export function validateEngines(engines) {
    if (!Array.isArray(engines) || engines.length === 0) {
        throw createError(
            '"engines" is required and must be a non-empty array.',
            ErrorCodes.INVALID_ENGINE
        )
    }
    const engine = engines[0]
    if (!engine || typeof engine !== 'object') {
        throw createError(
            'The primary engine (engines[0]) must be an object.',
            ErrorCodes.INVALID_ENGINE
        )
    }
    return engine
}

/**
 * Validates the stealth configuration.
 *
 * @param {unknown} stealth - Stealth device identifier.
 * @throws {NexrayError} INVALID_OPTIONS when the stealth value is invalid.
 */
export function validateStealth(stealth) {
    if (stealth == null) {
        return
    }
    if (typeof stealth !== 'string' || !STEALTH_DEVICES.includes(stealth)) {
        throw createError(
            `Invalid stealth device "${String(stealth)}". Supported: ${STEALTH_DEVICES.join(', ')}.`,
            ErrorCodes.INVALID_OPTIONS
        )
    }
}

/**
 * Validates the bot detector configuration.
 *
 * @param {unknown} bot - Bot detector (function, boolean, or null).
 * @throws {NexrayError} INVALID_OPTIONS when the bot value is invalid.
 */
export function validateBot(bot) {
    if (bot == null) {
        return
    }
    if (typeof bot !== 'function' && typeof bot !== 'boolean') {
        throw createError(
            '"bot" must be a function, a boolean, or null.',
            ErrorCodes.INVALID_OPTIONS
        )
    }
}

/**
 * Validates the newsletter annotation configuration.
 *
 * @param {unknown} annotation - Newsletter annotation object.
 * @throws {NexrayError} INVALID_OPTIONS when the annotation is invalid.
 */
export function validateNewsletterAnnotation(annotation) {
    if (annotation == null) {
        return
    }
    if (typeof annotation !== 'object' || !annotation.newsletterJid || !annotation.newsletterName) {
        throw createError(
            '"newsletterAnnotation" must be an object with newsletterJid and newsletterName.',
            ErrorCodes.INVALID_OPTIONS
        )
    }
}

/**
 * Normalizes the newsletterFollow configuration into an array of JIDs.
 *
 * @param {string|string[]|null|undefined} newsletterFollow - Newsletter JIDs.
 * @returns {string[]} Normalized newsletter JID array.
 */
export function normalizeNewsletterFollow(newsletterFollow) {
    if (newsletterFollow == null) {
        return []
    }
    if (typeof newsletterFollow === 'string') {
        return newsletterFollow.length > 0 ? [newsletterFollow] : []
    }
    if (Array.isArray(newsletterFollow)) {
        return newsletterFollow.filter((jid) => typeof jid === 'string' && jid.length > 0)
    }
    return []
}

/**
 * Follows the configured newsletter JIDs using the engine socket.
 *
 * Failures are logged, never thrown.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {object} context - Engine context.
 * @param {string[]} jids - Newsletter JIDs to follow.
 */
export async function followNewsletters(sock, context, jids) {
    if (jids.length === 0 || typeof sock.newsletterFollow !== 'function') {
        return
    }
    for (const jid of jids) {
        try {
            await sock.newsletterFollow(jid)
            context.logger?.debug(`Followed newsletter: ${jid}`)
        } catch (error) {
            context.logger?.warn(`Failed to follow newsletter ${jid}: ${error?.message || error}`)
        }
    }
}

/**
 * Initializes the Nexray client on an existing engine socket.
 *
 * @param {object} sock - The engine socket (Baileys socket or compatible).
 * @param {object} config - Client configuration.
 * @param {object[]} config.engines - Engine modules. The first entry is the primary engine.
 * @param {function|boolean|null} [config.bot=null] - Bot message ID detector.
 * @param {string|null} [config.custom_id=null] - Local message ID prefix.
 * @param {string|null} [config.stealth=null] - Message ID device format (ios, android, web, desktop).
 * @param {object|null} [config.newsletterAnnotation=null] - Default newsletter media annotation.
 * @param {string|string[]|null} [config.newsletterFollow=null] - Newsletter JIDs to follow on init.
 * @param {boolean} [config.debug=false] - Enable internal debug logging.
 * @param {boolean} [config.metaLabel=false] - Add secureMetaServiceLabel to all outgoing messages.
 * @returns {object} The same socket with helpers attached.
 * @throws {NexrayError} INVALID_SOCKET when the socket is invalid.
 * @throws {NexrayError} INVALID_ENGINE when the engines configuration is invalid.
 */
export function Client(sock, config = {}) {
    if (!sock || typeof sock !== 'object') {
        throw createError(
            'Client requires an existing engine socket.',
            ErrorCodes.INVALID_SOCKET
        )
    }
    if (config == null || typeof config !== 'object') {
        throw createError(
            'Client configuration must be an object.',
            ErrorCodes.INVALID_OPTIONS
        )
    }

    const engine = validateEngines(config.engines)
    validateStealth(config.stealth)
    validateBot(config.bot)
    validateNewsletterAnnotation(config.newsletterAnnotation)

    const logger = createLogger(config.debug === true)
    const normalizedConfig = {
        bot: config.bot ?? null,
        custom_id: typeof config.custom_id === 'string' && config.custom_id.length > 0
            ? config.custom_id
            : null,
        stealth: config.stealth ?? null,
        newsletterAnnotation: config.newsletterAnnotation ?? null,
        newsletterFollow: normalizeNewsletterFollow(config.newsletterFollow),
        debug: config.debug === true,
        metaLabel: config.metaLabel === true
    }

    sock.__nexray = {
        engine,
        config: normalizedConfig,
        logger,
        sock,
        engineType: 'baileys',
        version: engine.VERSION || 'unknown'
    }

    attachMessageHelpers(sock)

    const jids = normalizedConfig.newsletterFollow
    if (jids.length > 0) {
        followNewsletters(sock, sock.__nexray, jids)
    }

    return sock
}

export default Client