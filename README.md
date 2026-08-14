# @nexray/lib

Lightweight helper / wrapper on top of [Baileys](https://github.com/WhiskeySockets/Baileys).  
It does **not** manage authentication or create sockets — you pass an existing `makeWASocket(...)` instance.

Focus:

1. **Extend / Client** – attach convenient `sock.sendText`, `sock.sendMedia`, `sock.sendInteractive`, … methods that send via `sock.relayMessage`.
2. **serialize** – enrich `messages.upsert` payloads into a friendly object (`m.body`, `m.reply()`, `m.react()`, …).
3. **Utils** – global singleton registry of helper functions that can be extended from any file in your project.

> **Peer dependency**: `baileys ^7.0.0-rc10` (or newer).  
> This package does **not** install Baileys automatically.

---

## Install

```bash
npm i @nexray/lib baileys@^7.0.0-rc10
# or
pnpm add @nexray/lib baileys@^7.0.0-rc10
```

---

## Quick Start

```js
import { makeWASocket, useMultiFileAuthState } from 'baileys'
import { Client } from '@nexray/lib'

const { state, saveCreds } = await useMultiFileAuthState('auth')
const sock = makeWASocket({
  auth: state,
  // … your usual Baileys config
})

sock.ev.on('creds.update', saveCreds)

await Client(sock, {
  bot: (id) =>
    (id.startsWith('3EB0') && id.length === 40) ||
    id.startsWith('BAE') ||
    /[-]/.test(id),
  messageIdPrefix: 'NEXRAY',
  updateProtoOnStartup: true,
  autoFollowNewsletter: false,          // must be explicit
  newsletterAnnotation: false           // must be explicit
})

sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    const m = sock.serialize(msg)
    if (!m || m.fromMe) continue

    if (m.body === '.ping') {
      await m.reply('Pong! 🏓')
    }
  }
})
```

---

## API Overview

### `Client(sock, options)`

Mutates the given Baileys socket in-place, attaches every helper method, and installs the built-in listeners.

Returns the same socket (for chaining).

### `Extend(sock, options)`

Same method attachment as `Client`, but **does not** install any listeners.  
Useful when you want full control over event handling.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bot` | `(id: string) => boolean` | simple regex | Used by `serialize` to set `m.isBot` |
| `stealth` | `'ios' \| 'android' \| 'web' \| 'desktop'` | `undefined` | Reserved for future device spoofing |
| `messageIdPrefix` | `string` | `undefined` | Inserted into generated message IDs |
| `updateProtoOnStartup` | `boolean` | `true` | Placeholder for proto refresh |
| `autoFollowNewsletter` | `string \| string[] \| false` | `false` | Explicitly follow newsletter(s) on start |
| `newsletterAnnotation` | `IForwardedNewsletterMessageInfo \| false` | `false` | Attach newsletter annotation to media |
| `logger` | Baileys-compatible logger | no-op | Optional logger |
| `onMessage` | `(ctx) => void` | – | High-level message callback |

> **Important**: `autoFollowNewsletter` and `newsletterAnnotation` default to `false`.  
> No hardcoded newsletter JIDs or hidden network calls exist in the library.

---

## Serialize

```js
const m = sock.serialize(rawMessage)
```

Produces an object with at least:

| Field | Description |
|-------|-------------|
| `key` | Original message key |
| `id` | Alias of `key.id` |
| `chat` | Alias of `key.remoteJid` |
| `sender` | Normalized sender JID |
| `senderLid` | LID of sender when available |
| `fromMe` | Boolean |
| `isGroup` / `isPrivate` / `isNewsletter` | Boolean helpers |
| `isBot` | Result of `options.bot(id)` |
| `device` | Detected device (`ios` / `android` / `web` / …) |
| `type` | Content type key (`conversation`, `imageMessage`, …) |
| `msg` | The typed content object |
| `body` | Normalized text body |
| `mentionedJid` | Array of mentioned JIDs |
| `quoted` | Recursively serialized quoted message (1 level) |
| `reply(text, opts?)` | Shortcut → `sock.sendText(chat, text, m, opts)` |
| `react(emoji)` | Shortcut → `sock.sendReact(chat, emoji, key)` |

---

## Sending helpers (all use `relayMessage`)

```js
await sock.sendText(jid, 'Hello', m)
await sock.sendAdText(jid, 'Check this', m, { title: '…', description: '…' })
await sock.sendReact(jid, '👍', key)
await sock.sendMedia(jid, bufferOrUrl, 'caption', m)
await sock.sendPtv(jid, videoBuffer, m)
await sock.sendSticker(jid, stickerBuffer, m)
await sock.sendStickerPack(jid, [buf1, buf2], m, { name: 'My Pack' })
await sock.sendContact(jid, contacts, m)
await sock.sendLocation(jid, { latitude, longitude, name }, m)
await sock.sendAlbum(jid, items, m)
await sock.sendPoll(jid, ['A', 'B'], m, { name: 'Vote' })
await sock.sendQuiz(newsletterJid, ['A', 'B'], m, { correctAnswer: 0 })
await sock.sendInteractive(jid, buttons, m, { caption: '…' })
await sock.sendCarousel(jid, cards, m)
await sock.sendLegacyButton(jid, buttons, m)
await sock.sendLegacyList(jid, sections, m)   // private chats only
await sock.sendOrderMessage(jid, thumb, text, m)
await sock.sendCopyMessage(jid, quotedMsg)
await sock.sendStatus(jids, content)
await sock.sendGroupStatus(jid, content)
```

All of them ultimately call `sock.relayMessage`.

---

## Utils singleton

```js
// anywhere in your project
import { Utils } from '@nexray/lib'

Utils.extend({
  formatRupiah(n) {
    return 'Rp' + Number(n).toLocaleString('id-ID')
  },
  isAdmin(jid, groupMetadata) {
    return groupMetadata.participants.some(
      p => p.id === jid && (p.admin === 'admin' || p.admin === 'superadmin')
    )
  }
})

// later, in another file (after the extend has been executed at least once)
import { Utils } from '@nexray/lib'
console.log(Utils.formatRupiah(50000)) // "Rp50.000"
```

Built-in helpers: `sleep`, `generateMessageId`, `getDevice`, `formatBytes`, `randomInt`, `pickRandom`, `isUrl`, `getBufferFromUrl`, `detectMime`, `getStream`, `extractImageThumb`, `getUrlInfo`, `getContentType`, `getBodyFromMessage`, …

---

## Global config

```js
import { getGlobalConfig, setGlobalConfig } from '@nexray/lib'

setGlobalConfig({
  TEMP_DIR: './tmp',
  REQUEST_TIMEOUT: 30000
})
```

Environment variables `FFMPEG_PATH`, `TEMP_DIR`, `REQUEST_TIMEOUT`, … are also respected.

---

## Error handling

All public send helpers throw `NexrayError` (with a `code` property) on validation failure instead of a generic `Error`.

```js
import { NexrayError } from '@nexray/lib'

try {
  await sock.sendQuiz('not-a-newsletter', ['A'], null, {})
} catch (e) {
  if (e instanceof NexrayError) {
    console.error(e.code, e.message)
  }
}
```

---

## Revisi helper pesan

Seluruh helper pengiriman memakai strict mode dan menerima quoted message dalam bentuk hasil `serialize`, raw `WAMessage`, atau object `{ key, message }`. Metadata quoted dinormalisasi kembali ke `contextInfo.participant`, `stanzaId`, `remoteJid`, dan `quotedMessage`.

```js
await sock.sendText(jid, 'Balasan', m, {
  mentions: ['628123456789@s.whatsapp.net'],
  mentionAll: true,
  contextInfo: { forwardingScore: 1 },
  linkPreview: false
})

await sock.sendLocation(jid, {
  latitude: -6.2,
  longitude: 106.8,
  name: 'Jakarta'
}, m, {
  text: 'Pilih tindakan',
  buttons: [{ name: 'quick_reply', paramsJson: { id: 'open' } }]
})

await sock.sendVideo(jid, video, 'Video', m, { ptv: true, gifPlayback: false })
await sock.sendImage(jid, image, 'Foto', m)
await sock.sendAudio(jid, audio, m, { ptt: true })

await sock.sendAlbum(jid, [
  { image: imageUrlOrBuffer },
  { video: videoPathOrBuffer }
], m)
```

Ketika `ptt: true`, helper audio memetakan input audio melalui ffmpeg untuk mengisi `waveform` dan durasi bila belum diberikan. `sendAlbum` menerima media image/video melalui URL, buffer, path lokal, atau object `{ image }`/`{ video }`, serta mengirim parent album dan child media dengan `messageAssociation.parentMessageKey`.

Untuk product, helper mendukung pesan product biasa, product dengan interactive buttons, dan product list:

```js
await sock.sendProduct(jid, {
  productImage: image,
  productId: 'catalog-product-id',
  businessOwnerJid: '628123456789@s.whatsapp.net',
  title: 'Produk'
}, m)

await sock.sendProductList(jid, [{
  title: 'Katalog',
  products: [{ productId: 'catalog-product-id' }]
}], m, {
  businessOwnerJid: '628123456789@s.whatsapp.net',
  title: 'Katalog produk'
})
```

---

## Revisi V2: payload native Baileys

Versi revisi kedua mengikuti source `elrayyxml/baileys-itsliaaa`. Waveform PTT dibuat menggunakan `audio-decode` dengan 64 sample dan skala 0..100, sedangkan durasi memakai `music-metadata`.

```js
await sock.sendAudio(jid, audio, null, quoted, {
  ptt: true,
  mimetype: 'audio/mp4'
})

await sock.sendMedia(jid, audio, null, quoted, {
  ptt: true,
  mimetype: 'audio/mp4'
})
```

Untuk album, bentuk upstream berikut didukung:

```js
await sock.sendAlbum(jid, [
  { media: 'https://example.com/video.mp4', caption: 'Video' },
  { media: 'https://example.com/image.jpg', caption: 'Image' }
], quoted)
```

Jika socket memiliki implementasi upstream `sendMessage` yang memproses `{ album }`, library akan memakai jalur tersebut agar child media direlay dan dihubungkan melalui `messageAssociation`. Pada socket stock tanpa dukungan album, fallback manual digunakan.

---

## License

MIT
