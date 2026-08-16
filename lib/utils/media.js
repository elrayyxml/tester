'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAudioWaveform = exports.getMimeType = exports.toBuffer = exports.getStream = void 0;

/**
 * Thin re-exports from baileys — do not reimplement.
 * peerDependency: baileys
 */
function getStream(item, opts) {
    var baileys = require('baileys');
    return baileys.getStream(item, opts);
}
exports.getStream = getStream;

function toBuffer(input) {
    var baileys = require('baileys');
    if (typeof baileys.toBuffer === 'function') return baileys.toBuffer(input);
    if (Buffer.isBuffer(input)) return Promise.resolve(input);
    return Promise.reject(new Error('baileys.toBuffer unavailable'));
}
exports.toBuffer = toBuffer;

function getMimeType(input, fallback) {
    if (fallback === void 0) fallback = 'application/octet-stream';
    try {
        var mime = require('mime-types');
        if (typeof input === 'string') return mime.lookup(input) || fallback;
    } catch (_a) { }
    return fallback;
}
exports.getMimeType = getMimeType;

function getAudioWaveform(buffer, logger) {
    var baileys = require('baileys');
    return baileys.getAudioWaveform(buffer, logger);
}
exports.getAudioWaveform = getAudioWaveform;
