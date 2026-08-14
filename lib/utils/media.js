"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var Readable = require("stream").Readable;
var NexrayErrors = require("../constant/errors");
var NexrayError = NexrayErrors.NexrayError;
var ErrorMessages = NexrayErrors.ErrorMessages;
var configure = require("../constant/configure");
var getGlobalConfig = configure.getGlobalConfig;
var resolveLogger = configure.resolveLogger;

/**
 * @nexray/lib — utils/media.js
 *
 * Media helpers: buffer/stream normalization, mime detection, image
 * thumbnails, and audio duration/waveform extraction for PTT (voice note)
 * messages via `audio-decode`.
 */

var fileType = null;
try {
  fileType = require("file-type");
} catch (e) {
  fileType = null;
}

var sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  sharp = null;
}

var Jimp = null;
try {
  Jimp = require("jimp").Jimp || require("jimp");
} catch (e) {
  Jimp = null;
}

/**
 * Download or read a buffer from URL / local path / Buffer / stream.
 * @param {string|Buffer|import('stream').Readable} input
 * @returns {Promise<Buffer>}
 */
async function getBufferFromUrl(input) {
  if (Buffer.isBuffer(input)) return input;

  if (input && typeof input.pipe === "function") {
    var chunks = [];
    for await (var chunk of input) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  if (typeof input === "string") {
    if (/^https?:\/\//i.test(input)) {
      var controller = new AbortController();
      var timeout = setTimeout(function () {
        controller.abort();
      }, getGlobalConfig().REQUEST_TIMEOUT);
      try {
        var res = await fetch(input, { signal: controller.signal });
        if (!res.ok) {
          throw new NexrayError("HTTP " + res.status + " while fetching media", { code: "FETCH_FAILED" });
        }
        var ab = await res.arrayBuffer();
        return Buffer.from(ab);
      } finally {
        clearTimeout(timeout);
      }
    }
    // local path
    return fs.promises.readFile(input);
  }

  throw new NexrayError(ErrorMessages.INVALID_MEDIA, { code: "INVALID_MEDIA" });
}

/**
 * Detect MIME type from magic bytes (via `file-type`), falling back to
 * extension lookup and a minimal magic-byte sniff.
 * @param {Buffer} buffer
 * @param {string} [fallbackExt]
 * @returns {Promise<string>}
 */
async function detectMime(buffer, fallbackExt) {
  if (fileType) {
    try {
      var type = await fileType.fromBuffer(buffer);
      if (type && type.mime) return type.mime;
    } catch (e) {
      // ignore, fall through
    }
  }
  if (fallbackExt) {
    try {
      var mime = require("mime-types").lookup(fallbackExt);
      if (mime) return mime;
    } catch (e) {
      // mime-types not available, ignore
    }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "image/webp";
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00) return "video/mp4";
  return "application/octet-stream";
}

/**
 * Normalize any input into a readable stream.
 * @param {string|Buffer|import('stream').Readable} input
 * @returns {Promise<import('stream').Readable>}
 */
async function getStream(input) {
  if (input && typeof input.pipe === "function") return input;
  var buf = await getBufferFromUrl(input);
  return Readable.from(buf);
}

/**
 * Extract a compressed JPEG thumbnail from an image stream/buffer.
 * Prefers `sharp`, falls back to `jimp`, and returns the original buffer
 * untouched if neither image library is available.
 * @param {Buffer|import('stream').Readable} input
 * @param {number} [width=72]
 * @returns {Promise<Buffer>}
 */
async function extractImageThumb(input, width) {
  width = width || 72;
  var buf = Buffer.isBuffer(input) ? input : await getBufferFromUrl(input);

  if (sharp) {
    return sharp(buf).resize(width, width, { fit: "inside" }).jpeg({ quality: 50 }).toBuffer();
  }

  if (Jimp) {
    var img = await Jimp.read(buf);
    if (typeof img.scaleToFit === "function") {
      img.scaleToFit(width, width);
      return img.quality(50).getBufferAsync(Jimp.MIME_JPEG || "image/jpeg");
    }
    // jimp v1 API
    var ratio = width / img.bitmap.width;
    img.resize({ w: width, h: Math.max(1, Math.round(img.bitmap.height * ratio)) });
    return img.getBuffer("image/jpeg");
  }

  return buf;
}

/**
 * Get a compressed thumbnail suitable for link-preview.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function getCompressedThumbnail(buffer) {
  return extractImageThumb(buffer, 100);
}

/**
 * Writes a buffer to a temp file inside the configured temp dir. Caller is
 * responsible for cleanup.
 * @param {Buffer} buffer
 * @param {string} [ext='.tmp']
 * @returns {Promise<string>}
 */
async function writeTempFile(buffer, ext) {
  ext = ext || ".tmp";
  var tempDir = getGlobalConfig().TEMP_DIR;
  var dir = path.isAbsolute(tempDir) ? tempDir : path.join(process.cwd(), tempDir);
  await fs.promises.mkdir(dir, { recursive: true }).catch(function () {});
  var filePath = path.join(dir, crypto.randomBytes(8).toString("hex") + ext);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Extracts audio duration (in seconds) from a buffer using `audio-decode`
 * (pure JS, no external ffmpeg binary required — matches the request to
 * keep PTT support self-contained).
 * @param {Buffer} buffer
 * @param {{ logger?: object }} [options]
 * @returns {Promise<number>}
 */
async function getAudioDuration(buffer, options) {
  var logger = resolveLogger(options);
  try {
    var decode = require("audio-decode");
    var audioBuffer = await decode(buffer);
    if (typeof audioBuffer.duration === "number") return audioBuffer.duration;
    return audioBuffer.length / audioBuffer.sampleRate;
  } catch (err) {
    logger.warn({ trace: err && err.stack }, "getAudioDuration: audio-decode failed, defaulting to 0");
    return 0;
  }
}

/**
 * Generates a WhatsApp-style waveform (Uint8Array of ~64 amplitude samples,
 * 0-100 range) for PTT voice-note messages, using `audio-decode` to read
 * raw PCM channel data and downsampling it into peak buckets.
 * @param {Buffer} buffer
 * @param {{ logger?: object }} [options]
 * @returns {Promise<Uint8Array>}
 */
async function getAudioWaveform(buffer, options) {
  var logger = resolveLogger(options);
  try {
    var decode = require("audio-decode");
    var audioBuffer = await decode(buffer);
    var channelData = audioBuffer.getChannelData(0);
    var samples = 64;
    var blockSize = Math.max(1, Math.floor(channelData.length / samples));
    var waveform = new Uint8Array(samples);

    for (var i = 0; i < samples; i++) {
      var sum = 0;
      var start = i * blockSize;
      for (var j = 0; j < blockSize; j++) {
        var v = channelData[start + j];
        sum += Math.abs(v || 0);
      }
      var avg = sum / blockSize;
      waveform[i] = Math.min(100, Math.round(avg * 100));
    }

    return waveform;
  } catch (err) {
    logger.warn({ trace: err && err.stack }, "getAudioWaveform: audio-decode failed, using flat fallback waveform");
    // Flat fallback so sendMedia({ ptt: true }) never hard-fails just
    // because waveform extraction wasn't possible in this environment.
    return new Uint8Array(64).fill(0);
  }
}

exports.getBufferFromUrl = getBufferFromUrl;
exports.detectMime = detectMime;
exports.getStream = getStream;
exports.extractImageThumb = extractImageThumb;
exports.getCompressedThumbnail = getCompressedThumbnail;
exports.writeTempFile = writeTempFile;
exports.getAudioDuration = getAudioDuration;
exports.getAudioWaveform = getAudioWaveform;
