/**
 * Centralized error codes used across the library.
 *
 * Every validation / engine error thrown by the library must use one of
 * these codes instead of an arbitrary string.
 *
 * @namespace
 */
export const ErrorCodes = Object.freeze({
    /** The configured engine is missing or does not expose a required primitive. */
    INVALID_ENGINE: 'INVALID_ENGINE',
    /** The supplied options or payload are invalid. */
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    /** The supplied socket is not a valid object. */
    INVALID_SOCKET: 'INVALID_SOCKET',
    /** A destination JID is required but was not provided. */
    INVALID_JID: 'INVALID_JID',
    /** The supplied media input is empty or incompatible. */
    INVALID_MEDIA: 'INVALID_MEDIA',
    /** The supplied message payload is invalid. */
    INVALID_MESSAGE: 'INVALID_MESSAGE',
    /** A date field is required or is not a valid date. */
    INVALID_DATE: 'INVALID_DATE',
    /** The operation is only allowed for newsletter JIDs. */
    NEWSLETTER_ONLY: 'NEWSLETTER_ONLY',
    /** A media download operation failed. */
    MEDIA_DOWNLOAD: 'MEDIA_DOWNLOAD',
    /** Media processing failed. */
    MEDIA_PROCESS: 'MEDIA_PROCESS',
    /** Message relay failed. */
    RELAY_FAILED: 'RELAY_FAILED',
    /** The configured engine does not expose the required feature. */
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
    /** A required argument is missing. */
    MISSING_ARGUMENT: 'MISSING_ARGUMENT'
})

/**
 * Error thrown by the library for validation and engine-level failures.
 *
 * @class
 * @extends Error
 * @param {string} message - Human readable error description.
 * @param {string} [code=ErrorCodes.INVALID_OPTIONS] - Centralized error code.
 */
export class NexrayError extends Error {
    constructor(message, code = ErrorCodes.INVALID_OPTIONS) {
        super(message)
        this.name = 'NexrayError'
        this.code = code
    }
}

/**
 * Creates a {@link NexrayError}.
 *
 * @param {string} message - Human readable error description.
 * @param {string} [code=ErrorCodes.INVALID_OPTIONS] - Centralized error code.
 * @param {object} [details] - Optional contextual details attached to the error.
 * @returns {NexrayError} A configured NexrayError instance.
 */
export function createError(message, code = ErrorCodes.INVALID_OPTIONS, details = null) {
    const error = new NexrayError(message, code)
    if (details !== null) {
        error.details = details
    }
    return error
}

/**
 * Re-throws an unknown error as a NexrayError if it is not already one.
 *
 * @param {unknown} error - The caught error.
 * @param {string} message - Message used when the error needs to be wrapped.
 * @param {string} [code=ErrorCodes.RELAY_FAILED] - Centralized error code.
 * @returns {NexrayError} The original error or a wrapped NexrayError.
 */
export function toNexrayError(error, message, code = ErrorCodes.RELAY_FAILED) {
    if (error instanceof NexrayError) {
        return error
    }
    return createError(message, code, { cause: error })
}