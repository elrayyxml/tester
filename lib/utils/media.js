'use strict'

const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { execFile } = require('child_process')
const { promisify } = require('util')
const os = require('os')
const crypto = require('crypto')

const execFileAsync = promisify(execFile)
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
  if (input && typeof input === 'object' && input.url) return getBufferFromUrl(input.url)
  if (typeof input === 'string') {
    if (/^data:/i.test(input)) {
      const encoded = input.slice(input.indexOf(',') + 1)
      return Buffer.from(encoded, 'base64')
    }
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

/** Decode an audio input with the same `audio-decode` package used upstream. */
async function decodeAudioBuffer(input) {
  const decoderModule = await import('audio-decode')
  const decoder = decoderModule.default || decoderModule
  const buffer = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)
  return decoder(buffer)
}

/**
 * Generate the 64-byte WhatsApp waveform using Baileys' upstream algorithm.
 * Values are normalized to the 0..100 range, not 0..255.
 */
async function getAudioWaveform(input, logger) {
  try {
    const audioBuffer = await decodeAudioBuffer(input)
    const rawData = audioBuffer.getChannelData(0)
    const samples = 64
    const blockSize = Math.floor(rawData.length / samples)
    if (!blockSize) return new Uint8Array(samples)
    const filteredData = []
    for (let i = 0; i < samples; i++) {
      const blockStart = blockSize * i
      let sum = 0
      for (let j = 0; j < blockSize; j++) sum += Math.abs(rawData[blockStart + j])
      filteredData.push(sum / blockSize)
    }
    const maximum = Math.max(...filteredData)
    if (!Number.isFinite(maximum) || maximum <= 0) return new Uint8Array(samples)
    const multiplier = Math.pow(maximum, -1)
    return new Uint8Array(filteredData.map(value => Math.floor(100 * value * multiplier)))
  } catch (error) {
    logger?.debug?.(`Failed to generate waveform: ${error?.message || error}`)
    return undefined
  }
}

async function getAudioDuration(input, options = {}) {
  try {
    const musicMetadata = await import('music-metadata')
    const buffer = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)
    const metadata = await musicMetadata.parseBuffer(buffer, undefined, { duration: true })
    return metadata.format.duration
  } catch (error) {
    // Keep a small ffprobe fallback for formats music-metadata cannot parse.
    const buffer = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)
    const temp = path.join(os.tmpdir(), `nexray-duration-${crypto.randomBytes(8).toString('hex')}.input`)
    try {
      await fs.promises.writeFile(temp, buffer)
      const { stdout } = await execFileAsync(options.ffprobePath || 'ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', temp
      ], { timeout: getGlobalConfig().FFMPEG_TIMEOUT || 30000, encoding: 'utf8' })
      const duration = Number.parseFloat(String(stdout).trim())
      return Number.isFinite(duration) ? duration : undefined
    } catch {
      return undefined
    } finally {
      await fs.promises.rm(temp, { force: true }).catch(() => {})
    }
  }
}

async function transcodeAudioToOpus(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)
  const temp = path.join(os.tmpdir(), `nexray-transcode-${crypto.randomBytes(8).toString('hex')}.input`)
  try {
    await fs.promises.writeFile(temp, buffer)
    const { stdout } = await execFileAsync(options.ffmpegPath || getGlobalConfig().FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', temp,
      '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', options.bitrate || '32k',
      '-application', 'voip', '-f', 'ogg', 'pipe:1'
    ], { maxBuffer: 64 * 1024 * 1024, timeout: getGlobalConfig().FFMPEG_TIMEOUT || 30000, encoding: 'buffer' })
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '')
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {})
  }
}

/** Prepare uploaded audio plus optional PTT metadata. */
async function prepareAudioForSend(input, options = {}) {
  const original = await getBufferFromUrl(input)
  const audio = options.ptt && options.transcode !== false
    ? await transcodeAudioToOpus(original, options)
    : original
  return {
    audio,
    waveform: options.waveform || (options.ptt ? await getAudioWaveform(original, options.logger) : undefined),
    seconds: options.seconds ?? (options.ptt ? await getAudioDuration(original, options) : undefined)
  }
}

const mediaTypeMapping = {
  audio: 'audio/mpeg',
  video: 'video/mp4',
  image: 'image/jpeg'
}

const isAudioInputSupportedForPTT = inputType =>
  ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/opus', 'audio/mp4'].includes(inputType)

async function decodeAudio(input) {
  return decodeAudioBuffer(input)
}

module.exports = {
  getBufferFromUrl,
  detectMime,
  getStream,
  extractImageThumb,
  getCompressedThumbnail,
  getAudioWaveform,
  getAudioDuration,
  transcodeAudioToOpus,
  prepareAudioForSend,
  decodeAudio,
  mediaTypeMapping,
  isAudioInputSupportedForPTT
}
