/**
 * Crypto and key related utilities.
 *
 * Provides the cryptographic primitives the library needs for media
 * encryption, key expansion, and secure secret generation. These helpers
 * only implement standard protocol operations (AES-CBC, HMAC, HKDF) used by
 * WhatsApp media handling. They are not designed to bypass any security
 * mechanism.
 *
 * @module utils/cryptokey
 */

import crypto from 'node:crypto'
import { ErrorCodes, createError } from '../constant/index.js'

/**
 * Generates cryptographically secure random bytes.
 *
 * @param {number} [size=32] - Number of bytes.
 * @returns {Buffer} Random bytes.
 */
export function randomBytes(size = 32) {
    return crypto.randomBytes(size)
}

/**
 * Generates a random 32-byte message secret (Uint8Array).
 *
 * @returns {Uint8Array} 32 random bytes.
 */
export function makeMessageSecret() {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    return secret
}

/**
 * Generates a random media key.
 *
 * @returns {Buffer} 32 random bytes.
 */
export function makeMediaKey() {
    return randomBytes(32)
}

/**
 * Computes the SHA-256 digest of a buffer.
 *
 * @param {Buffer|Uint8Array|string} data - Data to hash.
 * @returns {Buffer} SHA-256 digest.
 */
export function sha256(data) {
    return crypto.createHash('sha256').update(data).digest()
}

/**
 * Computes an HMAC-SHA256 digest.
 *
 * @param {Buffer|string} key - HMAC key.
 * @param {Buffer|Uint8Array} data - Data to authenticate.
 * @param {number} [length=32] - Output length in bytes.
 * @returns {Buffer} HMAC digest (truncated to length).
 */
export function hmacSha256(key, data, length = 32) {
    return crypto.createHmac('sha256', key).update(data).digest().subarray(0, length)
}

/**
 * Expands a media key using HKDF (RFC 5869).
 *
 * @param {Buffer} mediaKey - The 32-byte media key.
 * @param {string} info - HKDF info/salt string (e.g. `WhatsApp Image Keys`).
 * @param {number} [length=112] - Output length in bytes.
 * @returns {Buffer} Expanded key material.
 */
export function expandMediaKey(mediaKey, info, length = 112) {
    return Buffer.from(
        crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(info), length)
    )
}

/**
 * Encrypts data with AES-256-CBC using the provided key and IV.
 *
 * @param {Buffer} data - Plaintext.
 * @param {Buffer} key - 32-byte cipher key.
 * @param {Buffer} iv - 16-byte IV.
 * @returns {Buffer} Ciphertext.
 */
export function encryptCbc(data, key, iv) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([cipher.update(data), cipher.final()])
}

/**
 * Decrypts AES-256-CBC ciphertext.
 *
 * @param {Buffer} data - Ciphertext.
 * @param {Buffer} key - 32-byte cipher key.
 * @param {Buffer} iv - 16-byte IV.
 * @returns {Buffer} Plaintext.
 */
export function decryptCbc(data, key, iv) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([decipher.update(data), decipher.final()])
}

/**
 * Encrypts media the way WhatsApp expects: CBC cipher + 10-byte MAC tag.
 *
 * @param {Buffer} media - Raw media bytes.
 * @param {Buffer} mediaKey - 32-byte media key.
 * @param {string} info - HKDF info string (e.g. `WhatsApp Image Keys`).
 * @returns {{ encBuffer: Buffer, iv: Buffer, cipherKey: Buffer, macKey: Buffer, mac: Buffer }} Encrypted payload and derived keys.
 */
export function encryptMedia(media, mediaKey, info) {
    const expanded = expandMediaKey(mediaKey, info)
    const iv = expanded.subarray(0, 16)
    const cipherKey = expanded.subarray(16, 48)
    const macKey = expanded.subarray(48, 80)
    const encrypted = encryptCbc(media, cipherKey, iv)
    const mac = hmacSha256(macKey, Buffer.concat([iv, encrypted]), 10)
    return {
        encBuffer: Buffer.concat([encrypted, mac]),
        iv,
        cipherKey,
        macKey,
        mac
    }
}

/**
 * Generates a unique 32-byte identifier token.
 *
 * @returns {string} Hex token.
 */
export function makeToken() {
    return randomBytes(32).toString('hex')
}