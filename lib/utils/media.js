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
 * Decode audio to mono PCM and map its amplitude into a WhatsApp voice-note waveform.
 * Baileys accepts the waveform as a Buffer of unsigned 8-bit samples.
 */
async function getAudioWaveform(input, logger, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)
  const sampleCount = Math.max(16, Math.min(256, Number(options.sampleCount || 64)))
  const temp = path.join(os.tmpdir(), `nexray-audio-${crypto.randomBytes(8).toString('hex')}`)
  const inputPath = `${temp}.input`
  try {
    await fs.promises.writeFile(inputPath, buffer)
    const { stdout } = await execFileAsync(options.ffmpegPath || getGlobalConfig().FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'
    ], { maxBuffer: 32 * 1024 * 1024, timeout: getGlobalConfig().FFMPEG_TIMEOUT || 30000, encoding: 'buffer' })
    const pcm = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '')
    if (!pcm.length) return undefined
    const sampleTotal = Math.floor(pcm.length / 2)
    const waveform = Buffer.alloc(sampleCount)
    let peak = 1
    const peaks = new Array(sampleCount).fill(0)
    for (let i = 0; i < sampleCount; i++) {
      const start = Math.floor(i * sampleTotal / sampleCount)
      const end = Math.max(start + 1, Math.floor((i + 1) * sampleTotal / sampleCount))
      let sum = 0
      let count = 0
      for (let p = start; p < end && p < sampleTotal; p++) {
        sum += Math.abs(pcm.readInt16LE(p * 2))
        count++
      }
      peaks[i] = count ? sum / count : 0
      peak = Math.max(peak, peaks[i])
    }
    for (let i = 0; i < sampleCount; i++) waveform[i] = Math.max(0, Math.min(255, Math.round(peaks[i] * 255 / peak)))
    return waveform
  } catch (error) {
    logger?.debug?.({ err: error }, 'audio waveform generation skipped')
    return undefined
  } finally {
    await fs.promises.rm(inputPath, { force: true }).catch(() => {})
  }
}

async function getAudioDuration(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input)
  const temp = path.join(os.tmpdir(), `nexray-duration-${crypto.randomBytes(8).toString('hex')}.input`)
  try {
    await fs.promises.writeFile(temp, buffer)
    const { stdout } = await execFileAsync(options.ffprobePath || 'ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', temp
    ], { timeout: getGlobalConfig().FFMPEG_TIMEOUT || 30000, encoding: 'utf8' })
    const duration = Number.parseFloat(String(stdout).trim())
    return Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : undefined
  } catch {
    return undefined
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {})
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

async function decodeAudio(input, options = {}) {
  const original = await getBufferFromUrl(input)
  const audio = options.ptt && options.transcode !== false
    ? await transcodeAudioToOpus(original, options)
    : original
  const result = { audio }
  if (options.ptt) {
    result.waveform = options.waveform || await getAudioWaveform(audio, options.logger, options)
    result.seconds = options.seconds ?? await getAudioDuration(audio, options)
  }
  return result
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
  decodeAudio
}
