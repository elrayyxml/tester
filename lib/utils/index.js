'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;

var functions = require("./functions");
var media = require("./media");
var message = require("./message");
var linkPreview = require("./link-preview");
var errors_1 = require("../constant/errors");

/** Core method names that must not be overridden silently */
var PROTECTED_KEYS = new Set([
    'extend',
    'getDevice',
    'generateMessageID',
    'generateMessageIDV2',
    'sleep',
    'delay',
    'formatBytes',
    'getRandom',
    'pickRandom',
    'isUrl',
    'toBuffer',
    'getStream',
    'getMimeType',
    'downloadMedia',
    'getAudioWaveform',
    'getContentType',
    'extractMessageContent',
    'normalizeBody',
    'getUrlInfo'
]);

/**
 * Module-level singleton Utils registry.
 * Extend once → available everywhere that imports Utils from @nexray/lib
 */
var Utils = {
    // ---- functions ----
    getDevice: functions.getDevice,
    generateMessageID: functions.generateMessageID,
    generateMessageIDV2: functions.generateMessageIDV2,
    sleep: functions.sleep,
    delay: functions.delay,
    formatBytes: functions.formatBytes,
    getRandom: functions.getRandom,
    pickRandom: functions.pickRandom,
    isUrl: functions.isUrl,
    // ---- media ----
    toBuffer: media.toBuffer,
    getStream: media.getStream,
    getMimeType: media.getMimeType,
    downloadMedia: media.downloadMedia,
    getAudioWaveform: media.getAudioWaveform,
    // ---- message ----
    getContentType: message.getContentType,
    extractMessageContent: message.extractMessageContent,
    normalizeBody: message.normalizeBody,
    // ---- link preview ----
    getUrlInfo: linkPreview.getUrlInfo,
    /**
     * Extend Utils with custom helpers.
     * Existing core methods emit a warning when overridden.
     * @param {Record<string, Function>} fnMap
     */
    extend: function (fnMap) {
        if (!fnMap || typeof fnMap !== 'object') {
            throw new errors_1.NexrayError('Utils.extend expects an object of named functions', errors_1.ErrorCodes.INVALID_OPTIONS);
        }
        var keys = Object.keys(fnMap);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (PROTECTED_KEYS.has(key) && typeof Utils[key] === 'function') {
                console.warn("[@nexray/lib] Utils.extend: overriding protected method \"" + key + "\"");
            }
            if (typeof fnMap[key] !== 'function') {
                console.warn("[@nexray/lib] Utils.extend: \"" + key + "\" is not a function, skipped");
                continue;
            }
            Utils[key] = fnMap[key];
        }
        return Utils;
    }
};

exports.Utils = Utils;
