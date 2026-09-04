/**
 * Utility-related contracts.
 * @module types/utils
 */

/**
 * @typedef {Object} DetectedMedia
 * @property {'buffer'|'file'|'url'|'stream'|'invalid'} type
 * @property {Buffer|string|import('stream').Readable} [value]
 */

/**
 * @typedef {Object} SerializedMessage
 * @property {object} key
 * @property {object} [message]
 * @property {string} [sender]
 * @property {string} [remoteJid]
 * @property {string} [messageType]
 * @property {object} [quoted]
 * @property {object} [metadata]
 */

export {};
