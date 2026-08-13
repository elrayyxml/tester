'use strict'

const { isUrl } = require('./functions')
const { extractImageThumb, getCompressedThumbnail } = require('./media')
const { NexrayError, ErrorMessages } = require('../constant/errors')

let linkPreview
try {
  linkPreview = require('link-preview-js')
} catch {
  linkPreview = null
}

/**
 * Extract the first URL from text.
 * @param {string} text
 * @returns {string|undefined}
 */
function extractFirstUrl(text) {
  if (!text) return undefined
  const match = String(text).match(/https?:\/\/[^\s<>"']+/i)
  return match ? match[0] : undefined
}

/**
 * Fetch OpenGraph / meta information for a URL.
 * Best-effort: returns undefined on any failure.
 *
 * @param {string} text - message text that may contain a URL
 * @param {{ uploadImage?: Function }} [opts]
 * @returns {Promise<object|undefined>}
 */
async function getUrlInfo(text, opts = {}) {
  const url = extractFirstUrl(text)
  if (!url) return undefined

  try {
    let info = null
    if (linkPreview) {
      info = await linkPreview.getLinkPreview(url, {
        timeout: 8000,
        followRedirects: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      })
    } else {
      // minimal fallback: just return the matched URL
      return {
        'matched-text': url,
        title: url,
        description: '',
        jpegThumbnail: undefined
      }
    }

    if (!info) return undefined

    const result = {
      'matched-text': url,
      title: info.title || '',
      description: info.description || '',
      previewType: 0,
      jpegThumbnail: undefined,
      highQualityThumbnail: undefined
    }

    // Prefer the largest image
    const imageUrl = info.images?.[0] || info.favicons?.[0]
    if (imageUrl && opts.uploadImage) {
      try {
        // high quality path via prepareWAMessageMedia is left to the caller
        // here we just provide a compressed thumbnail
        const { getBufferFromUrl } = require('./media')
        const buf = await getBufferFromUrl(imageUrl)
        result.jpegThumbnail = await getCompressedThumbnail(buf)
      } catch {
        // ignore thumbnail errors
      }
    } else if (imageUrl) {
      try {
        const { getBufferFromUrl } = require('./media')
        const buf = await getBufferFromUrl(imageUrl)
        result.jpegThumbnail = await extractImageThumb(buf, 100)
      } catch {}
    }

    return result
  } catch (err) {
    // best-effort – never throw
    return undefined
  }
}

module.exports = {
  getUrlInfo,
  extractFirstUrl
}
