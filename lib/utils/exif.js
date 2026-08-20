/**
 * Sticker EXIF manipulation.
 *
 * WhatsApp stickers carry EXIF metadata inside the WebP container. This
 * module builds, injects, and reads that metadata so stickers can carry
 * pack name, publisher, emojis, and accessibility text.
 *
 * @module utils/exif
 */

import { ErrorCodes, createError } from '../constant/index.js'

const WEBP_HEADER = Buffer.from('RIFF')
const WEBP_RIFF = Buffer.from('WEBP')

/**
 * Builds the binary EXIF payload for a sticker.
 *
 * @param {import('../types/utils.js').StickerMetadata} metadata - Sticker metadata object.
 * @returns {Buffer} Binary EXIF payload.
 */
export function buildStickerExif(metadata) {
    const json = Buffer.from(JSON.stringify(metadata), 'utf-8')
    const exif = Buffer.concat([
        Buffer.from([
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x41, 0x57, 0x07, 0x00
        ]),
        Buffer.alloc(4),
        Buffer.from([0x16, 0x00, 0x00, 0x00]),
        json
    ])
    exif.writeUInt32LE(json.length, 14)
    return exif
}

/**
 * Builds a WebP chunk header + payload with padding.
 *
 * @param {string} type - Four-character chunk type (e.g. `EXIF`).
 * @param {Buffer} data - Chunk payload.
 * @returns {Buffer} Complete chunk.
 */
export function makeChunk(type, data) {
    const typeBuffer = Buffer.from(type)
    const sizeBuffer = Buffer.alloc(4)
    sizeBuffer.writeUInt32LE(data.length, 0)
    const padding = data.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0)
    return Buffer.concat([typeBuffer, sizeBuffer, data, padding])
}

/**
 * Checks whether a buffer is a valid WebP image.
 *
 * @param {Buffer} buffer - Buffer to inspect.
 * @returns {boolean} True when the buffer is a WebP image.
 */
export function isWebP(buffer) {
    return Buffer.isBuffer(buffer) &&
        buffer.length >= 12 &&
        buffer.slice(0, 4).equals(WEBP_HEADER) &&
        buffer.slice(8, 12).equals(WEBP_RIFF)
}

/**
 * Checks whether a WebP buffer is animated.
 *
 * @param {Buffer} buffer - WebP buffer to inspect.
 * @returns {boolean} True when the WebP is animated.
 */
export function isAnimatedWebP(buffer) {
    if (!isWebP(buffer)) {
        return false
    }
    let offset = 12
    while (offset < buffer.length - 8) {
        const chunk = buffer.toString('ascii', offset, offset + 4)
        const size = buffer.readUInt32LE(offset + 4)
        if (chunk === 'VP8X' && (buffer[offset + 8] & 0x02)) {
            return true
        }
        if (chunk === 'ANIM' || chunk === 'ANMF') {
            return true
        }
        offset += 8 + size + (size % 2)
    }
    return false
}

/**
 * Injects EXIF metadata into a WebP sticker buffer.
 *
 * @param {Buffer} webpBuffer - WebP sticker buffer.
 * @param {import('../types/utils.js').StickerMetadata} metadata - Sticker metadata.
 * @returns {Buffer} New WebP buffer with the EXIF chunk embedded.
 * @throws {NexrayError} INVALID_MEDIA when the input is not a valid WebP.
 */
export function setWebpExif(webpBuffer, metadata) {
    if (!isWebP(webpBuffer)) {
        throw createError('Input is not a valid WEBP image.', ErrorCodes.INVALID_MEDIA)
    }
    const chunks = []
    let offset = 12
    while (offset + 8 <= webpBuffer.length) {
        const type = webpBuffer.slice(offset, offset + 4).toString()
        const size = webpBuffer.readUInt32LE(offset + 4)
        const chunkStart = offset
        const chunkEnd = offset + 8 + size + (size % 2)
        if (chunkEnd > webpBuffer.length) {
            break
        }
        if (type !== 'EXIF') {
            chunks.push(webpBuffer.slice(chunkStart, chunkEnd))
        }
        offset = chunkEnd
    }
    const exifPayload = buildStickerExif(metadata)
    const exifChunk = makeChunk('EXIF', exifPayload)
    const body = Buffer.concat([...chunks, exifChunk])
    const header = Buffer.alloc(12)
    header.write('RIFF', 0)
    header.writeUInt32LE(body.length + 4, 4)
    header.write('WEBP', 8)
    return Buffer.concat([header, body])
}

/**
 * Extracts the EXIF metadata string from a WebP sticker buffer.
 *
 * @param {Buffer} webpBuffer - WebP buffer to read.
 * @returns {string|null} The raw EXIF JSON string or null.
 */
export function getWebpExif(webpBuffer) {
    if (!isWebP(webpBuffer)) {
        return null
    }
    let offset = 12
    while (offset + 8 <= webpBuffer.length) {
        const type = webpBuffer.slice(offset, offset + 4).toString()
        const size = webpBuffer.readUInt32LE(offset + 4)
        const chunkEnd = offset + 8 + size + (size % 2)
        if (chunkEnd > webpBuffer.length) {
            break
        }
        if (type === 'EXIF') {
            return webpBuffer.slice(offset + 8, offset + 8 + size).toString('utf-8')
        }
        offset = chunkEnd
    }
    return null
}

/**
 * Parses the EXIF JSON of a WebP sticker into an object.
 *
 * @param {Buffer} webpBuffer - WebP buffer to parse.
 * @returns {object|null} Parsed metadata or null.
 */
export function parseWebpExif(webpBuffer) {
    const raw = getWebpExif(webpBuffer)
    if (!raw) {
        return null
    }
    try {
        const json = raw.slice(raw.indexOf('{'))
        return JSON.parse(json)
    } catch {
        return null
    }
}