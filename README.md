# @nexray/lib

Lightweight Baileys helper — **serialize** + **relay-based** send helpers.

Thin wrapper over an existing `makeWASocket(...)` instance. No custom auth/session management.

## Install

```bash
npm i @nexray/lib
# peer
npm i baileys
```

## Quick start

```js
const { makeWASocket } = require('baileys')
const { Client, Utils } = require('@nexray/lib')

const sock = makeWASocket({ /* your auth & config */ })

Client(sock, {
  messageIdPrefix: 'NEXRAY',
  autoFollowNewsletter: false, // or '123@newsletter' | string[]
  newsletterAnnotation: false, // or { newsletterJid, newsletterName, contentType }
  bot: (id) =>
    (id.startsWith('3EB0') && id.length === 40) ||
    id.startsWith('BAE') ||
    /[-]/.test(id)
})
// baileys di-require otomatis dari peerDependency — tidak perlu Client(sock, { baileys })

sock.ev.on('messages.upsert', async ({ messages }) => {
  // handle messages with your own logic
})
```

## Send helpers (neoxr-style)

All media accept **Buffer | path | url**. Quoted is **positional** (`…, m)`).

```js
await sock.reply(m.chat, 'Test!', m)
await sock.sendReact(m.chat, '💀', m.key)

await sock.sendText(m.chat, 'Hello', m)
await sock.sendImage(m.chat, './a.jpg', 'caption', m)
await sock.sendVideo(m.chat, url, 'caption', m)
await sock.sendAudio(m.chat, './a.mp3', m, { ptt: true }) // waveform via audio-decode
await sock.sendFile(m.chat, url, 'image.jpg', 'Test!', m)
await sock.sendFile(m.chat, './a.mp3', '', '', m, { ptt: true })
await sock.sendDocument(m.chat, './f.pdf', 'f.pdf', 'doc', m)
await sock.sendLocation(m.chat, { lat: -6.2, lng: 106.8 }, m)
await sock.sendSticker(m.chat, './s.webp', m)
await sock.sendStickerPack(m.chat, {
  name: 'My Pack',
  publisher: 'nexray',
  cover: './cover.webp',
  stickers: [{ data: webpBuffer, emojis: ['😀'] }]
}, m)
await sock.sendPtv(m.chat, './v.mp4', m)

await sock.sendAlbum(m.chat, [
  { image: 'https://a.jpg', caption: '1' },
  { image: buffer },
  { video: './v.mp4' }
], m)

await sock.sendPoll(m.chat, 'Like this?', {
  options: ['Yes', 'No'],
  multiselect: false
})

await sock.sendProduct(m.chat, {
  title: 'Hoodie',
  description: 'Soft cotton',
  price: 150000,
  currencyCode: 'IDR',
  productImage: 'https://…/img.jpg',
  url: 'https://shop.example.com'
}, m)

await sock.sendContact(m.chat, [{
  name: 'Owner',
  number: '62812…',
  about: 'Creator'
}], m, { org: 'Nexray' })

// Interactive (native flow)
const buttons = [{
  name: 'quick_reply',
  buttonParamsJson: JSON.stringify({ display_text: 'OWNER', id: '.owner' })
}, {
  name: 'cta_url',
  buttonParamsJson: JSON.stringify({
    display_text: 'API',
    url: 'https://example.com',
    merchant_url: 'https://example.com'
  })
}]
await sock.sendIAMessage(m.chat, buttons, m, {
  content: 'Hi!',
  footer: '© nexray',
  media: coverUrl
})

await sock.sendCarousel(m.chat, cards, m, { content: 'Hi!' })
await sock.copyNForward(m.chat, m)
await sock.sendFromAI(m.chat, 'Hi from AI', m)

// Meta / AIRich (neoxr sendMetaMsg payload)
await sock.sendMetaMsg(m.chat, [
  { text: 'Hello' },
  { code: { language: 'javascript', code: 'console.log(1)' } },
  { table: { title: 'Data', headers: ['A', 'B'], rows: [['1', '2']] } },
  { sources: [{ title: 'Github', url: 'https://github.com', icon: 'https://…' }] }
], m, { title: 'Nexray' })
```

Shorthand buttons also work: `{ text, id }`, `{ text, url }`, `{ text, copy }`, `{ text, phone }`.

## Utils singleton

```js
const { Utils } = require('@nexray/lib')

Utils.extend({
  formatRupiah(n) {
    return 'Rp' + Number(n).toLocaleString('id-ID')
  }
})

Utils.formatRupiah(50000) // Rp50.000
```

## Exports

- `Client(sock, options)` — mutate socket, return same sock
- `Utils` — shared helpers + `extend()`

## Notes

- Sending uses `generateWAMessage` / `generateWAMessageFromContent` + **`relayMessage`** (not only `sendMessage`).
- Newsletter annotation applies to **image/video** when `newsletterAnnotation` is set on Client or per-call.
- `autoFollowNewsletter` is opt-in only (no hidden follow).
- No auth/session manager — you own `makeWASocket`.

## License

ISC
