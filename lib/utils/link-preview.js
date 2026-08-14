'use strict'

const { isUrl } = require('./functions')
const { getGlobalConfig } = require('../constant/configure')

function firstMeta(html, names) {
  for (const name of names) {
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i')
    const reverse = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i')
    const found = html.match(pattern) || html.match(reverse)
    if (found?.[1]) return found[1].replace(/&amp;/g, '&')
  }
  return undefined
}

async function getUrlInfo(text, opts = {}) {
  const match = String(text || '').match(/https?:\/\/[^\s<]+/i)
  if (!match || !isUrl(match[0])) return undefined
  const url = match[0].replace(/[),.!?]+$/, '')
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(opts.timeout || getGlobalConfig().REQUEST_TIMEOUT) })
    if (!response.ok) return undefined
    const html = (await response.text()).slice(0, 2_000_000)
    const title = firstMeta(html, ['og:title', 'twitter:title']) || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    const description = firstMeta(html, ['og:description', 'twitter:description', 'description'])
    const image = firstMeta(html, ['og:image', 'twitter:image'])
    const result = { 'canonical-url': url, title, description, 'matched-text': url }
    if (image) result.jpegThumbnail = image
    if (opts.uploadImage && image) {
      try {
        result.highQualityThumbnail = await opts.uploadImage(image)
      } catch {
        // Thumbnail preview bersifat best-effort.
      }
    }
    return result
  } catch {
    return undefined
  }
}

module.exports = { getUrlInfo }
