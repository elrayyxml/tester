/**
 * Public utility namespace.
 *
 * `Utils` is the controlled public surface for utilities. Not every internal
 * module becomes public automatically; only the helpers listed here are
 * exposed through `Utils`.
 *
 * @module utils
 */

import {
    hasNonNullishProperty,
    hasOptionalProperty,
    isJidGroup,
    isJidNewsletter,
    isJidUser,
    isJidStatusBroadcast,
    isJidLid,
    isJidBroadcast,
    assertJid,
    normalizeArray,
    resolveQuoted,
    sleep,
    delay,
    pickRandom,
    random,
    getRandom,
    formatBytes,
    isUrl,
    isURL,
    isUrlValid,
    isUrlInText,
    extractLink,
    toText,
    jsonFormat,
    texted,
    example,
    size,
    sharp,
    getDevice,
    generateMessageID,
    generateMessageIDV2
} from './function.js'
import {
    detectMediaInput,
    resolveMedia,
    fetchUrlToBuffer,
    streamToBuffer,
    toBuffer,
    toBufferFrom,
    detectMimeType,
    toBase64,
    toBase64Url,
    bufferToStream
} from './converter.js'
import {
    createLogger,
    sanitizeForLog
} from './logs.js'
import {
    buildStickerExif,
    makeChunk,
    isWebP,
    isAnimatedWebP,
    setWebpExif,
    getWebpExif,
    parseWebpExif
} from './exif.js'
import {
    randomBytes,
    makeMessageSecret,
    makeMediaKey,
    sha256,
    hmacSha256,
    expandMediaKey,
    encryptCbc,
    decryptCbc,
    encryptMedia
} from './cryptokey.js'
import {
    encodeBase64,
    decodeBase64,
    encodeBase64Url,
    decodeBase64Url,
    toHex,
    fromHex,
    xorCipher,
    bufferToUtf8,
    utf8ToBuffer
} from './chiper.js'
import {
    getImageProcessor,
    toWebP,
    toJpegThumbnail,
    uploadEncryptedBuffer,
    buildStickerPackPayload
} from './sticker-pack.js'
import {
    ErrorCodes,
    NexrayError,
    createError
} from '../constant/index.js'

const builtinKeys = new Set([
    'extend'
])

const coreUtils = {
    getDevice,
    generateMessageID,
    generateMessageIDV2,
    sleep,
    delay,
    formatBytes,
    getRandom,
    pickRandom,
    random,
    isUrl,
    isURL,
    isUrlValid,
    isUrlInText,
    extractLink,
    detectMediaInput,
    resolveMedia,
    toBuffer,
    getStream: streamToBuffer,
    getMimeType: detectMimeType,
    hasNonNullishProperty,
    hasOptionalProperty,
    isJidGroup,
    isJidNewsletter,
    isJidUser,
    isJidStatusBroadcast,
    isJidLid,
    isJidBroadcast,
    assertJid,
    normalizeArray,
    resolveQuoted,
    toBase64,
    toBase64Url,
    toHex,
    fromHex,
    toText,
    jsonFormat,
    texted,
    example,
    size,
    sharp,
    sha256,
    randomBytes,
    makeMessageSecret,
    makeMediaKey,
    createLogger,
    sanitizeForLog,
    buildStickerExif,
    setWebpExif,
    getWebpExif,
    parseWebpExif,
    isWebP,
    isAnimatedWebP,
    toWebP,
    toJpegThumbnail,
    buildStickerPackPayload,
    uploadEncryptedBuffer,
    encodeBase64,
    decodeBase64,
    encodeBase64Url,
    decodeBase64Url,
    xorCipher,
    ErrorCodes,
    NexrayError,
    createError
}

/**
 * The public Utils namespace. Supports `extend()` for custom utilities.
 */
export const Utils = { ...coreUtils, extend }

/**
 * Adds custom utility methods to the Utils namespace.
 *
 * Built-in methods are protected unless `force` is true.
 *
 * @param {object} extensions - Object of functions/values to add.
 * @param {object} [options] - Extension options.
 * @param {boolean} [options.force=false] - Allow overriding built-in methods.
 * @returns {object} The Utils namespace.
 */
export function extend(extensions = {}, options = {}) {
    for (const [key, value] of Object.entries(extensions)) {
        if (key in Utils && !options.force && builtinKeys.has(key)) {
            continue
        }
        Utils[key] = value
    }
    return Utils
}

export { ErrorCodes, NexrayError, createError }