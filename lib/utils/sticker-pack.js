/**
 * Sticker pack metadata and payload construction.
 *
 * Builds the encrypted ZIP archive that powers `StickerPackMessage` and
 * returns the full protobuf payload. The upload itself is delegated to the
 * configured engine socket (`waUploadToServer`), so no transport logic lives
 * here.
 *
 * @module utils/sticker-pack
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { createRequire } from 'node:module'
import {
    ErrorCodes,
    createError
} from '../constant/index.js'
import {
    randomBytes,
    sha256,
    encryptMedia,
    makeMessageSecret
} from './cryptokey.js'
import {
    resolveMedia,
    streamToBuffer,
    toBase64Url
} from './converter.js'
import {
    isWebP,
    isAnimatedWebP
} from './exif.js'

const require = createRequire(import.meta.url)
const STICKER_PACK_HKDF = 'WhatsApp Sticker Pack Keys'
const STICKER_PACK_THUMB_HKDF = 'WhatsApp Sticker Pack Thumbnail Keys'
const CONCURRENCY_LIMIT = 15

/**
 * Lazily loads an image processing library (sharp) for WebP conversion.
 *
 * @returns {Promise<{ default: object }>} The sharp module.
 * @throws {NexrayError} NOT_IMPLEMENTED when sharp is unavailable.
 */
export async function getImageProcessor() {
    try {
        const sharpModule = await import('sharp')
        if (sharpModule.default) {
            return sharpModule
        }
        throw new Error('sharp default export missing')
    } catch (error) {
        throw createError(
            'sharp is required for sticker conversion. Install it with `npm install sharp`.',
            ErrorCodes.NOT_IMPLEMENTED,
            { cause: error }
        )
    }
}

/**
 * Converts a buffer into a WebP sticker using sharp.
 *
 * @param {Buffer} buffer - Source image/video frame buffer.
 * @param {object} [options] - Conversion options.
 * @param {boolean} [options.animated=false] - Keep animation frames.
 * @returns {Promise<Buffer>} WebP buffer.
 */
export async function toWebP(buffer, options = {}) {
    const sharp = await getImageProcessor()
    const pipeline = sharp.default(buffer, { animated: options.animated || false })
        .resize(512, 512, { fit: 'inside' })
        .webp({ quality: 80 })
    return pipeline.toBuffer()
}

/**
 * Converts a buffer into a JPEG thumbnail using sharp.
 *
 * @param {Buffer} buffer - Source buffer.
 * @param {number} [size=252] - Thumbnail size in pixels.
 * @returns {Promise<Buffer>} JPEG buffer.
 */
export async function toJpegThumbnail(buffer, size = 252) {
    const sharp = await getImageProcessor()
    return sharp.default(buffer)
        .resize(size, size, { fit: 'cover' })
        .jpeg()
        .toBuffer()
}

/**
 * Uploads an encrypted buffer to WhatsApp's media servers through the engine socket.
 *
 * @param {object} sock - The augmented engine socket.
 * @param {Buffer} buffer - Raw (unencrypted) buffer to upload.
 * @param {string} mediaPath - Upload path (e.g. `/mms/sticker-pack`).
 * @param {string} hkdfInfo - HKDF info string.
 * @param {Buffer} [mediaKey] - Existing media key to reuse.
 * @returns {Promise<object>} Upload result with mediaUrl/directPath/sha256 fields.
 * @throws {NexrayError} NOT_IMPLEMENTED when the socket has no upload function.
 */
export async function uploadEncryptedBuffer(sock, buffer, mediaPath, hkdfInfo, mediaKey) {
    const key = mediaKey || randomBytes(32)
    const { encBuffer, iv, cipherKey, macKey } = encryptMedia(buffer, key, hkdfInfo)
    const fileSha256 = sha256(buffer)
    const fileEncSha256 = sha256(encBuffer)

    const uploadFn = sock.waUploadToServer || sock.upload
    if (typeof uploadFn === 'function') {
        try {
            const result = await uploadFn(encBuffer, {
                fileEncSha256B64: fileEncSha256.toString('base64'),
                mediaType: mediaPath === '/mms/thumbnail-sticker-pack' ? 'thumbnail-sticker-pack' : 'sticker-pack',
                timeoutMs: 60000
            })
            return {
                mediaKey: key,
                iv, cipherKey, macKey,
                fileSha256, fileEncSha256,
                fileLength: buffer.length,
                mediaUrl: result.mediaUrl || result.url,
                directPath: result.directPath || result.direct_path,
                ...result
            }
        } catch (_) { /* fallback to raw upload */ }
    }

    return rawUpload(sock, buffer, encBuffer, fileSha256, fileEncSha256, key, mediaPath)
}

async function rawUpload(sock, buffer, encBuffer, fileSha256, fileEncSha256, mediaKey, mediaPath) {
    const crypto = (await import('node:crypto')).default
    const https = (await import('node:https')).default

    const iq = await sock.query({
        tag: 'iq',
        attrs: {
            id: sock.generateMessageTag?.() ?? Date.now().toString(),
            to: 's.whatsapp.net',
            type: 'set',
            xmlns: 'w:m',
        },
        content: [{ tag: 'media_conn', attrs: {} }],
    })

    const mediaConn = iq.content?.find(v => v.tag === 'media_conn')
    if (!mediaConn) throw createError('media_conn not found', ErrorCodes.NOT_IMPLEMENTED)

    const auth = mediaConn.attrs?.auth
    if (!auth) throw createError('media_conn auth not found', ErrorCodes.NOT_IMPLEMENTED)

    const hosts = (mediaConn.content || [])
        .filter(v => v.tag === 'host')
        .map(v => v.attrs?.hostname)
        .filter(Boolean)

    if (!hosts.length) throw createError('No upload hosts found', ErrorCodes.NOT_IMPLEMENTED)

    const token = encodeURIComponent(
        fileEncSha256.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    )

    let lastError
    for (const host of hosts) {
        try {
            const json = await new Promise((resolve, reject) => {
                const url = new URL(`https://${host}${mediaPath}/${token}?auth=${encodeURIComponent(auth)}&token=${token}`)
                const req = https.request({
                    hostname: url.hostname,
                    port: 443,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        Origin: 'https://web.whatsapp.com',
                        Referer: 'https://web.whatsapp.com/',
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': encBuffer.length,
                    },
                }, (res) => {
                    let body = ''
                    res.on('data', c => body += c)
                    res.on('end', () => {
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            return reject(new Error(`Upload failed ${res.statusCode}: ${body}`))
                        }
                        try { resolve(JSON.parse(body)) } catch { reject(new Error(`Non-JSON: ${body}`)) }
                    })
                })
                req.on('error', reject)
                req.write(encBuffer)
                req.end()
            })

            const directPath = json.direct_path ?? json.directPath ?? json.url ?? json.path
            if (!directPath) throw new Error('directPath not found')

            return {
                mediaKey,
                fileLength: buffer.length,
                fileSha256,
                fileEncSha256,
                directPath,
                ...json,
            }
        } catch (e) {
            lastError = e
        }
    }
    throw lastError ?? createError('All upload hosts failed', ErrorCodes.RELAY_FAILED)
}

/**
 * Builds the complete sticker pack payload.
 *
 * @param {object} params - Pack input.
 * @param {import('../types/utils.js').MediaInput[]} params.stickers - Sticker media inputs.
 * @param {import('../types/utils.js').MediaInput} params.cover - Cover/tray icon media.
 * @param {string} [params.name=''] - Pack name.
 * @param {string} [params.publisher=''] - Pack publisher.
 * @param {string} [params.description=''] - Pack description.
 * @param {string[]} [params.emojis=[]] - Default sticker emojis.
 * @param {string[]} [params.accessibilityLabels=[]] - Per-sticker accessibility labels.
 * @param {object} sock - The augmented engine socket (for uploads).
 * @param {object} [options] - Build options.
 * @param {boolean} [options.animated=false] - Keep animated frames for video sources.
 * @returns {Promise<object>} StickerPackMessage protobuf payload.
 * @throws {NexrayError} INVALID_MEDIA when validation fails.
 */
export async function buildStickerPackPayload({
    stickers = [],
    cover,
    name = '',
    publisher = '',
    description = '',
    emojis = [],
    accessibilityLabels = []
}, sock, options = {}) {
    if (!Array.isArray(stickers) || stickers.length === 0) {
        throw createError('Sticker pack must contain at least one sticker.', ErrorCodes.INVALID_MEDIA)
    }
    if (stickers.length > 60) {
        throw createError('Sticker pack exceeds the maximum limit of 60 stickers.', ErrorCodes.INVALID_MEDIA)
    }
    if (!cover) {
        throw createError('Sticker pack must contain a cover.', ErrorCodes.INVALID_MEDIA)
    }

    const sharp = await getImageProcessor()
    const stickerData = {}
    const metadata = new Array(stickers.length)

    for (let i = 0; i < stickers.length; i += CONCURRENCY_LIMIT) {
        const chunkEnd = Math.min(i + CONCURRENCY_LIMIT, stickers.length)
        const tasks = []
        for (let j = i; j < chunkEnd; j++) {
            tasks.push((async (index) => {
                const sticker = stickers[index]
                const resolved = await resolveMedia(sticker.media ?? sticker)
                let webpBuffer = resolved.buffer
                let isAnimated = false
                if (isWebP(webpBuffer)) {
                    isAnimated = isAnimatedWebP(webpBuffer)
                } else {
                    webpBuffer = await toWebP(webpBuffer, { animated: options.animated })
                }
                if (webpBuffer.length > 1024 * 1024) {
                    throw createError(
                        `Sticker at index ${index} exceeds the 1MB size limit.`,
                        ErrorCodes.INVALID_MEDIA
                    )
                }
                const hash = toBase64Url(sha256(webpBuffer))
                const fileName = `${hash}.webp`
                stickerData[fileName] = [new Uint8Array(webpBuffer), { level: 0 }]
                metadata[index] = {
                    fileName,
                    mimetype: 'image/webp',
                    isAnimated,
                    emojis: sticker.emojis || emojis,
                    accessibilityLabel: sticker.accessibilityLabel || accessibilityLabels[index] || '\u200e'
                }
            })(j))
        }
        await Promise.all(tasks)
    }

    const packId = randomBytes(8).toString('hex')
    const trayIconFileName = `${packId}.webp`
    const coverResolved = await resolveMedia(cover.media ?? cover)
    let coverWebpBuffer = coverResolved.buffer
    if (!isWebP(coverWebpBuffer)) {
        coverWebpBuffer = await toWebP(coverWebpBuffer, { animated: false })
    }
    stickerData[trayIconFileName] = [new Uint8Array(coverWebpBuffer), { level: 0 }]

    const zip = new JSZip()
    for (const [fileName, [content]] of Object.entries(stickerData)) {
        zip.file(fileName, content)
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })

    const packUpload = await uploadEncryptedBuffer(sock, zipBuffer, '/mms/sticker-pack', STICKER_PACK_HKDF)

    const obj = {
        name,
        publisher,
        stickerPackId: packId,
        packDescription: description,
        stickerPackOrigin: 2,
        stickerPackSize: zipBuffer.length,
        stickers: metadata,
        fileSha256: packUpload.fileSha256,
        fileEncSha256: packUpload.fileEncSha256,
        mediaKey: packUpload.mediaKey,
        directPath: packUpload.directPath,
        fileLength: packUpload.fileLength,
        mediaKeyTimestamp: Math.floor(Date.now() / 1000),
        trayIconFileName
    }

    try {
        const thumbnailBuffer = await toJpegThumbnail(coverWebpBuffer, 252)
        const thumbUpload = await uploadEncryptedBuffer(
            sock,
            thumbnailBuffer,
            '/mms/thumbnail-sticker-pack',
            STICKER_PACK_THUMB_HKDF,
            packUpload.mediaKey
        )
        Object.assign(obj, {
            thumbnailDirectPath: thumbUpload.directPath,
            thumbnailSha256: thumbUpload.fileSha256,
            thumbnailEncSha256: thumbUpload.fileEncSha256,
            thumbnailHeight: 252,
            thumbnailWidth: 252,
            imageDataHash: sha256(thumbnailBuffer).toString('base64')
        })
    } catch {
        // Thumbnail generation/upload is best-effort; the pack still works without it.
    }

    return {
        messageContextInfo: {
            messageSecret: makeMessageSecret()
        },
        stickerPackMessage: obj
    }
}

/**
 * Streams helper re-export for consumers that need raw sticker processing.
 *
 * @param {import('node:stream').Readable} stream - Stream to buffer.
 * @returns {Promise<Buffer>} Buffered stream content.
 */
export { streamToBuffer as stickerStreamToBuffer }