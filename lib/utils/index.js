"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var functions = require("./functions");
var media = require("./media");
var message = require("./message");
var linkPreview = require("./link-preview");
var contentBuilder = require("./content-builder");
var protoUpdate = require("./proto-update");

/**
 * @nexray/lib — utils/index.js
 *
 * `Utils` is a single, module-level object — Node's require cache
 * guarantees it's the same object instance across every file that imports
 * it from this package. Calling `Utils.extend({...})` in one file mutates
 * this shared object in place, so the added functions are immediately
 * visible from `Utils.xxx` in any other file — no passing an instance
 * around needed.
 */
var Utils = {
  sleep: functions.sleep,
  unixTimestampSeconds: functions.unixTimestampSeconds,
  generateMessageId: functions.generateMessageId,
  generateRandomMessageId: functions.generateRandomMessageId,
  getDevice: functions.getDevice,
  defaultIsBot: functions.defaultIsBot,
  formatBytes: functions.formatBytes,
  randomInt: functions.randomInt,
  pickRandom: functions.pickRandom,
  isUrl: functions.isUrl,
  extractUrlFromText: functions.extractUrlFromText,

  getBufferFromUrl: media.getBufferFromUrl,
  detectMime: media.detectMime,
  getStream: media.getStream,
  extractImageThumb: media.extractImageThumb,
  getCompressedThumbnail: media.getCompressedThumbnail,
  writeTempFile: media.writeTempFile,
  getAudioDuration: media.getAudioDuration,
  getAudioWaveform: media.getAudioWaveform,

  getContentType: message.getContentType,
  normalizeMessageContent: message.normalizeMessageContent,
  extractMessageContent: message.extractMessageContent,
  hasValidAlbumMedia: message.hasValidAlbumMedia,
  hasValidInteractiveHeader: message.hasValidInteractiveHeader,
  getBodyFromMessage: message.getBodyFromMessage,

  getUrlInfo: linkPreview.getUrlInfo,
  extractFirstUrl: linkPreview.extractFirstUrl,

  buildTextContent: contentBuilder.buildTextContent,
  buildButtonsContent: contentBuilder.buildButtonsContent,
  buildListContent: contentBuilder.buildListContent,
  buildInteractiveContent: contentBuilder.buildInteractiveContent,
  buildCarouselContent: contentBuilder.buildCarouselContent,
  buildAlbumHeader: contentBuilder.buildAlbumHeader,
  buildPollContent: contentBuilder.buildPollContent,
  buildPollResultContent: contentBuilder.buildPollResultContent,
  buildReactContent: contentBuilder.buildReactContent,
  buildLocationContent: contentBuilder.buildLocationContent,
  buildContactsContent: contentBuilder.buildContactsContent,
  buildProductMessage: contentBuilder.buildProductMessage,

  updateProtoOnStartup: protoUpdate.updateProtoOnStartup
};

var PROTECTED = new Set(Object.keys(Utils).concat(["extend"]));

/**
 * Merge additional helper functions onto the shared `Utils` namespace.
 * Warns (does not throw) when a key would shadow a built-in helper.
 * @param {Record<string, Function>} fnMap
 */
function extend(fnMap) {
  if (!fnMap || typeof fnMap !== "object") return Utils;
  for (var name in fnMap) {
    if (!Object.prototype.hasOwnProperty.call(fnMap, name)) continue;
    var fn = fnMap[name];
    if (typeof fn !== "function") continue;
    if (PROTECTED.has(name)) {
      console.warn('[@nexray/lib] Utils.extend(): "' + name + '" collides with a built-in Utils method and was NOT overridden.');
      continue;
    }
    Utils[name] = fn;
  }
  return Utils;
}

Utils.extend = extend;

exports.Utils = Utils;
exports.sleep = functions.sleep;
exports.unixTimestampSeconds = functions.unixTimestampSeconds;
exports.generateMessageId = functions.generateMessageId;
exports.generateRandomMessageId = functions.generateRandomMessageId;
exports.getDevice = functions.getDevice;
exports.defaultIsBot = functions.defaultIsBot;
exports.formatBytes = functions.formatBytes;
exports.randomInt = functions.randomInt;
exports.pickRandom = functions.pickRandom;
exports.isUrl = functions.isUrl;
exports.extractUrlFromText = functions.extractUrlFromText;
exports.getBufferFromUrl = media.getBufferFromUrl;
exports.detectMime = media.detectMime;
exports.getStream = media.getStream;
exports.extractImageThumb = media.extractImageThumb;
exports.getCompressedThumbnail = media.getCompressedThumbnail;
exports.writeTempFile = media.writeTempFile;
exports.getAudioDuration = media.getAudioDuration;
exports.getAudioWaveform = media.getAudioWaveform;
exports.getContentType = message.getContentType;
exports.normalizeMessageContent = message.normalizeMessageContent;
exports.extractMessageContent = message.extractMessageContent;
exports.hasValidAlbumMedia = message.hasValidAlbumMedia;
exports.hasValidInteractiveHeader = message.hasValidInteractiveHeader;
exports.getBodyFromMessage = message.getBodyFromMessage;
exports.getUrlInfo = linkPreview.getUrlInfo;
exports.extractFirstUrl = linkPreview.extractFirstUrl;
exports.buildTextContent = contentBuilder.buildTextContent;
exports.buildButtonsContent = contentBuilder.buildButtonsContent;
exports.buildListContent = contentBuilder.buildListContent;
exports.buildInteractiveContent = contentBuilder.buildInteractiveContent;
exports.buildCarouselContent = contentBuilder.buildCarouselContent;
exports.buildAlbumHeader = contentBuilder.buildAlbumHeader;
exports.buildPollContent = contentBuilder.buildPollContent;
exports.buildPollResultContent = contentBuilder.buildPollResultContent;
exports.buildReactContent = contentBuilder.buildReactContent;
exports.buildLocationContent = contentBuilder.buildLocationContent;
exports.buildContactsContent = contentBuilder.buildContactsContent;
exports.buildProductMessage = contentBuilder.buildProductMessage;
exports.updateProtoOnStartup = protoUpdate.updateProtoOnStartup;
