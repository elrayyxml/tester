'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.ErrorCodes = exports.NexrayError = void 0;

var ErrorCodes = {
    ENGINE: 'ENGINE',
    INVALID_SOCKET: 'INVALID_SOCKET',
    INVALID_JID: 'INVALID_JID',
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    INVALID_MEDIA: 'INVALID_MEDIA',
    MEDIA_DOWNLOAD: 'MEDIA_DOWNLOAD',
    MEDIA_PROCESS: 'MEDIA_PROCESS',
    RELAY_FAILED: 'RELAY_FAILED',
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
};

exports.ErrorCodes = ErrorCodes;

function NexrayError(message, code) {
    var error = new Error(message || 'An unexpected Nexray error occurred.');
    error.name = 'NexrayError';
    error.code = code || ErrorCodes.INVALID_OPTIONS;
    return error;
}

exports.NexrayError = NexrayError;
