"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * @nexray/lib — constant/configure.js
 *
 * Global configuration singleton. Values fall back to process.env and can
 * be overridden at runtime via setGlobalConfig().
 */

var defaults = {
  FFMPEG_PATH: process.env.FFMPEG_PATH || "ffmpeg",
  TEMP_DIR: process.env.TEMP_DIR || process.env.TEMPORARY_PATH || "temp",
  REQUEST_TIMEOUT: Number(process.env.REQUEST_TIMEOUT) || 60000,
  FFMPEG_TIMEOUT: Number(process.env.FFMPEG_TIMEOUT) || 90000,
  FFMPEG_CONCURRENCY: Number(process.env.FFMPEG_CONCURRENCY) || 4
};

var config = Object.assign({}, defaults);

/**
 * Get the current global config object (shallow copy).
 * @returns {typeof defaults}
 */
function getGlobalConfig() {
  return Object.assign({}, config);
}

/**
 * Merge partial config into the global config.
 * @param {Partial<typeof defaults>} [partial]
 */
function setGlobalConfig(partial) {
  if (partial && typeof partial === "object") {
    Object.assign(config, partial);
  }
}

/** No-op logger used whenever the consumer doesn't provide one. */
function noop() {}
var noopLogger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  trace: noop,
  child: function () {
    return noopLogger;
  }
};

/**
 * Resolve the effective logger: explicit options.logger > no-op fallback.
 * @param {{ logger?: object }} [options]
 */
function resolveLogger(options) {
  return (options && options.logger) || noopLogger;
}

exports.defaults = defaults;
exports.getGlobalConfig = getGlobalConfig;
exports.setGlobalConfig = setGlobalConfig;
exports.noopLogger = noopLogger;
exports.resolveLogger = resolveLogger;
