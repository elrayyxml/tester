/**
 * Utility-related contracts + formatting/media-size/misc text helpers.
 * @module types/utils
 */

import sharp from 'sharp';
import { readFile } from 'fs/promises';

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

export function size(input, thresholdMB = null) {
    const bytes = Buffer.isBuffer(input) ? input.length : input;
    if (thresholdMB !== null) {
        return bytes > thresholdMB * 1024 * 1024;
    }
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isURL(url) {
    try {
        return (new URL(url), true);
    } catch {
        return false;
    }
}

export async function sharpResize(input) {
    let buffer;
    if (Buffer.isBuffer(input)) {
        buffer = input;
    } else if (isURL(input)) {
        const res = await fetch(input);
        buffer = Buffer.from(await res.arrayBuffer());
    } else {
        buffer = await readFile(input);
    }
    return sharp(buffer).resize(300, 300, { fit: 'cover' }).toBuffer();
}

export function random(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function texted(font, text) {
    const formats = {
        bold: `*${text}*`,
        italic: `_${text}_`,
        strike: `~${text}~`,
        mono: `\`\`\`${text}\`\`\``
    };
    return formats[font] || text;
}

export function example(prefix, command, args) {
    return `• ${texted('bold', 'Example')} : ${prefix + command} ${args}`;
}

export function isUrlValid(str) {
    return /https?:\/\/\S+/i.test(str);
}

export function isUrlInText(str) {
    return /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g.test(str);
}

export function extractLink(text) {
    const matches = text.match(/https?:\/\/[^\s]+/g);
    return matches ? matches[0] : null;
}

export function jsonFormat(data) {
    const seen = new WeakSet();
    const replacer = (_, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    };

    try {
        const obj = typeof data === 'string' ? JSON.parse(data) : data;
        return JSON.stringify(obj, replacer, 2);
    } catch {
        return String(data);
    }
}

export const Format = {
    size,
    sharp: sharpResize,
    random,
    texted,
    example,
    isURL,
    isUrlValid,
    isUrlInText,
    extractLink,
    jsonFormat
};
