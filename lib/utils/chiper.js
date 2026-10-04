/** @module utils/chiper */

import crypto from 'crypto';

/**
 * @param {Buffer|Uint8Array|string} data
 * @returns {Buffer}
 */
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

/**
 * @param {Buffer|Uint8Array|string} data
 * @returns {Buffer}
 */
export const md5 = (data) => crypto.createHash('md5').update(data).digest();

/**
 * @param {number} size
 * @returns {Buffer}
 */
export const randomBytes = (size) => crypto.randomBytes(size);

/**
 * ID acak heksadesimal.
 *
 * @param {number} [size]
 * @returns {string}
 */
export const randomId = (size = 10) => crypto.randomBytes(size).toString('hex');

/**
 * AES-256-CBC. Hasilnya `iv || ciphertext`.
 *
 * @param {Buffer} plaintext
 * @param {Buffer} key 32 byte
 * @returns {Buffer}
 */
export function aesEncrypt(plaintext, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]);
}

/**
 * @param {Buffer} payload hasil aesEncrypt
 * @param {Buffer} key 32 byte
 * @returns {Buffer}
 */
export function aesDecrypt(payload, key) {
  const iv = payload.subarray(0, 16);
  const data = payload.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * @param {Buffer|Uint8Array|string} data
 * @param {Buffer|Uint8Array|string} key
 * @returns {Buffer}
 */
export const hmacSha256 = (data, key) => crypto.createHmac('sha256', key).update(data).digest();
