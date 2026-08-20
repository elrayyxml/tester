/**
 * Cipher and encoding utilities.
 *
 * The module name `chiper.js` is retained for compatibility with the
 * project structure. It provides encoding helpers (base64, base64url, hex)
 * and a small XOR cipher used for lightweight obfuscation of non-secret
 * payloads.
 *
 * @module utils/chiper
 */

import { ErrorCodes, createError } from '../constant/index.js'

/**
 * Encodes a buffer/string to base64.
 *
 * @param {Buffer|string} data - Data to encode.
 * @returns {string} Base64 string.
 */
export function encodeBase64(data) {
    return Buffer.from(data).toString('base64')
}

/**
 * Decodes a base64 string.
 *
 * @param {string} data - Base64 string.
 * @returns {Buffer} Decoded buffer.
 */
export function decodeBase64(data) {
    return Buffer.from(data, 'base64')
}

/**
 * Encodes a buffer/string to URL-safe base64 (no padding).
 *
 * @param {Buffer|string} data - Data to encode.
 * @returns {string} URL-safe base64 string.
 */
export function encodeBase64Url(data) {
    return encodeBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decodes a URL-safe base64 string.
 *
 * @param {string} data - URL-safe base64 string.
 * @returns {Buffer} Decoded buffer.
 */
export function decodeBase64Url(data) {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Encodes a buffer/string to hex.
 *
 * @param {Buffer|string} data - Data to encode.
 * @returns {string} Hex string.
 */
export function toHex(data) {
    return Buffer.from(data).toString('hex')
}

/**
 * Decodes a hex string.
 *
 * @param {string} data - Hex string.
 * @returns {Buffer} Decoded buffer.
 */
export function fromHex(data) {
    return Buffer.from(data, 'hex')
}

/**
 * Applies an XOR cipher over a buffer using a key string.
 *
 * @param {Buffer} data - Data to transform.
 * @param {string} key - XOR key.
 * @returns {Buffer} Transformed buffer.
 */
export function xorCipher(data, key) {
    if (typeof key !== 'string' || key.length === 0) {
        throw createError('XOR cipher requires a non-empty key.', ErrorCodes.INVALID_OPTIONS)
    }
    const keyBuffer = Buffer.from(key)
    const out = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) {
        out[i] = data[i] ^ keyBuffer[i % keyBuffer.length]
    }
    return out
}

/**
 * Converts a buffer to a UTF-8 string.
 *
 * @param {Buffer} data - Buffer to decode.
 * @returns {string} UTF-8 string.
 */
export function bufferToUtf8(data) {
    return data.toString('utf-8')
}

/**
 * Converts a string to a UTF-8 buffer.
 *
 * @param {string} data - String to encode.
 * @returns {Buffer} UTF-8 buffer.
 */
export function utf8ToBuffer(data) {
    return Buffer.from(data, 'utf-8')
}