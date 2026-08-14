"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * @nexray/lib — constant/errors.js
 * Custom error class + baseline error messages shared across the library.
 */

class NexrayError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, statusCode?: number, data?: any }} [opts]
   */
  constructor(message, opts) {
    super(message);
    opts = opts || {};
    this.name = "NexrayError";
    this.code = opts.code || "NEXRAY_ERROR";
    this.statusCode = opts.statusCode || 500;
    if (opts.data !== undefined) this.data = opts.data;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NexrayError);
    }
  }
}

/** Predefined error messages, reused across core/ and listener/ for consistency. */
var ErrorMessages = {
  INVALID_MEDIA: "Invalid media input. Expected Buffer, URL, path or stream.",
  INVALID_NEWSLETTER_JID: "Target JID is not a valid newsletter JID (must end with @newsletter).",
  LEGACY_LIST_IN_GROUP: "Legacy list messages are only supported in private chats.",
  QUIZ_MISSING_CORRECT: "Quiz poll requires a correctAnswer option.",
  QUIZ_NEWSLETTER_ONLY: "Quiz messages are only allowed for newsletters.",
  MISSING_JID: "JID is required.",
  MISSING_CONTENT: "Message content is required.",
  INVALID_BUFFER: "Failed to resolve media buffer.",
  UPLOAD_FAILED: "Media upload failed.",
  LINK_PREVIEW_FAILED: "Failed to generate link preview (best-effort, ignored).",
  INVALID_ALBUM: "Album requires at least 2 valid media items (image/video).",
  INVALID_SOCKET: "Extend()/Client() requires a valid Baileys socket instance (missing relayMessage)."
};

exports.NexrayError = NexrayError;
exports.ErrorMessages = ErrorMessages;
