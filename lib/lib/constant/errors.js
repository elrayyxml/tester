'use strict'

/**
 * Custom error class for @nexray/lib.
 */
class NexrayError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, statusCode?: number }} [opts]
   */
  constructor(message, opts = {}) {
    super(message)
    this.name = 'NexrayError'
    this.code = opts.code || 'NEXRAY_ERROR'
    this.statusCode = opts.statusCode || 500
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NexrayError)
    }
  }
}

/** Predefined error messages */
const ErrorMessages = {
  INVALID_MEDIA: 'Invalid media input. Expected Buffer, URL, path or stream.',
  INVALID_NEWSLETTER_JID: 'Target JID is not a valid newsletter JID (must end with @newsletter).',
  LEGACY_LIST_IN_GROUP: 'Legacy list messages are only supported in private chats.',
  QUIZ_MISSING_CORRECT: 'Quiz poll requires a correctAnswer option.',
  MISSING_JID: 'JID is required.',
  MISSING_CONTENT: 'Message content is required.',
  INVALID_BUFFER: 'Failed to resolve media buffer.',
  UPLOAD_FAILED: 'Media upload failed.',
  LINK_PREVIEW_FAILED: 'Failed to generate link preview (best-effort, ignored).'
}

module.exports = {
  NexrayError,
  ErrorMessages
}
