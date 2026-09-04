/**
 * Centralized logger for @nexray/lib.
 * Never logs auth keys, credentials, tokens, or private message content.
 * Uses ANSI codes directly (no chalk dependency required at runtime).
 */

const PREFIX = '[NEXRAY]';

const c = {
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`
};

/** @type {boolean} */
let enabled = false;

/**
 * Enable or disable debug output.
 * @param {boolean} value
 */
export function setDebug(value) {
    enabled = Boolean(value);
}

/**
 * @returns {boolean}
 */
export function isDebugEnabled() {
    return enabled;
}

/**
 * Strip potentially sensitive fields from an object before logging.
 * @param {*} value
 * @returns {*}
 */
function sanitize(value) {
    if (value == null || typeof value !== 'object') {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return `<Buffer length=${value.length}>`;
    }
    if (Array.isArray(value)) {
        return value.map(sanitize);
    }
    const out = {};
    const sensitive = /auth|key|token|cred|session|password|secret|private/i;
    for (const [k, v] of Object.entries(value)) {
        if (sensitive.test(k)) {
            out[k] = '[REDACTED]';
        } else {
            out[k] = sanitize(v);
        }
    }
    return out;
}

function formatArgs(args) {
    return args.map((a) => {
        if (typeof a === 'object' && a !== null) {
            try {
                return JSON.stringify(sanitize(a));
            } catch {
                return String(a);
            }
        }
        return String(a);
    }).join(' ');
}

/** @param {...*} args */
export function debug(...args) {
    if (!enabled) return;
    console.log(c.gray(`${PREFIX} ${formatArgs(args)}`));
}

/** @param {...*} args */
export function info(...args) {
    if (!enabled) return;
    console.log(c.cyan(`${PREFIX} ${formatArgs(args)}`));
}

/** @param {...*} args */
export function success(...args) {
    if (!enabled) return;
    console.log(c.green(`${PREFIX} ${formatArgs(args)}`));
}

/** @param {...*} args */
export function warning(...args) {
    console.warn(c.yellow(`${PREFIX} ${formatArgs(args)}`));
}

/** @param {...*} args */
export function error(...args) {
    console.error(c.red(`${PREFIX} ${formatArgs(args)}`));
}

export const logs = { setDebug, isDebugEnabled, debug, info, success, warning, error };
