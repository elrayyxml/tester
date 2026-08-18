'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEngine = getEngine;
exports.fn = fn;

var errors_1 = require("../constant/errors");

function getEngine(sock) {
    var b = sock && sock.__nexray && sock.__nexray.baileys;
    if (!b) {
        throw new errors_1.NexrayError(
            'baileys not configured',
            errors_1.ErrorCodes.INVALID_OPTIONS
        );
    }
    return b;
}

function fn(sock, name) {
    var f = getEngine(sock)[name];
    if (typeof f !== 'function') {
        throw new errors_1.NexrayError('baileys.' + name + ' missing', errors_1.ErrorCodes.NOT_IMPLEMENTED);
    }
    return f;
}
