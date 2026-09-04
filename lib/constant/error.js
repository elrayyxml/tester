/**
 * Centralized error codes for @nexray/lib.
 * All thrown errors must use these codes for predictable semantics.
 */

/**
 * @typedef {Object} NexrayError
 * @property {string} code
 * @property {string} message
 * @property {Error} [cause]
 */

export const ErrorCodes = Object.freeze({
    INVALID_ENGINE: 'INVALID_ENGINE',
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    INVALID_JID: 'INVALID_JID',
    INVALID_MEDIA: 'INVALID_MEDIA',
    INVALID_MESSAGE: 'INVALID_MESSAGE',
    INVALID_DATE: 'INVALID_DATE',
    NEWSLETTER_ONLY: 'NEWSLETTER_ONLY',
    INVALID_KEY: 'INVALID_KEY',
    MISSING_CAPABILITY: 'MISSING_CAPABILITY'
});

/** Alias matching PRD name `Error` without shadowing the global constructor. */
export const Error = ErrorCodes;

/**
 * Create a standardized error with a known code.
 *
 * @param {string} code - One of the Error.* constants.
 * @param {string} message - Human-readable description.
 * @param {globalThis.Error} [cause] - Optional underlying error.
 * @returns {globalThis.Error & { code: string }}
 */
export function createError(code, message, cause) {
    const err = new globalThis.Error(message);
    err.code = code;
    err.name = 'NexrayError';
    if (cause) {
        err.cause = cause;
    }
    return err;
}
