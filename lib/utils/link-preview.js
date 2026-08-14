"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var extractUrlFromText = require("./functions").extractUrlFromText;
var mediaUtils = require("./media");
var extractImageThumb = mediaUtils.extractImageThumb;
var getCompressedThumbnail = mediaUtils.getCompressedThumbnail;
var getBufferFromUrl = mediaUtils.getBufferFromUrl;

/**
 * @nexray/lib — utils/link-preview.js
 *
 * Given a piece of text, detects the first URL present and generates a link
 * preview payload consumable by `extendedTextMessage` (used automatically
 * by `sock.sendText`). Best-effort only: any failure here never throws and
 * never blocks sending the text message itself.
 */

var linkPreviewJs = null;
try {
  linkPreviewJs = require("link-preview-js");
} catch (e) {
  linkPreviewJs = null;
}

/**
 * @param {string} text
 * @param {{ uploadImage?: boolean, logger?: object }} [opts]
 * @returns {Promise<object|undefined>}
 */
async function getUrlInfo(text, opts) {
  opts = opts || {};
  var url = extractUrlFromText(text);
  if (!url) return undefined;

  try {
    var info = null;
    if (linkPreviewJs) {
      info = await linkPreviewJs.getLinkPreview(url, {
        timeout: 8000,
        followRedirects: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
    } else {
      // minimal fallback when link-preview-js isn't installed
      return {
        "matched-text": url,
        title: url,
        description: "",
        jpegThumbnail: undefined
      };
    }

    if (!info) return undefined;

    var result = {
      "matched-text": url,
      title: info.title || "",
      description: info.description || "",
      previewType: 0,
      jpegThumbnail: undefined,
      highQualityThumbnail: undefined
    };

    var imageUrl = (info.images && info.images[0]) || (info.favicons && info.favicons[0]);
    if (imageUrl) {
      try {
        var buf = await getBufferFromUrl(imageUrl);
        result.jpegThumbnail = opts.uploadImage ? await getCompressedThumbnail(buf) : await extractImageThumb(buf, 100);
      } catch (e) {
        // ignore thumbnail errors — link preview still works without one
      }
    }

    return result;
  } catch (err) {
    return undefined;
  }
}

exports.getUrlInfo = getUrlInfo;
exports.extractFirstUrl = extractUrlFromText;
