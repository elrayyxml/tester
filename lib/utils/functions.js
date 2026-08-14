'use strict'

const crypto = require('node:crypto')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function generateMessageId(userId = '', prefix) {
  const time = Date.now().toString(16).slice(-10).toUpperCase()
  const entropy = crypto.randomBytes(8).toString('hex').toUpperCase()
  const seed = userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 6).toUpperCase() : ''
  const middle = prefix ? String(prefix).replace(/[^A-Z0-9_-]/gi, '').slice(0, 12) : ''
  return `${time}${seed}${middle}${entropy}`
}

function getDevice(messageId = '') {
  const id = String(messageId)
  if (/^3A/i.test(id)) return 'ios'
  if (/^3E/i.test(id)) return 'web'
  if (/^3F/i.test(id) || /^BAE/i.test(id)) return 'android'
  if (/^3B/i.test(id)) return 'desktop'
  return 'unknown'
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 Bytes'
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${Number((value / 1024 ** index).toFixed(2))} ${units[index]}`
}

function randomInt(min, max) {
  const low = Math.ceil(Number(min))
  const high = Math.floor(Number(max))
  if (high < low) throw new RangeError('max harus lebih besar atau sama dengan min')
  return Math.floor(Math.random() * (high - low + 1)) + low
}

function pickRandom(array) {
  if (!Array.isArray(array) || array.length === 0) return undefined
  return array[randomInt(0, array.length - 1)]
}

function isUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

module.exports = { sleep, generateMessageId, getDevice, formatBytes, randomInt, pickRandom, isUrl }
