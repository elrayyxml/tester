/** @module utils/converter */

import {
  parsePhoneNumber,
  isValidPhoneNumber,
  getCountryCallingCode,
} from 'libphonenumber-js';
import nodeCrypto from 'crypto';

/**
 * Nomor lokal/internasional apa pun ke JID WhatsApp lengkap.
 *
 * @param {string} number mis. `081234567890` atau `+6281234567890`
 * @param {string} [country] kode negara bila tanpa awalan, mis. `ID`
 * @returns {string|undefined} `6281234567890@s.whatsapp.net`
 */
export function numberToJid(number, country) {
  if (typeof number !== 'string') return undefined;
  const digits = number.replace(/\D/g, '');
  if (!digits) return undefined;

  try {
    const parsed = parsePhoneNumber(number, country);
    if (parsed?.isValid()) return `${parsed.number.replace(/\D/g, '')}@s.whatsapp.net`;
  } catch {
    // Bukan E.164 valid -> format manual di bawah.
  }

  if (country && !number.startsWith('+')) {
    try {
      return `${getCountryCallingCode(country)}${digits}@s.whatsapp.net`;
    } catch {
      return undefined;
    }
  }
  return `${digits}@s.whatsapp.net`;
}

/**
 * @param {string} number
 * @returns {boolean}
 */
export const isValidWaNumber = (number) => {
  try {
    return isValidPhoneNumber(number);
  } catch {
    return false;
  }
};

/**
 * @param {*} value
 * @returns {boolean}
 */
export const isBuffer = (value) => typeof Buffer !== 'undefined' && Buffer.isBuffer(value);

/**
 * @param {*} value
 * @returns {boolean}
 */
export const isUint8Array = (value) => value instanceof Uint8Array;

/**
 * @param {*} value
 * @returns {boolean}
 */
export const isReadable = (value) =>
  value != null && typeof value === 'object' && typeof value.pipe === 'function';

/**
 * @param {*} value
 * @returns {Buffer|null}
 */
export const toBuffer = (value) => {
  if (value == null) return null;
  if (isBuffer(value)) return value;
  if (isUint8Array(value)) return Buffer.from(value);
  return null;
};

/**
 * @param {*} value
 * @returns {Uint8Array|null}
 */
export const toUint8Array = (value) => {
  if (value == null) return null;
  if (isUint8Array(value)) return value;
  if (isBuffer(value)) return new Uint8Array(value);
  return null;
};

/**
 * Baca byte dari URL http(s) atau path lokal.
 *
 * @param {string} str
 * @returns {Promise<Uint8Array>}
 */
export async function bytesFromUrlOrPath(str) {
  if (/^https?:\/\//i.test(str)) {
    const res = await fetch(str);
    if (!res.ok) throw new Error(`Failed to download media (HTTP ${res.status}): ${str}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const { readFile } = await import('fs/promises');
  return new Uint8Array(await readFile(str));
}

/**
 * Sumber media apa pun menjadi byte. Path dan URL diunduh.
 *
 * @param {*} value
 * @returns {Promise<Uint8Array|Buffer|*|null>}
 */
export async function toBytes(value) {
  if (value == null) return value;
  if (isBuffer(value)) return value;
  if (isUint8Array(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return bytesFromUrlOrPath(value);
  if (typeof value === 'object') {
    if (isBuffer(value.buffer)) return value.buffer;
    if (isUint8Array(value.buffer)) return value.buffer;
    if (value.url) return bytesFromUrlOrPath(value.url);
    if (isReadable(value.stream)) return value.stream;
  }
  return value;
}

/**
 * Buang device-id sebelum `@`, mis. `628xx:12@lid` menjadi `628xx@lid`.
 *
 * @param {string} jid
 * @returns {string|undefined}
 */
export const stripDevice = (jid) => (typeof jid === 'string' ? jid.replace(/:\d+(?=@)/, '') : jid);

/**
 * JID sah memiliki bagian user dan domain. Mention rusak membuat
 * seluruh pesan gagal terkirim di zapo.
 *
 * @param {*} jid
 * @returns {boolean}
 */
export const isJidValid = (jid) => typeof jid === 'string' && /^[^@\s]+@[\w.-]+$/.test(jid);

/**
 * @param {string} jid
 * @returns {boolean}
 */
export const isGroupJid = (jid) => typeof jid === 'string' && jid.endsWith('@g.us');

/**
 * @param {string} jid
 * @returns {boolean}
 */
export const isBroadcastJid = (jid) => typeof jid === 'string' && jid.endsWith('@broadcast');

/**
 * @param {string} jid
 * @returns {boolean}
 */
export const isLidJid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');

/**
 * @param {string} jid
 * @returns {boolean}
 */
export const isPhoneJid = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');

/**
 * Nomor dari JID: `628xx:12@s.whatsapp.net` menjadi `628xx`.
 *
 * @param {string} jid
 * @returns {string|undefined}
 */
export const jidToNumber = (jid) =>
  typeof jid === 'string' ? stripDevice(jid).split('@')[0]?.replace(/\+.*/, '') : undefined;

/**
 * Nomor pertama (min. 5 digit) dari teks bebas.
 *
 * @param {string} text
 * @returns {string}
 */
export const extractNumbers = (text) => {
  if (typeof text !== 'string') return '';
  const match = text.match(/\d{5,}/);
  return match ? match[0] : '';
};

/**
 * Kode pairing dua blok empat: `1234-5678`.
 *
 * @param {string} code
 * @returns {string}
 */
export const formatPairingCode = (code) =>
  typeof code === 'string' && code.length >= 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/**
 * @param {Uint8Array|Buffer} value
 * @param {boolean} [urlSafe]
 * @returns {string|undefined}
 */
export const bytesToBase64 = (value, urlSafe = false) => {
  const buffer = toBuffer(value);
  if (!buffer) return undefined;
  const b64 = buffer.toString('base64');
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_') : b64;
};

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Byte acak menjadi heksadesimal huruf besar.
 *
 * @param {number} size panjang byte
 * @returns {string}
 */
export const randomHex = (size) =>
  [...nodeCrypto.randomBytes(size)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * ID pesan keluar bawaan adapter: awalan `ELRAYY-` + 15 byte hex besar.
 *
 * @returns {string}
 */
export const generateMessageID = () => `ELRAYY-${randomHex(15)}`;

/**
 * Device yang diprediksi dari ID pesan.
 *
 * @param {string} id
 * @returns {'ios'|'web'|'android'|'desktop'|'unknown'}
 */
export const getDevice = (id) =>
  /^3A.{18}$/.test(id) ? 'ios'
  : /^3E.{20}$/.test(id) ? 'web'
  : /^(.{21}|.{32})$/.test(id) ? 'android'
  : /^(3F|.{18}$)/.test(id) ? 'desktop'
  : 'unknown';

/**
 * ID pesan keluar sesuai mode stealth. `customId` di-inject sebagai tag hex
 * di ujung ID sehingga pesan dari bot ini dapat dikenali.
 *
 * @param {object} [stealth] {idPrefix, idLength}
 * @param {string} [customId]
 * @returns {string}
 */
export const buildMessageId = (stealth, customId) => {
  const length = stealth?.idLength ?? 22;
  const prefix = stealth?.idPrefix ?? '';
  const body = randomHex(Math.max(4, Math.floor((length - prefix.length) / 2)));

  if (!customId) return `${prefix}${body}`.slice(0, length);

  const tag = Buffer.from(customId, 'utf-8').toString('hex').toUpperCase().slice(0, 8);
  return `${prefix}${body.slice(0, Math.max(0, length - prefix.length - tag.length))}${tag}`
    .padEnd(length, '0')
    .slice(0, length);
};
