'use strict'

const { createHash, randomBytes, randomFillSync } = require('crypto')

/**
 * Sleep for the given milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate a WhatsApp-compatible message ID.
 * If prefix is provided it is inserted in the middle of the ID so that
 * device-detection regexes (e.g. /^3E.{20}$/) still match.
 *
 * @param {string} [userId]
 * @param {string} [prefix]
 * @returns {string}
 */
function generateMessageId(userId, prefix) {
  const data = Buffer.alloc(8 + 20 + 16)
  data.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 0)

  if (userId) {
    const userStr = String(userId).split('@')[0].split(':')[0]
    if (userStr) {
      const len = data.write(userStr, 8)
      data.write('@c.us', 8 + len)
    }
  }

  randomFillSync(data, 28, 16)
  const hash = createHash('sha256').update(data).digest()
  const hex = hash.toString('hex', 0, 9).toUpperCase()
  let baseId = '3EB0' + hex

  if (prefix && typeof prefix === 'string' && prefix.length > 0) {
    // Insert after a few characters so device detection still works
    const pos = 4 + (hash[0] & 15)
    baseId = baseId.slice(0, pos) + prefix + baseId.slice(pos)
  }

  return baseId
}

/**
 * Detect device type from message ID pattern.
 * @param {string} messageId
 * @returns {'ios'|'android'|'web'|'desktop'|'unknown'}
 */
function getDevice(messageId) {
  if (!messageId || typeof messageId !== 'string') return 'unknown'
  const id = messageId.toUpperCase()
  if (id.startsWith('3A')) return 'ios'
  if (id.startsWith('3E') || id.startsWith('3EB0')) return 'web'
  if (id.startsWith('BAE') || id.startsWith('BAE5')) return 'android'
  if (/^[0-9A-F]{32}$/i.test(id)) return 'desktop'
  return 'unknown'
}

/**
 * Format bytes to human readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} array
 * @returns {T}
 */
function pickRandom(array) {
  if (!Array.isArray(array) || array.length === 0) return undefined
  return array[Math.floor(Math.random() * array.length)]
}

/**
 * Simple URL test.
 * @param {string} text
 * @returns {boolean}
 */
function isUrl(text) {
  if (!text || typeof text !== 'string') return false
  try {
    // eslint-disable-next-line no-new
    new URL(text)
    return true
  } catch {
    return /https?:\/\/[^\s]+/i.test(text)
  }
}

/**
 * Default bot-id detector (used when options.bot is not supplied).
 * @param {string} id
 * @returns {boolean}
 */
function defaultIsBot(id) {
  if (!id || typeof id !== 'string') return false
  return (
    (id.startsWith('3EB0') && id.length >= 20) ||
    id.startsWith('BAE') ||
    /[-]/.test(id)
  )
}

module.exports = {
  sleep,
  generateMessageId,
  getDevice,
  formatBytes,
  randomInt,
  pickRandom,
  isUrl,
  defaultIsBot
}
