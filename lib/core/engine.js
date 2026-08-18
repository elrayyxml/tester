'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEngine = getEngine;
exports.fn = fn;

var errors_1 = require('../constant/errors');

function getEngine(sock) {
    var b = sock && sock.__nexray && sock.__nexray.baileys;
    if (!b) throw new errors_1.NexrayError('No Baileys engine is configured.', errors_1.ErrorCodes.ENGINE);
    return b;
}

function fn(sock, name) {
    var f = getEngine(sock)[name];
    if (typeof f !== 'function') {
        throw new errors_1.NexrayError('Baileys does not provide ' + name + '.', errors_1.ErrorCodes.ENGINE);
    }
    return f;
}
