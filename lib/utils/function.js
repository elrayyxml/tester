/**
 * Shared pure helpers used across core.
 */

/**
 * Check whether a value is a non-null plain object.
 * @param {*} v
 * @returns {boolean}
 */
export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

/**
 * Sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safe string coercion for JIDs / IDs.
 * @param {*} v
 * @returns {string|null}
 */
export function asString(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    return null;
}

/**
 * Deep-ish merge of plain objects (shallow keys, nested objects merged one level).
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export function mergeObjects(target, source) {
    const out = { ...target };
    if (!source || typeof source !== 'object') return out;
    for (const [k, v] of Object.entries(source)) {
        if (isPlainObject(v) && isPlainObject(out[k])) {
            out[k] = { ...out[k], ...v };
        } else if (v !== undefined) {
            out[k] = v;
        }
    }
    return out;
}


/**
 * Collect a readable stream into a Buffer.
 * @param {import('stream').Readable|AsyncIterable} stream
 * @returns {Promise<Buffer>}
 */
export async function toBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
