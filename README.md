# @elrayyxml/wb

`@elrayyxml/wb` adalah helper library ringan untuk **Baileys resmi**. Library ini tidak membuat socket, tidak mengelola kredensial, dan tidak menggantikan `makeWASocket`. Anda membuat socket Baileys sendiri, kemudian `Client(sock, options)` atau `Extend(sock, options)` menempelkan helper pengiriman pesan ke socket tersebut.

> Semua jalur pengiriman helper menggunakan `sock.relayMessage()`. Baileys tetap menjadi peer dependency dan tidak dibundel ke dalam package ini.

## Instalasi

```bash
npm install @elrayyxml/wb baileys
```

`audio-decode` digunakan sebagai dependency untuk membaca metadata audio pada pengiriman `ptt: true`. Library ini bersifat best-effort: apabila format audio tidak dapat didekode, pesan tetap diproses oleh Baileys.

## Contoh end-to-end

```js
const { makeWASocket, useMultiFileAuthState } = require('baileys')
const { Client } = require('@elrayyxml/wb')

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({ auth: state })

  sock.ev.on('creds.update', saveCreds)

  Client(sock, {
    messageIdPrefix: 'ELRAYYXML',
    onMessage: async m => {
      if (m.body === '.ping') await m.reply('Pong!')
    }
  })

  sock.ev.on('connection.update', update => {
    if (update.connection === 'open') console.log('Connected')
  })
}

main().catch(console.error)
```

`Client` mengembalikan object socket yang sama. Jika hanya memerlukan helper pengiriman tanpa listener `messages.upsert`, gunakan `await Extend(sock, options)`.

## API pengiriman

| Method | Kegunaan |
|---|---|
| `sendText(jid, text, quoted?, options?)` | Teks, mention, dan link preview best-effort. |
| `sendAdText(jid, text, quoted?, options?)` | Teks dengan `externalAdReply`. |
| `sendMedia(jid, input, caption?, quoted?, options?)` | Buffer, URL, path, atau stream; mendeteksi MIME otomatis. |
| `sendPtv(jid, input, quoted?, options?)` | Video berbentuk PTV. |
| `sendSticker(jid, input, quoted?, options?)` | Sticker dari media. |
| `sendInteractive(jid, buttons, quoted?, options?)` | Quick reply, URL, call, copy, list, native flow, dan `interactiveButtons`. |
| `sendCarousel(jid, cards, quoted?, options?)` | Entry point carousel yang menggunakan interactive message. |
| `sendPoll(jid, values, quoted?, options?)` | Poll biasa. |
| `sendQuiz(jid, values, quoted?, options?)` | Quiz newsletter; memerlukan `correctAnswer`. |
| `sendContact`, `sendLocation`, `sendAlbum` | Helper pesan umum. |
| `sendLegacyButton`, `sendLegacyList` | Format tombol/list lama; legacy list hanya private chat. |
| `sendReact(jid, emoji, key)` | Reaction terhadap message key. |

## Interactive message

Satu fungsi `sendInteractive` digunakan sebagai entry point untuk beberapa bentuk interaktif. Bentuk tombol yang didukung oleh builder bawaan meliputi `quick_reply`, `url`, `call`, `copy`, dan `list`.

```js
await sock.sendInteractive(
  jid,
  [
    { type: 'quick_reply', id: 'yes', text: 'Ya' },
    { type: 'url', text: 'Dokumentasi', url: 'https://example.com' },
    { type: 'call', text: 'Hubungi', phoneNumber: '+628123456789' },
    { type: 'copy', text: 'Salin kode', code: 'ELRAYYXML' }
  ],
  quoted,
  {
    body: 'Pilih tindakan',
    footer: 'Powered by @elrayyxml/wb',
    interactiveButtons: [
      { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Custom', id: 'custom' }) }
    ]
  }
)
```

Untuk format native flow mentah, pass `nativeFlowMessage` atau `interactiveButtons` melalui options. Untuk list, pass `sections` pada options; library akan membuat native-flow `single_select`.

## Media dan PTT

```js
await sock.sendMedia(jid, './voice.ogg', '', quoted, {
  ptt: true,
  mime: 'audio/ogg; codecs=opus'
})

await sock.sendMedia(jid, imageBuffer, 'Caption', quoted, {
  mentions: ['628123456789@s.whatsapp.net']
})
```

`sendMedia` tidak memerlukan `@neoxr/*`. Helper menggunakan `mime-types` dan deteksi magic bytes sederhana. Resizing thumbnail tidak dipaksakan; konsumen dapat menambahkan helper sendiri menggunakan `Utils.extend`.

## Utils singleton

```js
const { Utils } = require('@elrayyxml/wb')

Utils.extend({
  formatRupiah(value) {
    return `Rp${Number(value).toLocaleString('id-ID')}`
  }
})

console.log(Utils.formatRupiah(50000))
```

Registry ini bersifat module-level singleton. Method bawaan tidak dapat dioverride secara diam-diam; percobaan override menghasilkan warning Node.js.

## Newsletter

`autoFollowNewsletter` default-nya `false`. Follow hanya dijalankan apabila JID diberikan secara eksplisit oleh pengguna.

Pada JID yang berakhiran `@newsletter`, helper akan memakai encoder newsletter publik dari Baileys apabila socket mengekspos `sendNode`. Jalur ini meniru patch fork yang relevan: pesan dipatch sebelum encoding, `mediatype` ditambahkan pada node plaintext, dan `additionalNodes` dapat diteruskan secara eksplisit. Jika `sendNode` atau encoder tidak tersedia, library kembali ke `sock.relayMessage()` dan menyerahkan encoding kepada Baileys.

```js
Client(sock, {
  patchMessageBeforeSending: async (message, recipients) => {
    // Kembalikan satu WebMessage/proto Message; jangan kembalikan array untuk newsletter.
    return message
  }
})

await sock.sendMedia('1234567890@newsletter', imageBuffer, 'Foto baru', undefined, {
  additionalAttributes: { custom_flag: '1' },
  additionalNodes: [{ tag: 'meta', attrs: { source: 'bot' } }]
})
```

```js
Client(sock, {
  autoFollowNewsletter: ['1234567890@newsletter'],
  newsletterAnnotation: {
    newsletterJid: '1234567890@newsletter',
    newsletterName: 'Channel saya',
    contentType: 1
  }
})
```

Tidak ada JID newsletter, timer, endpoint, atau network call tersembunyi yang ditanam di library.

## Catatan kompatibilitas

ZIP `@itsliaaa/baileys` yang dijadikan referensi berisi perubahan internal Baileys, khususnya pada relay newsletter dan beberapa bentuk interactive message. Porting pada package ini mencakup encoder newsletter publik, `patchMessageBeforeSending` sebelum relay, `mediatype` pada node plaintext, `additionalAttributes`, `additionalNodes`, pemilihan tipe stanza, dan fallback ke `relayMessage` ketika `sendNode` atau encoder tidak tersedia.

Package ini tetap tidak menyalin mekanisme internal enkripsi Signal, device fan-out, sender-key group, media retry, atau closure socket dari fork. Bagian tersebut tetap menjadi tanggung jawab Baileys resmi. Dengan demikian, kompatibilitas fitur newsletter bergantung pada versi Baileys yang dipasang; implementasi telah diuji terhadap `baileys@7.0.0-rc14` dan menggunakan export publik yang tersedia pada versi tersebut.
