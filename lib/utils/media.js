'use strict'

const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { NexrayError, ErrorMessages } = require('../constant/errors')
const { getGlobalConfig } = require('../constant/configure')

let fileType
try {
  fileType = require('file-type')
} catch {
  fileType = null
}

let sharp
try {
  sharp = require('sharp')
} catch {
  sharp = null
}

let Jimp
try {
  Jimp = require('jimp')
} catch {
  Jimp = null
}

/**
 * Download or read a buffer from URL / local path / Buffer.
 * @param {string|Buffer|import('stream').Readable} input
 * @returns {Promise<Buffer>}
 */
async function getBufferFromUrl(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Readable) {
    const chunks = []
    for await (const chunk of input) chunks.push(chunk)
    return Buffer.concat(chunks)
  }
  if (typeof input === 'string') {
    if (/^https?:\/\//i.test(input)) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), getGlobalConfig().REQUEST_TIMEOUT)
      try {
        const res = await fetch(input, { signal: controller.signal })
        if (!res.ok) throw new NexrayError(`HTTP ${res.status} while fetching media`, { code: 'FETCH_FAILED' })
        const ab = await res.arrayBuffer()
        return Buffer.from(ab)
      } finally {
        clearTimeout(timeout)
      }
    }
    // local path
    return fs.promises.readFile(input)
  }
  throw new NexrayError(ErrorMessages.INVALID_MEDIA, { code: 'INVALID_MEDIA' })
}

/**
 * Detect MIME type from buffer (magic bytes) with fallback to extension.
 * @param {Buffer} buffer
 * @param {string} [fallbackExt]
 * @returns {Promise<string>}
 */
async function detectMime(buffer, fallbackExt) {
  if (fileType) {
    try {
      const type = await fileType.fromBuffer(buffer)
      if (type?.mime) return type.mime
    } catch {}
  }
  if (fallbackExt) {
    const mime = require('mime-types').lookup(fallbackExt)
    if (mime) return mime
  }
  // very basic magic
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp'
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00) return 'video/mp4'
  return 'application/octet-stream'
}

/**
 * Normalize any input into a readable stream.
 * @param {string|Buffer|import('stream').Readable} input
 * @returns {Promise<import('stream').Readable>}
 */
async function getStream(input) {
  if (input instanceof Readable) return input
  const buf = await getBufferFromUrl(input)
  return Readable.from(buf)
}

/**
 * Extract a compressed JPEG thumbnail from an image stream/buffer.
 * @param {Buffer|import('stream').Readable} input
 * @param {number} [width=72]
 * @returns {Promise<Buffer>}
 */
async function extractImageThumb(input, width = 72) {
  const buf = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)

  if (sharp) {
    return sharp(buf)
      .resize(width, width, { fit: 'inside' })
      .jpeg({ quality: 50 })
      .toBuffer()
  }

  if (Jimp) {
    const img = await Jimp.read(buf)
    img.scaleToFit(width, width)
    return img.quality(50).getBufferAsync(Jimp.MIME_JPEG)
  }

  // fallback: return original if no image lib available
  return buf
}

/**
 * Get a compressed thumbnail suitable for link-preview.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function getCompressedThumbnail(buffer) {
  return extractImageThumb(buffer, 100)
}

/**
 * Compute audio waveform (64 samples 0-100) for PTT.
 * Tries baileys getAudioWaveform, then audio-decode, else undefined.
 */
async function getWaveform(buffer, logger) {
  try {
    var baileys = require('baileys')
    if (typeof baileys.getAudioWaveform === 'function') {
      return await baileys.getAudioWaveform(buffer, logger)
    }
  } catch (e) {}
  try {
    var decode = require('audio-decode')
    var audio = await decode(buffer)
    var channel = audio.channelData && audio.channelData[0]
    if (!channel || !channel.length) return undefined
    var samples = 64
    var block = Math.floor(channel.length / samples)
    var out = new Uint8Array(samples)
    for (var i = 0; i < samples; i++) {
      var start = i * block
      var sum = 0
      var count = 0
      for (var j = 0; j < block && start + j < channel.length; j++) {
        sum += Math.abs(channel[start + j])
        count++
      }
      var avg = count ? sum / count : 0
      out[i] = Math.min(100, Math.floor(avg * 100))
    }
    return out
  } catch (e) {
    if (logger && logger.debug) logger.debug({ err: e }, 'waveform generation skipped')
    return undefined
  }
}

exports.getBufferFromUrl = getBufferFromUrl;
exports.detectMime = detectMime;
exports.getWaveform = getWaveform;
exports.getStream = getStream;
exports.extractImageThumb = typeof extractImageThumb !== "undefined" ? extractImageThumb : undefined;
exports.getCompressedThumbnail = typeof getCompressedThumbnail !== "undefined" ? getCompressedThumbnail : undefined;
