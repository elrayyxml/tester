'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = exports.sleep = exports.pickRandom = exports.getRandom = exports.formatBytes = exports.isUrl = exports.generateMessageID = exports.generateMessageIDV2 = exports.getDevice = void 0;

var crypto_1 = require("crypto");

/** baileys.getDevice — no local reimplementation */
function getDevice(id) {
    var baileys = require('baileys');
    return baileys.getDevice(id);
}
exports.getDevice = getDevice;

/** Custom ID helpers (local — not in baileys the same way with prefix) */
function generateMessageIDV2(userId) {
    var data = (0, crypto_1.randomBytes)(8).toString('hex').toUpperCase();
    if (userId) {
        var hash = (0, crypto_1.createHash)('sha256').update(userId).digest('hex').toUpperCase().slice(0, 8);
        return hash + data;
    }
    return data + (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase();
}
exports.generateMessageIDV2 = generateMessageIDV2;

function generateMessageID(prefix) {
    var id = (0, crypto_1.randomBytes)(16).toString('hex').toUpperCase();
    if (prefix && typeof prefix === 'string') return (prefix.slice(0, 8) + id).slice(0, 32);
    return id.slice(0, 32);
}
exports.generateMessageID = generateMessageID;

function isUrl(text) {
    return typeof text === 'string' && /^https?:\/\//i.test(text);
}
exports.isUrl = isUrl;

function formatBytes(bytes, decimals) {
    if (decimals === void 0) decimals = 2;
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}
exports.formatBytes = formatBytes;

function getRandom(ext) {
    return (0, crypto_1.randomBytes)(8).toString('hex') + (ext || '');
}
exports.getRandom = getRandom;

function pickRandom(arr) {
    return Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}
exports.pickRandom = pickRandom;

function sleep(ms) {
    return new Promise(function (r) { return setTimeout(r, ms); });
}
exports.sleep = sleep;
exports.delay = sleep;
