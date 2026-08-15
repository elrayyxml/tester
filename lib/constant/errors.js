'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.NexrayError = exports.ErrorCodes = void 0;

/**
 * Standard error codes used across @nexray/lib
 */
exports.ErrorCodes = {
    INVALID_SOCKET: 'INVALID_SOCKET',
    INVALID_JID: 'INVALID_JID',
    INVALID_MEDIA: 'INVALID_MEDIA',
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    MEDIA_DOWNLOAD: 'MEDIA_DOWNLOAD',
    MEDIA_PROCESS: 'MEDIA_PROCESS',
    RELAY_FAILED: 'RELAY_FAILED',
    SERIALIZE_FAILED: 'SERIALIZE_FAILED',
    UTILS_OVERRIDE: 'UTILS_OVERRIDE',
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
};

/**
 * Custom error class for @nexray/lib
 */
class NexrayError extends Error {
    /**
     * @param {string} message
     * @param {string} [code]
     * @param {*} [data]
     */
    constructor(message, code, data) {
        super(message);
        this.name = 'NexrayError';
        this.code = code || 'UNKNOWN';
        this.data = data;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, NexrayError);
        }
    }
}

exports.NexrayError = NexrayError;
