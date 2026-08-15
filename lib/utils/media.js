'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create(("function" === typeof Iterator ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAudioWaveform = exports.getMimeType = exports.toBuffer = exports.getStream = exports.downloadMedia = void 0;

var fs_1 = require("fs");
var path_1 = require("path");
var stream_1 = require("stream");
var errors_1 = require("../constant/errors");

var mime;
try {
    mime = require("mime-types");
}
catch (_mimeErr) {
    mime = {
        lookup: function (ext) {
            var map = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
                '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
                '.pdf': 'application/pdf', '.doc': 'application/msword',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.zip': 'application/zip', '.txt': 'text/plain'
            };
            var e = (ext || '').toLowerCase();
            if (!e.startsWith('.'))
                e = '.' + e;
            return map[e] || false;
        }
    };
}

/**
 * Convert various input to Buffer
 * @param {Buffer|string|import('stream').Readable} input
 * @returns {Promise<Buffer>}
 */
function toBuffer(input) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            if (Buffer.isBuffer(input))
                return [2 /*return*/, input];
            if (typeof input === 'string') {
                if ((0, fs_1.existsSync)(input)) {
                    return [2 /*return*/, (0, fs_1.readFileSync)(input)];
                }
                // assume remote url — caller should use downloadMedia
                throw new errors_1.NexrayError('toBuffer expects Buffer or local path', errors_1.ErrorCodes.INVALID_MEDIA);
            }
            if (input && typeof input.pipe === 'function') {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var chunks = [];
                        input.on('data', function (c) { return chunks.push(c); });
                        input.on('end', function () { return resolve(Buffer.concat(chunks)); });
                        input.on('error', reject);
                    })];
            }
            throw new errors_1.NexrayError('Unsupported media input type', errors_1.ErrorCodes.INVALID_MEDIA);
        });
    });
}
exports.toBuffer = toBuffer;

/**
 * Get readable stream from path / buffer / url-ish
 * @param {Buffer|string} input
 * @returns {import('stream').Readable}
 */
function getStream(input) {
    if (Buffer.isBuffer(input)) {
        var readable = new stream_1.Readable({ read: function () { } });
        readable.push(input);
        readable.push(null);
        return readable;
    }
    if (typeof input === 'string' && (0, fs_1.existsSync)(input)) {
        return (0, fs_1.createReadStream)(input);
    }
    throw new errors_1.NexrayError('getStream expects Buffer or local file path', errors_1.ErrorCodes.INVALID_MEDIA);
}
exports.getStream = getStream;

/**
 * Detect mime type from path / buffer / filename
 * @param {string|Buffer} input
 * @param {string} [fallback]
 * @returns {string}
 */
function getMimeType(input, fallback) {
    if (fallback === void 0) { fallback = 'application/octet-stream'; }
    if (typeof input === 'string') {
        var ext = (0, path_1.extname)(input);
        if (ext) {
            var m = mime.lookup(ext);
            if (m)
                return m;
        }
        // try by filename itself
        var m2 = mime.lookup(input);
        if (m2)
            return m2;
    }
    return fallback;
}
exports.getMimeType = getMimeType;

/**
 * Download media from URL to Buffer (simple, no heavy deps)
 * Uses global fetch (Node >=18)
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<Buffer>}
 */
function downloadMedia(url, opts) {
    return __awaiter(this, void 0, void 0, function () {
        var res, ab;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetch(url, opts || {})];
                case 1:
                    res = _a.sent();
                    if (!res.ok) {
                        throw new errors_1.NexrayError("Failed to download media: " + res.status + " " + res.statusText, errors_1.ErrorCodes.MEDIA_DOWNLOAD);
                    }
                    return [4 /*yield*/, res.arrayBuffer()];
                case 2:
                    ab = _a.sent();
                    return [2 /*return*/, Buffer.from(ab)];
            }
        });
    });
}
exports.downloadMedia = downloadMedia;

/**
 * Generate audio waveform for PTT (copied & adapted from baileys-itsliaaa messages-media.js)
 * Uses audio-decode package.
 * @param {Buffer|string|import('stream').Readable} buffer
 * @param {*} [logger]
 * @returns {Promise<Uint8Array|undefined>}
 */
function getAudioWaveform(buffer, logger) {
    return __awaiter(this, void 0, void 0, function () {
        var decoderMod, decoder, audioData, _a, audioBuffer, rawData, samples, blockSize, filteredData, i, blockStart, sum, j, multiplier, normalizedData, waveform, e_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 7, , 8]);
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('audio-decode'); })];
                case 1:
                    decoderMod = _b.sent();
                    decoder = decoderMod.default || decoderMod;
                    if (!Buffer.isBuffer(buffer)) return [3 /*break*/, 2];
                    audioData = buffer;
                    return [3 /*break*/, 5];
                case 2:
                    if (!(typeof buffer === 'string')) return [3 /*break*/, 3];
                    audioData = (0, fs_1.readFileSync)(buffer);
                    return [3 /*break*/, 5];
                case 3: return [4 /*yield*/, toBuffer(buffer)];
                case 4:
                    audioData = _b.sent();
                    _b.label = 5;
                case 5: return [4 /*yield*/, decoder(audioData)];
                case 6:
                    audioBuffer = _b.sent();
                    rawData = audioBuffer.getChannelData(0);
                    samples = 64;
                    blockSize = Math.floor(rawData.length / samples);
                    filteredData = [];
                    for (i = 0; i < samples; i++) {
                        blockStart = blockSize * i;
                        sum = 0;
                        for (j = 0; j < blockSize; j++) {
                            sum = sum + Math.abs(rawData[blockStart + j]);
                        }
                        filteredData.push(sum / blockSize);
                    }
                    multiplier = Math.pow(Math.max.apply(Math, filteredData), -1);
                    normalizedData = filteredData.map(function (n) { return n * multiplier; });
                    waveform = new Uint8Array(normalizedData.map(function (n) { return Math.floor(100 * n); }));
                    return [2 /*return*/, waveform];
                case 7:
                    e_1 = _b.sent();
                    if (logger && typeof logger.debug === 'function') {
                        logger.debug('Failed to generate waveform: ' + e_1);
                    }
                    return [2 /*return*/, undefined];
                case 8: return [2 /*return*/];
            }
        });
    });
}
exports.getAudioWaveform = getAudioWaveform;
