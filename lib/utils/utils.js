'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.size = size;
exports.sharpThumb = sharpThumb;
exports.random = random;
exports.texted = texted;
exports.example = example;
exports.isURL = isURL;
exports.isUrlValid = isUrlValid;
exports.isUrlInText = isUrlInText;
exports.extractLink = extractLink;
exports.jsonFormat = jsonFormat;

var fs = require('fs');
var fsp = require('fs/promises');

function size(input, thresholdMB) {
    var bytes = Buffer.isBuffer(input) ? input.length : Number(input) || 0;
    if (thresholdMB != null) return bytes > thresholdMB * 1024 * 1024;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function sharpThumb(input) {
    return Promise.resolve().then(function () {
        var sharp;
        try { sharp = require('sharp'); } catch (_a) {
            return Promise.reject(new Error('sharp is not installed'));
        }
        var p;
        if (Buffer.isBuffer(input)) p = Promise.resolve(input);
        else if (isURL(input)) p = fetch(input).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return Buffer.from(ab); });
        else p = fsp.readFile(input);
        return p.then(function (buf) {
            return sharp(buf).resize(300, 300, { fit: 'cover' }).toBuffer();
        });
    });
}

function random(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function texted(font, text) {
    var formats = {
        bold: '*' + text + '*',
        italic: '_' + text + '_',
        strike: '~' + text + '~',
        mono: '```' + text + '```'
    };
    return formats[font] || text;
}

function example(prefix, command, args) {
    return '• ' + texted('bold', 'Example') + ' : ' + prefix + command + ' ' + args;
}

function isURL(url) {
    try {
        new URL(url);
        return true;
    } catch (_a) {
        return false;
    }
}

function isUrlValid(str) {
    return /https?:\/\/\S+/i.test(str);
}

function isUrlInText(str) {
    return /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g.test(str);
}

function extractLink(text) {
    var matches = String(text || '').match(/https?:\/\/[^\s]+/g);
    return matches ? matches[0] : null;
}

function jsonFormat(data) {
    var seen = new WeakSet();
    var replacer = function (_, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    };
    try {
        var obj = typeof data === 'string' ? JSON.parse(data) : data;
        return JSON.stringify(obj, replacer, 2);
    } catch (_a) {
        return String(data);
    }
}
