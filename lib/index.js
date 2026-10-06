/** @module index — @nexray/zapo */

import './core/polyfill.js';

export { Client, default as default } from './core/connection.js';
export { createInstance, getMediaProcessor } from './core/instance.js';
export { buildSendOptions, toZapoContent, isRawProtoMessage } from './core/instance.js';
export { serializeMessage } from './core/serialize.js';
export { createSessionStore, createBackend, SQLITE_FILENAME, sessionDbPath } from './core/storage.js';
export { bindHelpers } from './core/binding.js';
export { Config } from './utils/functions.js';
export { default as Utils } from './utils/functions.js';
export {
  reply,
  sendReact,
  sendFile,
  sendSticker,
  sendMessageModify,
  pollResult,
  sendContact,
  sendAlbumMessage,
  groupStatus,
  replyButton,
  sendMetaMsg,
} from './core/message.js';
export { unwrapMessage, findQuoted, getMentioned } from './core/message-util.js';

export {
  createJsonProxy,
  createSqliteProxy,
  createMongoProxy,
  createMysqlProxy,
  createPostgresProxy,
  createRedisProxy,
} from './proxy/index.js';

export { temporaryStore, LocalyStore, localyStore } from './memory/index.js';

export { Logger, logWithTime, success, danger } from './utils/logger.js';

export {
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
} from './utils/converter.js';

export { createBoundedMap, createBoundedSet } from './utils/caching.js';

export {
  resolveSendableJid,
  parseMentions,
  messageText,
  getContentType,
  jidToMention,
  extractCommand,
  matchCommand,
  noop,
  size,
  sharp,
  random,
  texted,
  example,
  isURL,
  isUrlValid,
  isUrlInText,
  extractLink,
  jsonFormat,
} from './utils/functions.js';
export { Utils as utilsFunctions } from './utils/functions.js';

export { createLidMappingCache } from './utils/resolver.js';
export { createCooldown } from './utils/cooldown.js';
export { createSpamFilter } from './utils/spam.js';
export {
  sha256,
  md5,
  randomBytes,
  randomId,
  aesEncrypt,
  aesDecrypt,
  hmacSha256,
} from './utils/chiper.js';
export { isOwner, isAdmin, isSuperAdmin } from './utils/security.js';
export { loadModules } from './utils/loader.js';
