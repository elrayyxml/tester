/**
 * Debugging and logging utilities.
 *
 * The logger honors the `debug` configuration of the Client. When debug is
 * disabled, debug/info output is suppressed. Sensitive data (credentials,
 * keys, tokens, private message content) is never logged.
 *
 * @module utils/logs
 */

const PREFIX = '[NEXRAY]'

/**
 * Creates a logger bound to the Client debug configuration.
 *
 * @param {boolean} [enabled=false] - Whether debug output is enabled.
 * @param {object} [sink] - Output sink (defaults to console).
 * @returns {Logger} A logger object with debug/info/warn/error methods.
 */
export function createLogger(enabled = false, sink = console) {
    const write = (level, args) => {
        if (!enabled && level === 'debug') {
            return
        }
        const fn = sink[level] || sink.log
        if (typeof fn === 'function') {
            fn.call(sink, PREFIX, ...args)
        }
    }
    return {
        debug: (...args) => write('debug', args),
        info: (...args) => write('info', args),
        warn: (...args) => write('warn', args),
        error: (...args) => write('error', args)
    }
}

/**
 * Sanitizes a value so it is safe for logging (no credentials/tokens).
 *
 * @param {unknown} value - Value to sanitize.
 * @returns {unknown} The original value when safe, or a redacted placeholder.
 */
export function sanitizeForLog(value) {
    if (value == null) {
        return value
    }
    if (typeof value === 'string') {
        if (/(credential|auth|token|key|secret|password)/i.test(value) && value.length > 12) {
            return `${value.slice(0, 4)}…redacted`
        }
        return value
    }
    if (Buffer.isBuffer(value)) {
        return `<Buffer ${value.length} bytes>`
    }
    return value
}