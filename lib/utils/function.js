/**
 * Generic reusable utility functions used across the library.
 *
 * @module utils/function
 */

import { createHash, randomBytes, randomFillSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
    ErrorCodes,
    NexrayError,
    createError
} from '../constant/index.js'

/**
 * Checks whether an object has a non-nullish own property.
 *
 * @param {object} message - Object to inspect.
 * @param {string} key - Property name.
 * @returns {boolean} True when the property exists and is not null/undefined.
 */
export function hasNonNullishProperty(message, key) {
    return message != null &&
        typeof message === 'object' &&
        key in message &&
        message[key] != null
}

/**
 * Alias of {@link hasNonNullishProperty}.
 *
 * @param {object} obj - Object to inspect.
 * @param {string} key - Property name.
 * @returns {boolean} True when the property exists and is not null/undefined.
 */
export const hasOptionalProperty = hasNonNullishProperty

/**
 * Returns true when the value looks like a WhatsApp group JID.
 *
 * @param {string} jid - JID to test.
 * @returns {boolean} True for `@g.us` JIDs.
 */
export function isJidGroup(jid) {
    return typeof jid === 'string' && jid.endsWith('@g.us')
}

/**
 * Returns true when the value looks like a newsletter JID.
 *
 * @param {string} jid - JID to test.
 * @returns {boolean} True for `@newsletter` JIDs.
 */
export function isJidNewsletter(jid) {
    return typeof jid === 'string' && jid.endsWith('@newsletter')
}

/**
 * Returns true when the value looks like a personal number JID.
 *
 * @param {string} jid - JID to test.
 * @returns {boolean} True for `@s.whatsapp.net` JIDs.
 */
export function isJidUser(jid) {
    return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
}

/**
 * Returns true when the value is the status broadcast JID.
 *
 * @param {string} jid - JID to test.
 * @returns {boolean} True for `status@broadcast`.
 */
export function isJidStatusBroadcast(jid) {
    return jid === 'status@broadcast'
}

/**
 * Returns true when the value is a LID JID.
 *
 * @param {string} jid - JID to test.
 * @returns {boolean} True for `@lid` JIDs.
 */
export function isJidLid(jid) {
    return typeof jid === 'string' && jid.endsWith('@lid')
}

/**
 * Returns true when the value is a business/bot JID.
 *
 * @param {string} jid - JID to test.
 * @returns {boolean} True for `@broadcast` or bot JIDs.
 */
export function isJidBroadcast(jid) {
    return typeof jid === 'string' && jid.endsWith('@broadcast')
}

/**
 * Validates that a string is a usable remote JID.
 *
 * @param {string} jid - JID to validate.
 * @param {string} [label='remoteJid'] - Argument name used in errors.
 * @returns {string} The validated JID.
 * @throws {NexrayError} INVALID_JID when the JID is missing or not a string.
 */
export function assertJid(jid, label = 'remoteJid') {
    if (typeof jid !== 'string' || jid.length === 0) {
        throw createError(
            `${label} must be a non-empty string.`,
            ErrorCodes.INVALID_JID
        )
    }
    return jid
}

/**
 * Normalizes a string or array value into an array.
 *
 * @param {string|string[]|null|undefined} value - Value to normalize.
 * @returns {string[]} Always an array (empty when null/undefined).
 */
export function normalizeArray(value) {
    if (value == null) {
        return []
    }
    return Array.isArray(value) ? value : [value]
}

/**
 * Resolves a quoted message from a positional argument or an options object.
 *
 * @param {object|null|undefined} quoted - Positional quoted argument.
 * @param {object} [options] - Options object that may carry `quoted`.
 * @returns {object|null} The resolved quoted message or null.
 */
export function resolveQuoted(quoted, options) {
    if (quoted && (quoted.key || quoted.id || quoted.chat || quoted.remoteJid || quoted.message)) {
        return quoted
    }
    if (options && options.quoted) {
        return options.quoted
    }
    return null
}

/**
 * Sleeps for a given number of milliseconds.
 *
 * @param {number} milliseconds - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
export function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Alias of {@link sleep}.
 *
 * @param {number} milliseconds - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
export const delay = sleep

/**
 * Returns a random element from an array.
 *
 * @template T
 * @param {T[]} array - Source array.
 * @returns {T} A random element.
 */
export function pickRandom(array) {
    return array[Math.floor(Math.random() * array.length)]
}

/**
 * Alias of {@link pickRandom}.
 *
 * @template T
 * @param {T[]} array - Source array.
 * @returns {T} A random element.
 */
export const random = pickRandom

/**
 * Generates a random string of a given length using URL-safe characters.
 *
 * @param {number} [length=16] - Length of the generated string.
 * @returns {string} Random alphanumeric string.
 */
export function getRandom(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

/**
 * Formats a byte count into a human readable string.
 *
 * @param {number} bytes - Byte count.
 * @param {number} [decimals=2] - Decimal places.
 * @returns {string} Formatted size string.
 */
export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) {
        return '0 Bytes'
    }
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

/**
 * Returns true when the string is an http(s) URL.
 *
 * @param {string} value - Value to test.
 * @returns {boolean} True for http(s) URLs.
 */
export function isUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value)
}

/**
 * Alias of {@link isUrl}.
 *
 * @param {string} value - Value to test.
 * @returns {boolean} True for http(s) URLs.
 */
export const isURL = isUrl

/**
 * Returns true when the string is a valid URL.
 *
 * @param {string} value - Value to test.
 * @returns {boolean} True when the value parses as a URL.
 */
export function isUrlValid(value) {
    if (typeof value !== 'string') {
        return false
    }
    try {
        new URL(value)
        return true
    } catch {
        return false
    }
}

/**
 * Returns true when the text contains a URL.
 *
 * @param {string} text - Text to inspect.
 * @returns {boolean} True when a URL is present.
 */
export function isUrlInText(text) {
    return typeof text === 'string' && /https?:\/\/[^\s]+/i.test(text)
}

/**
 * Extracts the first URL found in a string.
 *
 * @param {string} text - Text to inspect.
 * @returns {string|null} The first URL or null.
 */
export function extractLink(text) {
    if (typeof text !== 'string') {
        return null
    }
    return text.match(/https?:\/\/[^\s]+/i)?.[0] || null
}

/**
 * Converts any value to a string without throwing.
 *
 * @param {unknown} value - Value to convert.
 * @returns {string} String representation.
 */
export function toText(value) {
    if (value == null) {
        return ''
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    return String(value)
}

/**
 * Pretty prints a value as JSON with indentation, safely handling circular
 * references (rendered as `[Circular]`) and non-JSON values.
 *
 * @param {unknown} value - Value to format.
 * @returns {string} Formatted JSON string.
 */
export function jsonFormat(data) {
    const seen = new WeakSet()
    const replacer = (_, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]'
            }
            seen.add(value)
        }
        return value
    }
    try {
        const obj = typeof data === 'string' ? JSON.parse(data) : data
        return JSON.stringify(obj, replacer, 2)
    } catch {
        return String(data)
    }
}

/**
 * Wraps a text with a WhatsApp text formatting style.
 *
 * @param {'bold'|'italic'|'strike'|'mono'|string} font - Formatting style.
 * @param {string} text - Text to wrap.
 * @returns {string} Formatted text (unchanged when the style is unknown).
 */
export function texted(font, text) {
    const formats = {
        bold: `*${text}*`,
        italic: `_${text}_`,
        strike: `~${text}~`,
        mono: `\`\`\`${text}\`\`\``
    }
    return formats[font] || text
}

/**
 * Builds an example command string for bot help text.
 *
 * @param {string} prefix - Command prefix (e.g. `.`).
 * @param {string} command - Command name.
 * @param {string} [args] - Example arguments.
 * @returns {string} Example command string.
 */
export function example(prefix, command, args = '') {
    return `• *Example* : ${prefix + command} ${args}`
}

/**
 * Measures a byte count as a human readable string, or compares it against a
 * threshold in megabytes.
 *
 * @param {Buffer|number} input - Buffer or byte count.
 * @param {number|null} [thresholdMB=null] - When provided, returns whether the
 *   byte count is greater than the threshold (boolean).
 * @returns {string|boolean} Formatted size string, or boolean when thresholdMB is set.
 */
export function size(input, thresholdMB = null) {
    const bytes = Buffer.isBuffer(input) ? input.length : input
    if (thresholdMB !== null) {
        return bytes > thresholdMB * 1024 * 1024
    }
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Resizes an image to a 300x300 cover thumbnail using sharp.
 *
 * Accepts a Buffer, an http(s) URL (fetched at runtime), or a file path.
 *
 * @param {Buffer|string} input - Image media input.
 * @returns {Promise<Buffer>} Resized thumbnail buffer.
 */
export async function sharp(input) {
    let buffer
    if (Buffer.isBuffer(input)) {
        buffer = input
    } else if (isURL(input)) {
        const res = await fetch(input)
        buffer = Buffer.from(await res.arrayBuffer())
    } else {
        buffer = await readFile(input)
    }
    const { default: sharpModule } = await import('sharp')
    return sharpModule(buffer).resize(300, 300, { fit: 'cover' }).toBuffer()
}

/**
 * Predicts the device type from a WhatsApp message ID.
 *
 * @param {string} id - Message ID.
 * @returns {'ios'|'android'|'web'|'desktop'|'unknown'} Detected device.
 */
export function getDevice(id) {
    if (typeof id !== 'string') {
        return 'unknown'
    }
    return /^3A.{18}$/.test(id)
        ? 'ios'
        : /^3E.{20}$/.test(id)
            ? 'web'
            : /^(.{21}|.{32})$/.test(id)
                ? 'android'
                : /^(3F|.{18}$)/.test(id)
                    ? 'desktop'
                    : 'unknown'
}

/**
 * Generates a legacy WhatsApp-compatible message ID.
 *
 * @param {string} [prefix='3EB0'] - Hex prefix for the ID.
 * @returns {string} Message ID.
 */
export function generateMessageID(prefix = '3EB0') {
    return prefix + randomBytes(18).toString('hex').toUpperCase()
}

/**
 * Generates a V2 WhatsApp-compatible message ID.
 *
 * Mirrors the whatsmeow-inspired fork implementation: a 44-byte seed
 * (timestamp + user JID + random bytes) is hashed with SHA-256, the first
 * 9 hash bytes become the hex body, and `customPrefix` (when provided) is
 * injected into the ID at a pseudo-random position derived from the hash —
 * same scheme as the fork's `STARFALL` injection. The prefix is uppercased
 * so the whole ID stays capital.
 *
 * @param {string} [userJid] - User JID used as hash seed.
 * @param {string} [customPrefix] - Custom prefix injected into the hex ID.
 * @returns {string} Message ID.
 */
export function generateMessageIDV2(userJid, customPrefix) {
    const data = Buffer.allocUnsafe(44)
    data.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 0)
    if (userJid) {
        const userStr = String(userJid).split('@')[0].split(':')[0]
        if (userStr) {
            const len = data.write(userStr, 8)
            data.write('@c.us', 8 + len)
        }
    }
    randomFillSync(data, 28, 16)
    const hash = createHash('sha256').update(data).digest()
    const hex = hash.toString('hex', 0, 9).toUpperCase()
    const baseId = '3EB0' + hex
    const pos = 4 + (hash[0] & 15)
    if (customPrefix) {
        return baseId.slice(0, pos) + String(customPrefix).toUpperCase() + baseId.slice(pos)
    }
    return baseId
}