'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.stealthId = stealthId;
exports.makeMsgId = makeMsgId;

var crypto = require('crypto');
var functions_1 = require('../utils/functions');

function stealthId(mode) {
    var hex = function (n) {
        return crypto.randomBytes(Math.ceil(n / 2)).toString('hex').toUpperCase().slice(0, n);
    };
    switch (String(mode || '').toLowerCase()) {
        case 'ios': return '3A' + hex(18);
        case 'web': return '3E' + hex(20);
        case 'android': return hex(21);
        case 'desktop':
        case 'dekstop': return '3F' + hex(16);
        default: return null;
    }
}

function makeMsgId(sock) {
    var cfg = sock.__nexray || {};
    var id = stealthId(cfg.stealth);
    if (id) return id;
    var prefix = cfg.custom_id || cfg.messageIdPrefix || '';
    if (prefix) return (0, functions_1.generateMessageID)(prefix);
    return (0, functions_1.generateMessageIDV2)(sock.user && (sock.user.id || sock.user.lid));
}
