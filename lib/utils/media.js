'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAudioWaveform = exports.getMimeType = exports.toBuffer = exports.getStream = void 0;

/**
 * Thin re-exports from baileys — do not reimplement.
 * peerDependency: baileys (required once at module load, not per-call)
 */
var baileys;
try { baileys = require('baileys'); } catch (_a) { baileys = null; }

function requireBaileys() {
    if (!baileys) throw new Error('Peer dependency "baileys" not found. Install it: npm i baileys');
    return baileys;
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
