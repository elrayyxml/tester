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
 *
 * - Without prefix → standard `3EB0` + 18 hex (Baileys-compatible)
 * - With prefix → fully custom ID based on the prefix + random hex
 *
 * @param {string} [userId]
 * @param {string} [prefix]
 * @returns {string}
 */
function generateMessageId(userId, prefix) {
  if (prefix && typeof prefix === 'string' && prefix.length > 0) {
    const ts = Date.now().toString(16).toUpperCase()
    const rnd = randomBytes(8).toString('hex').toUpperCase()
    return `${prefix}${ts.slice(-6)}${rnd}`
  }

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
  return '3EB0' + hex
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
 * @param {any[]} array
 * @returns {any}
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
    new URL(text)
    return true
  } catch {
    return /https?:\/\/[^\s]+/i.test(text)
  }
}

/**
 * Default bot-id detector.
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

exports.sleep = sleep;
exports.generateMessageId = generateMessageId;
exports.getDevice = getDevice;
exports.formatBytes = formatBytes;
exports.randomInt = randomInt;
exports.pickRandom = pickRandom;
exports.isUrl = isUrl;
exports.defaultIsBot = defaultIsBot;
