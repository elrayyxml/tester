'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Update Baileys WAProto files from the latest public source
 * (same approach as neoxr proto updater).
 *
 * Only runs when options.updateProtoOnStartup === true.
 * Failures are non-fatal (logged, never thrown to the caller).
 *
 * @param {object} [logger]
 * @returns {Promise<boolean>} true if files were written
 */
async function updateProtoOnStartup(logger) {
  const baseUrl =
    'https://raw.githubusercontent.com/wppconnect-team/wa-proto/refs/heads/main'

  // Resolve baileys package location
  let baileysRoot
  try {
    baileysRoot = path.dirname(require.resolve('baileys/package.json'))
  } catch {
    try {
      baileysRoot = path.dirname(require.resolve('@whiskeysockets/baileys/package.json'))
    } catch {
      logger?.warn?.('updateProtoOnStartup: baileys package not found, skip')
      return false
    }
  }

  const outputPath = path.join(baileysRoot, 'WAProto')

  const fetchText = async (url) => {
    const res = await fetch(url, {
      headers: { 'user-agent': 'nexray-lib-proto-updater' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
  }

  try {
    const [rawIndexJs, rawIndexDts, rawWaProto] = await Promise.all([
      fetchText(`${baseUrl}/dist/index.js`),
      fetchText(`${baseUrl}/dist/index.d.ts`),
      fetchText(`${baseUrl}/WAProto.proto`)
    ])

    const replaceProto = (c) => c.replaceAll('waproto', 'proto')

    let indexJs = replaceProto(rawIndexJs)
    // CJS-friendly transforms (Baileys may ship either CJS or ESM)
    indexJs = indexJs
      .replace(
        /var (\$protobuf) = require\((["']protobufjs\/minimal["'])\)/,
        'import $1 from $2'
      )
      .replace(/(protobufjs\/minimal)/, '$1.js')
      .replace(
        /(Message\.HistorySyncType) = /,
        '$1 = Message.HistorySyncNotification.HistorySyncType = '
      )
      .replace(/(\$root\.proto = )/, 'export const proto = $1')
      .replace(/module\.exports = (\$root)/, 'export default $1')

    const indexDts = replaceProto(rawIndexDts)
    const waProto = replaceProto(rawWaProto)

    fs.mkdirSync(outputPath, { recursive: true })
    fs.writeFileSync(path.join(outputPath, 'index.js'), indexJs)
    fs.writeFileSync(path.join(outputPath, 'index.d.ts'), indexDts)
    fs.writeFileSync(path.join(outputPath, 'WAProto.proto'), waProto)

    logger?.info?.('WAProto files updated successfully')
    return true
  } catch (err) {
    logger?.warn?.({ err: err?.message || err }, 'updateProtoOnStartup failed (non-fatal)')
    return false
  }
}

module.exports = {
  updateProtoOnStartup
}
