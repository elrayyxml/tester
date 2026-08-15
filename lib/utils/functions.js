'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickRandom = exports.getRandom = exports.formatBytes = exports.sleep = exports.delay = exports.isUrl = exports.generateMessageID = exports.generateMessageIDV2 = exports.getDevice = void 0;

var crypto_1 = require("crypto");

/**
 * Detect device from message ID pattern (Baileys style)
 * @param {string} id
 * @returns {'ios'|'android'|'web'|'desktop'|'unknown'}
 */
function getDevice(id) {
    if (!id || typeof id !== 'string')
        return 'unknown';
    if (id.startsWith('3A'))
        return 'ios';
    if (id.startsWith('3E'))
        return 'web';
    if (id.startsWith('3B') || id.startsWith('BAE') || id.startsWith('3EB0'))
        return 'android';
    if (id.length >= 20 && /^[A-F0-9]+$/i.test(id))
        return 'desktop';
    return 'unknown';
}
exports.getDevice = getDevice;

/**
 * Generate message ID v2 (inspired by baileys generics)
 * @param {string} [userId]
 * @returns {string}
 */
function generateMessageIDV2(userId) {
    var data = (0, crypto_1.randomBytes)(8).toString('hex').toUpperCase();
    if (userId) {
        var hash = (0, crypto_1.createHash)('sha256').update(userId).digest('hex').toUpperCase().slice(0, 8);
        return hash + data;
    }
    return data + (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase();
}
exports.generateMessageIDV2 = generateMessageIDV2;

/**
 * Simple message ID generator with optional prefix
 * @param {string} [prefix]
 * @returns {string}
 */
function generateMessageID(prefix) {
    var id = (0, crypto_1.randomBytes)(16).toString('hex').toUpperCase();
    if (prefix && typeof prefix === 'string') {
        return (prefix.slice(0, 8) + id).slice(0, 32);
    }
    return id;
}
exports.generateMessageID = generateMessageID;

/**
 * Check if string is a valid URL
 * @param {string} text
 * @returns {boolean}
 */
function isUrl(text) {
    if (!text || typeof text !== 'string')
        return false;
    try {
        var u = new URL(text);
        return u.protocol === 'http:' || u.protocol === 'https:';
    }
    catch (_a) {
        return false;
    }
}
exports.isUrl = isUrl;

/**
 * Promise-based delay
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
exports.delay = delay;
exports.sleep = delay;

/**
 * Format bytes to human readable string
 * @param {number} bytes
 * @param {number} [decimals=2]
 * @returns {string}
 */
function formatBytes(bytes, decimals) {
    if (decimals === void 0) { decimals = 2; }
    if (!bytes || bytes === 0)
        return '0 Bytes';
    var k = 1024;
    var dm = decimals < 0 ? 0 : decimals;
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
exports.formatBytes = formatBytes;

/**
 * Random integer between min and max (inclusive)
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function getRandom(min, max) {
    if (max === void 0) { max = min; min = 0; }
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
exports.getRandom = getRandom;

/**
 * Pick random element from array
 * @param {any[]} arr
 * @returns {*}
 */
function pickRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0)
        return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
}
exports.pickRandom = pickRandom;
