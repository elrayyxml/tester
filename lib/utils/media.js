'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAudioWaveform = exports.getMimeType = exports.toBuffer = exports.getStream = exports.setEngine = void 0;

/**
 * Thin re-exports from baileys — do not reimplement, and no implicit
 * require('baileys'). Shares the same engine registry as utils/functions.js,
 * populated by Client(sock, { engines: [baileys] }) on first attach.
 */
var functions_1 = require('./functions');
var setEngine = functions_1.setEngine;
exports.setEngine = setEngine;

function requireBaileys() {
    var engine = functions_1.getEngine();
    if (!engine) {
        throw new Error('No baileys engine configured. Call Client(sock, { engines: [require("baileys")] }) first, or Utils.setEngine(baileys) directly.');
    }
    return engine;
}

function getStream(item, opts) {
    return requireBaileys().getStream(item, opts);
}
exports.getStream = getStream;

function toBuffer(input) {
    var b = requireBaileys();
    if (typeof b.toBuffer === 'function') return b.toBuffer(input);
    if (Buffer.isBuffer(input)) return Promise.resolve(input);
    return Promise.reject(new Error('baileys.toBuffer unavailable'));
}
exports.toBuffer = toBuffer;

function getMimeType(input, fallback) {
    if (fallback === void 0) fallback = 'application/octet-stream';
    try {
        var mime = require('mime-types');
        if (typeof input === 'string') return mime.lookup(input) || fallback;
    } catch (_b) { }
    return fallback;
}
exports.getMimeType = getMimeType;

function getAudioWaveform(buffer, logger) {
    return requireBaileys().getAudioWaveform(buffer, logger);
}
exports.getAudioWaveform = getAudioWaveform;
