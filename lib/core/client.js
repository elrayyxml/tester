/**
 * Client — composition root: engine injection, config, helpers, serialize.
 */

import { Error, createError } from '../constant/index.js';
import { setDebug, info, success, debug } from '../utils/logs.js';
import { asString } from '../utils/function.js';
import { createMessageApi, normalizeClientOptions } from './message.js';
import { isBotMessageId, extractMessageId } from '../utils/function.js';


const REQUIRED_CAPS = [
    'generateWAMessage',
    'generateWAMessageContent',
    'generateWAMessageFromContent',
    'prepareWAMessageMedia',
    'getContentType',
    'normalizeMessageContent'
];

const OPTIONAL_CAPS = [
    'proto',
    'generateMessageIDV2',
    'getAudioWaveform',
    'toBuffer',
    'getStream',
    'generateThumbnail',
    'extractVideoThumb',
    'encryptedStream',
    'prepareStickerPackMessage',
    'getDevice',
    'delay'
];

function resolveCap(engine, name) {
    if (!engine) return undefined;
    if (typeof engine[name] === 'function' || (name === 'proto' && engine[name])) return engine[name];
    if (engine.default && (typeof engine.default[name] === 'function' || engine.default[name])) {
        return engine.default[name];
    }
    if (engine.Utils && (typeof engine.Utils[name] === 'function' || engine.Utils[name])) {
        return engine.Utils[name];
    }
    if (engine.default?.Utils && (typeof engine.default.Utils[name] === 'function' || engine.default.Utils[name])) {
        return engine.default.Utils[name];
    }
    return undefined;
}

export function buildCapabilities(engine) {
    const caps = {};
    for (const name of [...REQUIRED_CAPS, ...OPTIONAL_CAPS]) {
        const value = resolveCap(engine, name);
        if (value !== undefined) caps[name] = value;
    }
    return caps;
}

export function assertCapabilities(caps) {
    const missing = REQUIRED_CAPS.filter((n) => typeof caps[n] !== 'function');
    if (missing.length) {
        throw createError(
            Error.MISSING_CAPABILITY,
            `Engine is missing required capabilities: ${missing.join(', ')}`
        );
    }
}

export function validateSocket(sock) {
    if (!sock || typeof sock !== 'object') {
        throw createError(Error.INVALID_ENGINE, 'Socket is required');
    }
    if (typeof sock.relayMessage !== 'function' && typeof sock.sendMessage !== 'function') {
        throw createError(Error.INVALID_ENGINE, 'Socket must expose relayMessage or sendMessage');
    }
}

export function validateEngines(engines) {
    if (!Array.isArray(engines) || engines.length === 0) {
        throw createError(Error.INVALID_ENGINE, 'engines must be a non-empty array');
    }
    return engines;
}

export function createEngineContext(sock, engines) {
    const list = validateEngines(engines);
    const primary = list[0];
    const caps = buildCapabilities(primary);
    assertCapabilities(caps);

    if (typeof sock.relayMessage === 'function') {
        caps.relayMessage = sock.relayMessage.bind(sock);
    } else {
        throw createError(Error.INVALID_ENGINE, 'Socket must expose relayMessage for the relay pipeline');
    }

    info('Engine initialized');
    info('Primary engine selected');
    debug('Engine capabilities', Object.keys(caps));

    return { primary, engines: list, caps, sock };
}


function detectType(content) {
    if (!content || typeof content !== 'object') return undefined;
    return Object.keys(content).find(
        (k) => (k === 'conversation' || k.includes('Message')) && k !== 'senderKeyDistributionMessage'
    );
}

function unwrap(content) {
    if (!content) return undefined;
    let current = content;
    for (let i = 0; i < 5; i++) {
        const inner =
            current.ephemeralMessage ||
            current.viewOnceMessage ||
            current.viewOnceMessageV2 ||
            current.viewOnceMessageV2Extension ||
            current.documentWithCaptionMessage ||
            current.editedMessage ||
            current.groupStatusMessage ||
            current.groupStatusMessageV2 ||
            current.spoilerMessage ||
            current.lottieStickerMessage ||
            current.associatedChildMessage ||
            current.botForwardedMessage;
        if (!inner?.message) break;
        current = inner.message;
    }
    return current;
}

/**
 * Normalize an incoming WebMessageInfo-like object.
 * @param {object} raw
 * @param {object} [opts]
 */
export function serializeMessage(raw, opts = {}) {
    if (!raw || typeof raw !== 'object') {
        return {
            key: null,
            message: null,
            sender: null,
            remoteJid: null,
            messageType: null,
            quoted: null,
            metadata: {}
        };
    }

    const key = raw.key || null;
    const remoteJid = key ? asString(key.remoteJid) : null;
    const participant = key ? asString(key.participant) : null;
    const fromMe = Boolean(key?.fromMe);
    const sender = fromMe ? asString(opts.meId) : participant || remoteJid;

    let message = raw.message || null;
    if (typeof opts.normalizeMessageContent === 'function' && message) {
        try {
            message = opts.normalizeMessageContent(message);
        } catch {
            message = unwrap(message);
        }
    } else {
        message = unwrap(message);
    }

    let messageType;
    if (typeof opts.getContentType === 'function' && message) {
        try {
            messageType = opts.getContentType(message);
        } catch {
            messageType = detectType(message);
        }
    } else {
        messageType = detectType(message);
    }

    let quoted = null;
    if (message && messageType && message[messageType]?.contextInfo?.quotedMessage) {
        const c = message[messageType].contextInfo;
        quoted = {
            key: {
                remoteJid: c.remoteJid || remoteJid,
                id: c.stanzaId,
                participant: c.participant,
                fromMe: false
            },
            message: c.quotedMessage,
            sender: asString(c.participant) || remoteJid
        };
    }

    return {
        key,
        message,
        sender,
        remoteJid,
        messageType,
        quoted,
        metadata: {
            pushName: raw.pushName,
            messageTimestamp: raw.messageTimestamp,
            status: raw.status,
            broadcast: raw.broadcast
        },
        raw
    };
}


/**
 * Augment a messaging socket with @nexray/lib helpers.
 *
 * @param {object} sock
 * @param {object} options
 * @param {object[]} options.engines
 * @returns {object}
 */
export function Client(sock, options = {}) {
    validateSocket(sock);

    if (!options || typeof options !== 'object') {
        throw createError(Error.INVALID_OPTIONS, 'Client options must be an object');
    }
    if (!Array.isArray(options.engines) || options.engines.length === 0) {
        throw createError(Error.INVALID_ENGINE, 'options.engines must be a non-empty array');
    }

    const config = normalizeClientOptions(options);
    setDebug(config.debug);

    const engineCtx = createEngineContext(sock, options.engines);
    const meId = sock.user?.id || sock.authState?.creds?.me?.id || null;

    const relayCtx = { engineCtx, config, meId };
    const messageApi = createMessageApi(relayCtx);

    Object.assign(sock, messageApi);

    sock.serialize = function serialize(raw) {
        return serializeMessage(raw, {
            getContentType: engineCtx.caps.getContentType,
            normalizeMessageContent: engineCtx.caps.normalizeMessageContent,
            meId
        });
    };

    sock.isBot = function isBot(keyOrId) {
        const id = typeof keyOrId === 'string' ? keyOrId : extractMessageId(keyOrId);
        return isBotMessageId(id, config.bot);
    };

    sock.nexray = {
        config,
        engine: engineCtx,
        version: '0.1.0'
    };

    success('Message helpers injected');
    success('Relay pipeline initialized');
    info('Client ready');

    return sock;
}

export default Client;
