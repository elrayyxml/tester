'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;

var errors_1 = require('../constant/errors');
var helpers_1 = require('../helpers');

/**
 * @param {object} sock
 * @param {{ engines: [object], messageIdPrefix?: string, stealth?: string, newsletterAnnotation?: object, autoFollowNewsletter?: any }} options
 */
function Client(sock, options) {
    if (!sock || typeof sock !== 'object') {
        throw new errors_1.NexrayError('Client expects a Baileys socket', errors_1.ErrorCodes.INVALID_SOCKET);
    }
    if (!options || !Array.isArray(options.engines) || !options.engines[0]) {
        throw new errors_1.NexrayError(
            'Client(sock, { engines: [baileys] }) required',
            errors_1.ErrorCodes.INVALID_OPTIONS
        );
    }
    var baileys = options.engines[0];
    if (baileys.default && typeof baileys.generateWAMessage !== 'function') {
        baileys = baileys.default;
    }
    sock.__nexray = {
        baileys: baileys,
        messageIdPrefix: options.messageIdPrefix || options.custom_id || 'NEXRAY',
        custom_id: options.custom_id || options.messageIdPrefix || 'NEXRAY',
        stealth: options.stealth || null,
        newsletterAnnotation: options.newsletterAnnotation || null,
        newsletterFollow: options.autoFollowNewsletter || null
    };
    (0, helpers_1.attachSendHelpers)(sock);
    var follow = sock.__nexray.newsletterFollow;
    if (follow && typeof sock.newsletterFollow === 'function') {
        (Array.isArray(follow) ? follow : [follow]).forEach(function (jid) {
            if (typeof jid === 'string' && jid) {
                try { sock.newsletterFollow(jid); } catch (_e) { }
            }
        });
    }
    return sock;
}
exports.Client = Client;
