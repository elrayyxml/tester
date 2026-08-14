"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var extendMod = require("./extend");
var Extend = extendMod.Extend;

var listenerMod = require("../listener");
var bindMessageListener = listenerMod.bindMessageListener;
var bindChatListener = listenerMod.bindChatListener;
var bindNewsletterListener = listenerMod.bindNewsletterListener;

/**
 * @nexray/lib — core/client.js
 *
 * `Client(sock, options)` is the main entry point of this library. It does
 * NOT create a socket, does NOT manage auth state, and does NOT hold any
 * session/credentials of its own — it takes a socket instance the consumer
 * already built with `makeWASocket(...)` (from the real `baileys` package),
 * attaches every sock.sendX() helper via Extend(), then wires up the
 * built-in listeners (messages.upsert → serialize, chats, newsletter).
 *
 * @param {import('baileys').WASocket} sock An already-created Baileys socket.
 * @param {{
 *   bot?: (id: string) => boolean,
 *   stealth?: 'ios'|'android'|'web'|'desktop',
 *   messageIdPrefix?: string,
 *   updateProtoOnStartup?: boolean,
 *   autoFollowNewsletter?: string|string[]|false,
 *   newsletterAnnotation?: object|false,
 *   onMessage?: (ctx: { m: object, raw: object, type: string, sock: object }) => any,
 *   onChatUpsert?: Function,
 *   onChatUpdate?: Function,
 *   onNewsletterReaction?: Function,
 *   onNewsletterView?: Function,
 *   onNewsletterParticipantsUpdate?: Function,
 *   logger?: object,
 *   additionalNodes?: object[]
 * }} [options]
 * @returns {import('baileys').WASocket} the same `sock`, extended in place.
 */
function Client(sock, options) {
  options = options || {};

  Extend(sock, options);

  bindMessageListener(sock, options);
  bindChatListener(sock, options);
  bindNewsletterListener(sock, options);

  return sock;
}

exports.Client = Client;
