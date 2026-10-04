/** @module utils/functions */

import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import sharp from 'sharp';

import {
  isBuffer,
  isUint8Array,
  isReadable,
  toBuffer,
  toUint8Array,
  toBytes,
  bytesFromUrlOrPath,
  stripDevice,
  isJidValid,
  isGroupJid,
  isBroadcastJid,
  isLidJid,
  isPhoneJid,
  jidToNumber,
  numberToJid,
  isValidWaNumber,
  extractNumbers,
  formatPairingCode,
  bytesToBase64,
  sleep,
  randomHex,
  generateMessageID,
  getDevice,
  buildMessageId,
} from './converter.js';
import { createBoundedMap, createBoundedSet } from './caching.js';
import { createLidMappingCache } from './resolver.js';
import { createCooldown } from './cooldown.js';
import { createSpamFilter } from './spam.js';
import { sha256, md5, randomBytes, randomId, aesEncrypt, aesDecrypt, hmacSha256 } from './chiper.js';
import { isOwner, isAdmin, isSuperAdmin } from './security.js';
import { loadModules } from './loader.js';
import { Logger, logWithTime, success, danger } from './logger.js';
import { LocalyStore, temporaryStore, localyStore } from '../memory/index.js';

/** @module utils/functions — Utils */

/**
 * Ukuran byte. Dengan `thresholdMB` mengembalikan boolean (melebihi batas),
 * tanpa threshold mengembalikan string terbaca.
 *
 * @param {number|Buffer|Uint8Array} input jumlah byte atau buffer
 * @param {number} [thresholdMB] batas dalam MB
 * @returns {boolean|string}
 */
const size = (input, thresholdMB = null) => {
  const bytes = isBuffer(input) ? input.length : input;
  if (thresholdMB !== null) return bytes > thresholdMB * 1024 * 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return i === 0 ? `${bytes} B` : `${value.toFixed(2)} ${units[i]}`;
};

/**
 * Transcode gambar (buffer/URL/path) menjadi JPEG persegi 300x300 untuk
 * thumbnail pesan.
 *
 * @param {Buffer|Uint8Array|string} input
 * @returns {Promise<Buffer>}
 */
const sharpResize = async (input) => {
  let buffer;
  if (isBuffer(input)) buffer = input;
  else if (isURL(input)) buffer = Buffer.from(await (await fetch(input)).arrayBuffer());
  else buffer = await readFile(input);
  return sharp(buffer).resize(300, 300, { fit: 'cover' }).toBuffer();
};

/** @template T @param {T[]} arr @returns {T} */
const random = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Bungkus teks dengan format WhatsApp.
 *
 * @param {'bold'|'italic'|'strike'|'mono'} font
 * @param {string} text
 * @returns {string}
 */
const texted = (font, text) =>
  ({ bold: `*${text}*`, italic: `_${text}_`, strike: `~${text}~`, mono: `\`\`\`${text}\`\`\`` })[font] ?? text;

/** Baris contoh pemakaian perintah. */
const example = (prefix, command, args) => `• ${texted('bold', 'Example')} : ${prefix + command} ${args}`;

/** @param {string} url @returns {boolean} */
const isURL = (url) => {
  try {
    return (new URL(url), true);
  } catch {
    return false;
  }
};

/** @param {string} str */
const isUrlValid = (str) => /https?:\/\/\S+/i.test(str);

/** @param {string} str */
const isUrlInText = (str) =>
  /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g.test(str);

/** Tautan http pertama dalam teks. @param {string} text @returns {string|null} */
const extractLink = (text) => text?.match(/https?:\/\/[^\s]+/g)?.[0] ?? null;

/** JSON terformat dengan proteksi referensi melingkar. @param {*} data */
const jsonFormat = (data) => {
  const seen = new WeakSet();
  const replacer = (_, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
  try {
    return JSON.stringify(typeof data === 'string' ? JSON.parse(data) : data, replacer, 2);
  } catch {
    return String(data);
  }
};

/**
 * JID siap kirim. Grup dan nomor telepon dikembalikan apa adanya; JID @lid
 * dipetakan ke nomor telepon bila cache mengetahuinya — server menolak
 * pengiriman ke @lid mentah untuk sebagian akun.
 *
 * @param {string} jid
 * @param {{ getPn: (lid: string) => string|null }} [lidCache]
 * @returns {string}
 */
export function resolveSendableJid(jid, lidCache) {
  if (!isJidValid(jid)) return jid;
  if (isGroupJid(jid) || isPhoneJid(jid)) return stripDevice(jid);
  if (isLidJid(jid) && lidCache) {
    const pn = lidCache.getPn(jid);
    if (pn) return pn;
  }
  return stripDevice(jid);
}

/** Pungut mention `@628xx` dari teks menjadi daftar JID. @param {string} text */
export function parseMentions(text) {
  if (typeof text !== 'string') return [];
  return [...new Set(text.match(/@(\d{5,20})/g) ?? [])].map((m) => `${m.slice(1)}@s.whatsapp.net`);
}

/**
 * Teks gabungan dari Proto.IMessage bentuk apa pun, termasuk di dalam
 * pembungkus ephemeral/viewOnce/documentWithCaption.
 *
 * @param {object|undefined} message
 * @returns {string}
 */
export function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.conversation === 'string') return message.conversation;
  const ext = message.extendedTextMessage ?? message.imageMessage ?? message.videoMessage;
  if (ext && typeof ext.text === 'string') return ext.text;
  if (typeof message?.documentMessage?.caption === 'string') return message.documentMessage.caption;
  if (typeof message?.documentWithCaptionMessage?.message?.documentMessage?.caption === 'string') {
    return message.documentWithCaptionMessage.message.documentMessage.caption;
  }
  if (message.ephemeralMessage?.message) return messageText(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return messageText(message.viewOnceMessage.message);
  return '';
}

/** Nama tipe pesan: field pertama Proto.IMessage. @param {object|undefined} message */
export function getContentType(message) {
  if (!message || typeof message !== 'object') return undefined;
  return Object.keys(message)[0];
}

/** `628xx@s.whatsapp.net` menjadi `@628xx`. @param {string} jid */
export const jidToMention = (jid) => (jid ? `@${jidToNumber(stripDevice(jid))}` : '');

/** @returns {void} */
export function noop() {}

/**
 * Bundel utilitas: diekspor sebagai `Utils` dari entry point dan dilekatkan
 * ke sock (`sock.utils`).
 */
export const Utils = {
  Logger,
  logWithTime,
  success,
  danger,
  isBuffer,
  isUint8Array,
  isReadable,
  toBuffer,
  toUint8Array,
  toBytes,
  bytesFromUrlOrPath,
  stripDevice,
  isJidValid,
  isGroupJid,
  isBroadcastJid,
  isLidJid,
  isPhoneJid,
  jidToNumber,
  numberToJid,
  isValidWaNumber,
  extractNumbers,
  formatPairingCode,
  bytesToBase64,
  sleep,
  randomHex,
  generateMessageID,
  getDevice,
  buildMessageId,
  createBoundedMap,
  createBoundedSet,
  createLidMappingCache,
  createCooldown,
  createSpamFilter,
  sha256,
  md5,
  randomBytes,
  randomId,
  aesEncrypt,
  aesDecrypt,
  hmacSha256,
  isOwner,
  isAdmin,
  isSuperAdmin,
  loadModules,
  temporaryStore,
  LocalyStore,
  localyStore,
  size,
  sharp: sharpResize,
  random,
  texted,
  example,
  isURL,
  isUrlValid,
  isUrlInText,
  extractLink,
  jsonFormat,
  resolveSendableJid,
  parseMentions,
  messageText,
  getContentType,
  jidToMention,
  noop,
};

export default Utils;

/**
 * Config adapter: state antar-restart (opts.setting: owner, cover, footer,
 * dll.) disimpan sebagai berkas JSON `<custom_id>.config.json` di cwd dan
 * tersedia di `sock.config` di sesi berikutnya.
 */
export class Config {
  /**
   * @param {string} custom_id
   * @param {object} [initial] nilai awal, biasanya opts.setting
   * @param {string} [dir] folder penyimpanan, default cwd
   */
  constructor(custom_id, initial = {}, dir = process.cwd()) {
    this.custom_id = custom_id;
    this.file = path.join(dir, `${custom_id}.config.json`);
    this.data = { owner: '', cover: '', footer: '', header: '', ...initial };
    this.load();
  }

  /** Baca berkas config; berkas yang belum ada diabaikan. @returns {Config} */
  load() {
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf-8')) };
    } catch {
      // Berkas belum ada -> nilai awal tetap dipakai.
    }
    return this;
  }

  /** @returns {Config} */
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this;
  }

  /** @param {string} key @returns {*} */
  get(key) {
    return this.data[key];
  }

  /** @param {string} key @param {*} value @returns {Config} */
  set(key, value) {
    this.data[key] = value;
    return this.save();
  }

  /** @returns {object} */
  toJSON() {
    return { ...this.data };
  }
}
