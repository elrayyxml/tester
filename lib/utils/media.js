'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const mime = require('mime-types')
const { wbError } = require('../constant/errors')

async function getBufferFromUrl(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  if (typeof input === 'string') {
    if (/^https?:\/\//i.test(input)) {
      const response = await fetch(input)
      if (!response.ok) throw wbError('INVALID_MEDIA', `HTTP ${response.status}.`)
      return Buffer.from(await response.arrayBuffer())
    }
    return fs.promises.readFile(input)
  }
  if (input && typeof input.pipe === 'function') {
    const chunks = []
    for await (const chunk of input) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  throw wbError('INVALID_MEDIA')
}

function detectMime(buffer, filename = '') {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.subarray(0, 6).toString() === 'GIF87a' || data.subarray(0, 6).toString() === 'GIF89a') return 'image/gif'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (data.subarray(0, 4).toString() === '%PDF') return 'application/pdf'
  if (data.subarray(0, 4).toString() === 'OggS') return 'audio/ogg'
  if (data.subarray(0, 4).toString() === 'ID3' || data.subarray(0, 2).equals(Buffer.from([0xff, 0xfb]))) return 'audio/mpeg'
  if (data.subarray(0, 4).toString() === 'PK\x03\x04') return 'application/zip'
  return mime.lookup(filename) || 'application/octet-stream'
}

async function getStream(input) {
  if (input && typeof input.pipe === 'function' && typeof input[Symbol.asyncIterator] === 'function') return input
  return Readable.from([await getBufferFromUrl(input)])
}

async function extractImageThumb(input, width = 200) {
  const buffer = await getBufferFromUrl(input)
  // Tanpa native image dependency; Baileys tetap menerima thumbnail Buffer.
  // Consumer dapat mengganti helper ini melalui Utils.extend jika membutuhkan resize.
  return { buffer, width }
}

function getFileName(input, fallback = 'file') {
  if (typeof input !== 'string') return fallback
  return path.basename(input.split('?')[0]) || fallback
}

module.exports = { getBufferFromUrl, detectMime, getStream, extractImageThumb, getFileName }
