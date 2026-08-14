"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var crypto = require("crypto");

/**
 * @nexray/lib — utils/functions.js
 * General-purpose helper functions, attached onto the `Utils` namespace.
 */

/**
 * Sleep for the given milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** unix timestamp in seconds. @param {Date} [date] */
function unixTimestampSeconds(date) {
  return Math.floor((date || new Date()).getTime() / 1000);
}

/**
 * Generates a Baileys-compatible message ID, mirroring `generateMessageIDV2`
 * (whatsmeow-inspired: `3EB0` + sha256 digest of a timestamp+userId+random
 * buffer). When a `prefix` is supplied it is spliced into the middle of the
 * generated ID — same technique the upstream fork uses to embed a fixed
 * brand marker ("STARFALL") — except here the marker is configurable via
 * `messageIdPrefix` instead of hardcoded.
 *
 * @param {string} [userId] Own JID, used to salt the hash (optional).
 * @param {string} [prefix] Custom marker to splice in (e.g. "NEXRAY").
 * @returns {string}
 */
function generateMessageId(userId, prefix) {
  var data = Buffer.allocUnsafe(44);
  data.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 0);

  if (userId) {
    var userStr = String(userId).split("@")[0].split(":")[0];
    if (userStr) {
      var len = data.write(userStr, 8);
      data.write("@c.us", 8 + len);
    }
  }

  crypto.randomFillSync(data, 28, 16);

  var hash = crypto.createHash("sha256").update(data).digest();
  var hex = hash.toString("hex", 0, 9).toUpperCase();
  var baseId = "3EB0" + hex;

  if (!prefix) return baseId;

  var pos = 4 + (hash[0] & 15);
  return baseId.slice(0, pos) + String(prefix).toUpperCase() + baseId.slice(pos);
}

/**
 * Generates a plain random message ID with no custom prefix (fallback path
 * equivalent to Baileys' own `generateMessageID`).
 * @returns {string}
 */
function generateRandomMessageId() {
  return "3EB0" + crypto.randomBytes(18).toString("hex").toUpperCase();
}

/**
 * Predicts the sending device from the shape of a message ID.
 * Mirrors Baileys' own `getDevice()` regex exactly.
 * @param {string} id
 * @returns {'ios'|'web'|'android'|'desktop'|'unknown'}
 */
function getDevice(id) {
  if (typeof id !== "string") return "unknown";
  if (/^3A.{18}$/.test(id)) return "ios";
  if (/^3E.{20}$/.test(id)) return "web";
  if (/^(.{21}|.{32})$/.test(id)) return "android";
  if (/^(3F|.{18}$)/.test(id)) return "desktop";
  return "unknown";
}

/**
 * Default heuristic used to flag a message as bot-sent when the consumer
 * doesn't supply their own `bot(id)` predicate via Client()/Extend().
 * @param {string} id
 * @returns {boolean}
 */
function defaultIsBot(id) {
  if (typeof id !== "string") return false;
  return (id.startsWith("3EB0") && id.length === 40) || id.startsWith("BAE") || /-/.test(id);
}

/**
 * Human-readable byte size (no external dependency).
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  var k = 1024;
  var sizes = ["B", "KB", "MB", "GB", "TB"];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  i = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Inclusive random integer between min and max.
 * @param {number} min
 * @param {number} max
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Picks one random element from an array.
 * @template T
 * @param {T[]} array
 * @returns {T|undefined}
 */
function pickRandom(array) {
  if (!Array.isArray(array) || array.length === 0) return undefined;
  return array[randomInt(0, array.length - 1)];
}

var URL_REGEX = /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*))/i;

/**
 * Whether a string contains a URL.
 * @param {string} text
 * @returns {boolean}
 */
function isUrl(text) {
  return typeof text === "string" && URL_REGEX.test(text);
}

/**
 * Extracts the first URL found in a string, if any.
 * @param {string} text
 * @returns {string|undefined}
 */
function extractUrlFromText(text) {
  if (typeof text !== "string") return undefined;
  var match = text.match(URL_REGEX);
  return match ? match[0] : undefined;
}

exports.sleep = sleep;
exports.unixTimestampSeconds = unixTimestampSeconds;
exports.generateMessageId = generateMessageId;
exports.generateRandomMessageId = generateRandomMessageId;
exports.getDevice = getDevice;
exports.defaultIsBot = defaultIsBot;
exports.formatBytes = formatBytes;
exports.randomInt = randomInt;
exports.pickRandom = pickRandom;
exports.isUrl = isUrl;
exports.extractUrlFromText = extractUrlFromText;
exports.URL_REGEX = URL_REGEX;
