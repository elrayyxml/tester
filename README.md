# @nexray/lib

Lightweight Baileys helper — relay-based send helpers + Utils.

```bash
npm i @nexray/lib baileys
```

## Quick start

```js
const { makeWASocket } = require('baileys')
const { Client, Utils } = require('@nexray/lib')
// ESM: import { Client, Utils } from '@nexray/lib'

const sock = makeWASocket({ /* auth & config */ })

Client(sock, {
  messageIdPrefix: 'NEXRAY',
  autoFollowNewsletter: false, // or '123@newsletter' | string[]
  newsletterAnnotation: {
    newsletterJid: '1211111111111@newsletter',
    newsletterName: '@nexray',
    accessibilityText: '@nexray',
    contentType: 1
    // polygonVertices optional (default from messages.md)
  },
  bot: (id) =>
    (id.startsWith('3EB0') && id.length === 40) ||
    id.startsWith('BAE') ||
    /[-]/.test(id)
})
```

Quoted selalu **positional** `…, m)`. Media: **Buffer | path | url**.

---

## Send API (payload lengkap)

### Text / react / AI

```js
await sock.reply(m.chat, 'Test!', m)
await sock.sendText(m.chat, 'Hello', m, {
  mentions: [m.sender],
  expiration: 86400
})
await sock.sendReact(m.chat, '💀', m.key)
await sock.sendFromAI(m.chat, 'Hi from AI', m)
```

### Image / Video / Audio

```js
// image — auto annotations bila Client.newsletterAnnotation set
await sock.sendImage(m.chat, 'https://…/a.jpg', 'caption', m)
await sock.sendImage(m.chat, './a.jpg', 'caption', m)
await sock.sendImage(m.chat, buffer, 'caption', m, {
  newsletterAnnotation: { newsletterJid: '…@newsletter', newsletterName: '@x' }
})

await sock.sendVideo(m.chat, './v.mp4', 'caption', m, { gifPlayback: false })
await sock.sendPtv(m.chat, './note.mp4', m) // video note

await sock.sendAudio(m.chat, './a.mp3', m, { ptt: true })  // VN + waveform
await sock.sendAudio(m.chat, buffer, m, { ptt: false })
await sock.sendAudio(m.chat, 'https://…/a.ogg', m, { ptt: true })
```

### File (auto-route)

```js
await sock.sendFile(m.chat, 'https://…/a.jpg', 'image.jpg', 'Test!', m)
await sock.sendFile(m.chat, './a.mp3', '', '', m, { ptt: true })
await sock.sendFile(m.chat, './doc.pdf', 'doc.pdf', 'Caption', m, { document: true })
```

### Location / Sticker / Sticker pack

```js
await sock.sendLocation(m.chat, { lat: -6.2, lng: 106.8, name: 'Jakarta' }, m)
// or [lat, lng]
await sock.sendLocation(m.chat, [-6.2, 106.8], m)

await sock.sendSticker(m.chat, './s.webp', m)
await sock.sendSticker(m.chat, buffer, m)

await sock.sendStickerPack(m.chat, {
  name: 'My Pack',
  publisher: 'nexray',
  description: 'optional',
  cover: './cover.webp',
  stickers: [
    { data: webpBuffer, emojis: ['😀'] },
    { data: webpBuffer2, emojis: ['🔥'] }
  ]
}, m)
```

### Album (min. 2 media)

```js
await sock.sendAlbum(m.chat, [
  { image: 'https://…/a.jpg', caption: '1' },
  { image: './b.jpg', caption: '2' },
  { video: buffer, caption: 'vid' }
], m)
// tiap image/video item dapat newsletter annotations + association ke album.key
```

### Poll / Contact / Product

```js
await sock.sendPoll(m.chat, 'Like this?', {
  options: ['Yes', 'No'],
  multiselect: false
})

await sock.sendContact(m.chat, [{
  name: 'Owner',
  number: '62812xxxxxxx',
  about: 'Creator'
}], m, {
  org: 'Nexray',
  website: 'https://example.com',
  email: 'a@b.com'
})

await sock.sendProduct(m.chat, {
  title: 'Hoodie',
  description: 'Soft cotton',
  price: 150000,                 // → priceAmount1000
  currencyCode: 'IDR',
  productId: 'SKU-1',
  retailerId: 'nexray',
  url: 'https://shop.example.com/hoodie',
  productImage: 'https://…/img.jpg'  // Buffer | path | url
}, m)
```

### Interactive / buttons / carousel

```js
// Raw native-flow (messages.md style)
const buttons = [
  { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'OWNER', id: '.owner' }) },
  { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'API', url: 'https://api.example.com', merchant_url: 'https://api.example.com' }) },
  { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy', copy_code: '123456' }) },
  { name: 'cta_call', buttonParamsJson: JSON.stringify({ display_text: 'Call', phone_number: '62812…' }) },
  { name: 'cta_reminder', buttonParamsJson: JSON.stringify({ display_text: 'Remind', id: 'r1' }) },
  { name: 'cta_cancel_reminder', buttonParamsJson: JSON.stringify({ display_text: 'Cancel', id: 'c1' }) },
  { name: 'address_message', buttonParamsJson: JSON.stringify({ display_text: 'Address', id: 'a1' }) },
  { name: 'send_location', buttonParamsJson: JSON.stringify({}) },
  { name: 'single_select', buttonParamsJson: JSON.stringify({
      title: 'Tap!',
      sections: [{ rows: [
        { title: 'Owner', description: '—', id: '.owner' },
        { title: 'Runtime', description: '—', id: '.run' }
      ]}]
  })}
]

await sock.sendIAMessage(m.chat, buttons, m, {
  header: '',
  content: 'Hi!',
  footer: '© nexray',
  media: 'https://…/cover.jpg'   // image/video header
})

// Shorthand buttons
await sock.sendInteractive(m.chat, [
  { text: 'OWNER', id: '.owner' },
  { text: 'Web', url: 'https://example.com' },
  { text: 'Copy', copy: 'KODE' },
  { text: 'Call', phone: '62812…' },
  { location: true }
], m, { content: 'Hi!', footer: 'foot' })

// Carousel
await sock.sendCarousel(m.chat, [
  {
    header: { imageMessage: 'https://…/1.jpg', hasMediaAttachment: true },
    body: { text: 'Card 1' },
    nativeFlowMessage: {
      buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Go', url: 'https://x.com' }) }]
    }
  },
  {
    header: { imageMessage: 'https://…/2.jpg', hasMediaAttachment: true },
    body: { text: 'Card 2' },
    nativeFlowMessage: { buttons: [] }
  }
], m, { content: 'Hi!' })
```

### Meta / AIRich

```js
await sock.sendMetaMsg(m.chat, [
  { text: 'Hello' },
  { code: { language: 'javascript', code: 'console.log(1)' } },
  { table: { title: 'Data', headers: ['A', 'B'], rows: [['1', '2']] } },
  { muted: 'Muted line' },
  { suggestions: ['A', 'B', 'C'] },
  { sources: [{ title: 'Github', url: 'https://github.com', icon: 'https://…' }] }
], m, { title: 'Nexray' })
// alias: sock.sendAIRich(...)
```

### Forward

```js
await sock.copyNForward(m.chat, m)
await sock.copyNForward(m.chat, m, true) // forceForward
```

---

## Media annotation (image & video)

Otomatis jika `Client(..., { newsletterAnnotation })` atau opsi per-call.

```js
annotations: [{
  polygonVertices: [ /* default messages.md */ ],
  newsletter: {
    newsletterJid, newsletterName, contentType, accessibilityText
  }
}]
```

Berlaku di: `sendImage`, `sendVideo`, item media **`sendAlbum`**, dan header media interactive bila memakai image/video.

---

## Utils

```js
Utils.extend({
  formatRupiah(n) {
    return 'Rp' + Number(n).toLocaleString('id-ID')
  }
})
Utils.formatRupiah(50000)
Utils.getDevice(id)
Utils.sleep(1000)
Utils.getAudioWaveform(buffer)
```

## Exports

Hanya **`Client`** dan **`Utils`** (CJS + ESM).

## License

ISC
