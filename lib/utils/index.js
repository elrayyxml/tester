'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;

var functions = require('./functions');
var media = require('./media');
var extra = require('./utils');
var errors_1 = require('../constant/errors');

var PROTECTED = new Set([
    'extend', 'getDevice', 'generateMessageID', 'generateMessageIDV2',
    'sleep', 'delay', 'formatBytes', 'getRandom', 'pickRandom', 'isUrl',
    'toBuffer', 'getStream', 'getMimeType', 'getAudioWaveform', 'hasNonNullishProperty',
    'size', 'sharp', 'random', 'texted', 'example', 'isURL', 'isUrlValid',
    'isUrlInText', 'extractLink', 'jsonFormat'
]);

var Utils = {
    // baileys proxies / id
    getDevice: functions.getDevice,
    generateMessageID: functions.generateMessageID,
    generateMessageIDV2: functions.generateMessageIDV2,
    sleep: functions.sleep,
    delay: functions.delay,
    formatBytes: functions.formatBytes,
    getRandom: functions.getRandom,
    pickRandom: functions.pickRandom,
    isUrl: functions.isUrl,
    hasNonNullishProperty: functions.hasNonNullishProperty,
    toBuffer: media.toBuffer,
    getStream: media.getStream,
    getMimeType: media.getMimeType,
    getAudioWaveform: media.getAudioWaveform,
    // consumer helpers
    size: extra.size,
    sharp: extra.sharpThumb,
    random: extra.random,
    texted: extra.texted,
    example: extra.example,
    isURL: extra.isURL,
    isUrlValid: extra.isUrlValid,
    isUrlInText: extra.isUrlInText,
    extractLink: extra.extractLink,
    jsonFormat: extra.jsonFormat,

    extend: function (methods, opts) {
        if (!methods || typeof methods !== 'object') {
            throw new errors_1.NexrayError('Utils.extend expects object of functions', errors_1.ErrorCodes.INVALID_OPTIONS);
        }
        var force = opts && opts.force;
        Object.keys(methods).forEach(function (k) {
            if (PROTECTED.has(k) && !force) {
                throw new errors_1.NexrayError('Cannot override Utils.' + k, errors_1.ErrorCodes.INVALID_OPTIONS);
            }
            if (typeof methods[k] !== 'function') {
                throw new errors_1.NexrayError('Utils.extend: ' + k + ' must be function', errors_1.ErrorCodes.INVALID_OPTIONS);
            }
            Utils[k] = methods[k].bind(Utils);
        });
        return Utils;
    }
};
exports.Utils = Utils;
