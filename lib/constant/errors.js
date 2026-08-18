'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCodes = exports.NexrayError = void 0;

var ErrorCodes = {
    ENGINE: 'ENGINE',
    INVALID_SOCKET: 'INVALID_SOCKET',
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    INVALID_MEDIA: 'INVALID_MEDIA',
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
};
exports.ErrorCodes = ErrorCodes;

function NexrayError(message, code) {
    var err = new Error(message || 'Unexpected error');
    err.name = 'NexrayError';
    err.code = code || ErrorCodes.INVALID_OPTIONS;
    return err;
}
exports.NexrayError = NexrayError;
