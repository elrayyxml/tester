/**
 * Media and data conversion utilities.
 *
 * Provides the media resolver used by every media helper. The resolver
 * accepts Buffer, local path, or URL input and normalizes it for the
 * engine's media preparation pipeline.
 *
 * @module utils/converter
 */

import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import mime from 'mime-types'
import {
    ErrorCodes,
    createError
} from '../constant/index.js'
import {
    isUrl,
    toText
} from './function.js'

const URL_OR_PATH_REGEX = /^(https?:\/\/|data:|\/|\.\/|\.\.\/|[a-zA-Z]:\\|~\/)/

/**
 * Detects the kind of media input provided.
 *
 * @param {import('../types/baileys.js').MediaInput} input - Media input.
 * @returns {{ kind: 'buffer'|'url'|'path'|'object'|'stream'|'unknown', value: any }} Detection result.
 */
export function detectMediaInput(input) {
    if (Buffer.isBuffer(input)) {
        return { kind: 'buffer', value: input }
    }
    if (input instanceof Readable || (input && typeof input.pipe === 'function')) {
        return { kind: 'stream', value: input }
    }
    if (typeof input === 'string') {
        if (input.startsWith('data:')) {
            return { kind: 'buffer', value: dataUrlToBuffer(input) }
        }
        if (isUrl(input)) {
            return { kind: 'url', value: input }
        }
        return { kind: 'path', value: input }
    }
    if (input && typeof input === 'object') {
        if (typeof input.url === 'string') {
            const url = input.url
            if (isUrl(url)) {
                return { kind: 'url', value: url }
            }
            return { kind: 'path', value: url }
        }
        if (input.stream) {
            return { kind: 'stream', value: input.stream }
        }
        return { kind: 'object', value: input }
    }
    return { kind: 'unknown', value: input }
}

/**
 * Converts a data URL into a Buffer.
 *
 * @param {string} dataUrl - Data URL string.
 * @returns {Buffer} Decoded buffer.
 */
export function dataUrlToBuffer(dataUrl) {
    const match = /^data:.*?;base64,(.*)$/s.exec(dataUrl)
    if (!match) {
        throw createError('Invalid data URL.', ErrorCodes.INVALID_MEDIA)
    }
    return Buffer.from(match[1], 'base64')
}

/**
 * Resolves any supported media input into a Buffer.
 *
 * @param {import('../types/baileys.js').MediaInput} input - Media input.
 * @param {object} [options] - Resolution options.
 * @param {object} [options.fetch] - Fetch implementation to use for URLs.
 * @returns {Promise<import('../types/utils.js').ResolvedMedia>} Resolved media.
 * @throws {NexrayError} INVALID_MEDIA when the input cannot be resolved.
 */
export async function resolveMedia(input, options = {}) {
    if (input == null) {
        throw createError('Media input is empty.', ErrorCodes.INVALID_MEDIA)
    }

    const detection = detectMediaInput(input)

    switch (detection.kind) {
        case 'buffer':
            return {
                buffer: detection.value,
                mimetype: options.mimetype || 'application/octet-stream',
                extension: options.extension || null,
                isUrl: false,
                isPath: false,
                isBuffer: true
            }
        case 'stream':
            return {
                buffer: await streamToBuffer(detection.value),
                mimetype: options.mimetype || 'application/octet-stream',
                extension: options.extension || null,
                isUrl: false,
                isPath: false,
                isBuffer: false
            }
        case 'url': {
            const buffer = await fetchUrlToBuffer(detection.value, options)
            const mimeType = options.mimetype || mime.lookup(detection.value) || 'application/octet-stream'
            return {
                buffer,
                mimetype: mimeType,
                extension: options.extension || mime.extension(mimeType) || null,
                isUrl: true,
                isPath: false,
                isBuffer: false
            }
        }
        case 'path': {
            const buffer = await readFile(detection.value)
            const mimeType = options.mimetype || mime.lookup(detection.value) || 'application/octet-stream'
            return {
                buffer,
                mimetype: mimeType,
                extension: options.extension || mime.extension(mimeType) || null,
                isUrl: false,
                isPath: true,
                isBuffer: false
            }
        }
        case 'object':
            if (Buffer.isBuffer(detection.value)) {
                return {
                    buffer: detection.value,
                    mimetype: options.mimetype || 'application/octet-stream',
                    extension: options.extension || null,
                    isUrl: false,
                    isPath: false,
                    isBuffer: true
                }
            }
            throw createError('Unsupported media object shape.', ErrorCodes.INVALID_MEDIA)
        default:
            throw createError('Unsupported media input format.', ErrorCodes.INVALID_MEDIA)
    }
}

/**
 * Fetches a URL and returns its content as a Buffer.
 *
 * @param {string} url - URL to fetch.
 * @param {object} [options] - Options passed to fetch.
 * @returns {Promise<Buffer>} Fetched content.
 * @throws {NexrayError} MEDIA_DOWNLOAD when the request fails.
 */
export async function fetchUrlToBuffer(url, options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch
    if (typeof fetchImpl !== 'function') {
        throw createError(
            'No fetch implementation available to download URL media.',
            ErrorCodes.NOT_IMPLEMENTED
        )
    }
    let response
    try {
        response = await fetchImpl(url)
    } catch (error) {
        throw createError(`Failed to download media from URL: ${toText(error)}`, ErrorCodes.MEDIA_DOWNLOAD, { cause: error })
    }
    if (!response.ok) {
        throw createError(`Failed to download media from URL (${response.status}).`, ErrorCodes.MEDIA_DOWNLOAD)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
}

/**
 * Collects a readable stream into a Buffer.
 *
 * @param {import('node:stream').Readable} stream - Input stream.
 * @returns {Promise<Buffer>} Buffered stream content.
 */
export async function streamToBuffer(stream) {
    const chunks = []
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}

/**
 * Alias of {@link streamToBuffer}.
 *
 * @param {import('node:stream').Readable} stream - Input stream.
 * @returns {Promise<Buffer>} Buffered stream content.
 */
export const toBuffer = streamToBuffer

/**
 * Converts a value into a Buffer from common representations.
 *
 * @param {Buffer|ArrayBuffer|Uint8Array|string|object} value - Value to convert.
 * @param {string} [encoding='base64'] - Encoding used for strings.
 * @returns {Buffer} Converted buffer.
 */
export function toBufferFrom(value, encoding = 'base64') {
    if (Buffer.isBuffer(value)) {
        return value
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value)
    }
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    }
    if (typeof value === 'string') {
        return Buffer.from(value, encoding)
    }
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data)
    }
    throw createError('Cannot convert value to Buffer.', ErrorCodes.INVALID_MEDIA)
}

/**
 * Detects the mime type of a buffer using magic bytes.
 *
 * @param {Buffer} buffer - Buffer to inspect.
 * @returns {string} Detected mime type or application/octet-stream.
 */
export function detectMimeType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return 'application/octet-stream'
    }
    if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
        return 'image/webp'
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        return 'image/jpeg'
    }
    if (buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
        return 'image/png'
    }
    if (buffer.slice(0, 4).toString('hex') === '66747970') {
        return 'video/mp4'
    }
    if (buffer.slice(0, 4).toString() === 'OggS') {
        return 'audio/ogg'
    }
    return 'application/octet-stream'
}

/**
 * Converts a Buffer into a base64 string.
 *
 * @param {Buffer} buffer - Buffer to encode.
 * @returns {string} Base64 string.
 */
export function toBase64(buffer) {
    return Buffer.isBuffer(buffer) ? buffer.toString('base64') : ''
}

/**
 * Converts a Buffer into a URL-safe base64 string.
 *
 * @param {Buffer} buffer - Buffer to encode.
 * @returns {string} URL-safe base64 string.
 */
export function toBase64Url(buffer) {
    return toBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Wraps a buffer into a readable stream.
 *
 * @param {Buffer} buffer - Buffer to wrap.
 * @returns {import('node:stream').Readable} Readable stream.
 */
export function bufferToStream(buffer) {
    return Readable.from([buffer])
}

export { URL_OR_PATH_REGEX }