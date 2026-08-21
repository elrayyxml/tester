# @nexray/lib

Simplicity WhatsApp Baileys Engine & Helper Library.

`@nexray/lib` is a clean, modular, engine-injected message helper layer on top of
Baileys. It wraps an existing Baileys socket, injects a centralized
`relayMessage` pipeline, and exposes a consistent set of message helpers.

- ESM primary, CommonJS secondary (single entry, `require(esm)`, Node >= 20.19 / >= 22.12)
- No bundled Baileys — you provide the engine
- Every helper routes through one transport pipeline
- Centralized message ID, context info, newsletter annotation, and error handling

---

## Table of Contents

- [Installation](#installation)
- [Requirements](#requirements)
- [Initialization](#initialization)
- [Configuration](#configuration)
- [Engine Architecture](#engine-architecture)
- [Message Helpers](#message-helpers)
- [Newsletter](#newsletter)
- [Utils](#utils)
- [Error Handling](#error-handling)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

---

## Installation

```bash
npm install @nexray/lib
```

```bash
npm install @nexray/lib @whiskeysockets/baileys
```

## Requirements

- Node.js `>= 20.19` (or `>= 22.12` for the CommonJS entry)
- A Baileys socket (or compatible engine) provided at runtime

## Initialization

ESM:

```js
import { Client, Utils } from '@nexray/lib'
import makeWASocket from '@whiskeysockets/baileys'

const sock = Client(makeWASocket({ ... }), {
    engines: [Baileys],
    custom_id: 'mybot',
    stealth: 'ios',
    debug: true
})

await sock.sendText('6281234567890@s.whatsapp.net', 'halo dunia')
```

CommonJS:

```js
const { Client, Utils } = require('@nexray/lib')
```

## Configuration

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `engines` | `Array` | Yes | Engines used by the library. The first entry is the primary engine. |
| `bot` | `Function \| boolean \| null` | No | Detector for bot-generated message IDs. |
| `custom_id` | `string \| null` | No | Custom prefix injected into the hex message ID (whatsmeow-style). |
| `stealth` | `string \| null` | No | Message ID device format: `ios`, `android`, `web`, `desktop`. |
| `newsletterAnnotation` | `object \| null` | No | Default newsletter media annotation. |
| `newsletterFollow` | `string \| string[] \| null` | No | Newsletter JIDs to follow on init. |
| `debug` | `boolean` | No | Enable internal debug logging. |

### Bot ID detection

```js
bot: (id) => {
    return (
        (id.startsWith('3EB0') && id.length === 22) ||
        id.startsWith('BAE') ||
        /[-]/.test(id)
    )
}
```

Behavior: `null` disables detection, a function is called with the message ID,
`true` treats every ID as bot-generated, `false` treats none as bot-generated.
Detection is safe against `undefined`, `null`, non-string IDs, and malformed keys.

### Stealth message IDs

`stealth` shapes the generated message ID to look like a specific device:

- `ios` → `3A` + 18 random chars
- `web` → `3E` + 20 random chars
- `android` → 32 random chars
- `desktop` → `3F` + 18 random chars

Message ID priority: explicit `options.messageId` → `custom_id` prefix →
stealth format → default `3EB0` + 18 hex.

### Custom message IDs

`custom_id` (e.g. `Client(sock, { custom_id: 'STARFALL' })`) injects the
prefix (uppercased) into a whatsmeow-style hex ID at a pseudo-random
position derived from the ID hash — the same scheme as the fork's
`generateMessageIDV2` (`'3EB0' + hex` with the prefix spliced in, e.g.
`3EB0F1A2STARFALL9C4B7E8D5A6`):

## Engine Architecture

The engine must expose the Baileys message/media API. The library never imports
Baileys itself — the socket is the transport and the engine provides the
protocol builders:

- `generateWAMessage`
- `generateWAMessageFromContent`
- `prepareWAMessageMedia`
- `proto`
- `getDevice`, `getStream`, `toBuffer`, `getAudioWaveform`, `generateThumbnail`

All message helpers generate their payload first, then route it through the
centralized pipeline:

```
sendText()
   ↓
Message Builder
   ↓
WAMessage Payload
   ↓
Message Normalizer
   ↓
relayMessage()
   ↓
Baileys Socket
```

`relayMessage()` centralizes message ID generation, additional nodes,
additional attributes, newsletter annotation, and recipient configuration.
Engine-dependent options such as `recipientOverrides` and `specificRecipient`
are passed through when present.

## Message Helpers

Every helper is attached to the socket: `sock.sendText(...)`, and is also
exported as a standalone function taking the socket as the first argument.

### sendText

```js
await sock.sendText(remoteJid, text, quoted?, options?)
```

Payload:

```js
await sock.sendText('6281234567890@s.whatsapp.net', 'halo dunia', quotedMsg, {
    ai: false,                       // label as AI generated (private chats only)
    mentionAll: false,               // set contextInfo.nonJidMentions = 1
    mentions: ['62811111111@s.whatsapp.net'],
    mentionedJid: ['62811111111@s.whatsapp.net'], // alias of mentions
    contextInfo: { forwardingScore: 1 },
    expiration: 86400,               // ephemeral seconds
    linkPreview: true,
    messageId: 'custom-id',
    additionalNodes: NODES.poll_creation,
    additionalAttributes: { epoch: '1' }
})
```

Mentions accept both `mentions: []` and `mentionedJid: []` (aliases).
`mentionAll: true` sets `contextInfo.nonJidMentions = 1` (mention-all without a
JID list) instead of resolving group participants (legacy `mentionsAll` alias
still works). Combine with `mentions` to mention specific JIDs alongside the
mention-all flag.

### reply

```js
await sock.reply(remoteJid, text, quoted, options?)
```

Shortcut for quoting — requires a `quoted` message:

```js
await sock.reply('6281234567890@s.whatsapp.net', 'balasan', incomingMsg)
```

### sendReact

```js
await sock.sendReact(remoteJid, emoji, key, options?)
```

Payload:

```js
await sock.sendReact(remoteJid, emoji, key, options?)
```

`key` menerima `m.key`, pesan utuh (`m`), atau string message ID:

```js
// format: (jid, emoji, m.key, options?)
await sock.sendReact('6281234567890@s.whatsapp.net', '👍', {
    id: '3EB0ABC...',                        // the message key to react to
    remoteJid: '6281234567890@s.whatsapp.net',
    fromMe: false
}, { additionalNodes: [...] })

// pesan utuh juga jalan (key diambil dari .key)
await sock.sendReact('6281234567890@s.whatsapp.net', '👍', m, options?)

// atau cukup string ID
await sock.sendReact('6281234567890@s.whatsapp.net', '👍', '3EB0ABC...')
```

### sendImage / sendVideo

```js
await sock.sendImage(remoteJid, image, caption?, quoted?, options?)
await sock.sendVideo(remoteJid, video, caption?, quoted?, options?)
```

Payload:

```js
await sock.sendImage('6281234567890@s.whatsapp.net', Buffer.from(...), 'caption', quotedMsg, {
    mentions: ['62811111111@s.whatsapp.net'],
    mentionsAll: true,
    expiration: 86400
})
await sock.sendVideo('6281234567890@s.whatsapp.net', './video.mp4', 'caption', null, {
    ptv: true,       // video note
    gif: true        // animated GIF
})
```

Media input: `Buffer`, local path, or URL.

### sendAudio

```js
await sock.sendAudio(remoteJid, audio, quoted?, options?)
```

Payload:

```js
await sock.sendAudio('6281234567890@s.whatsapp.net', './voice.ogg', null, {
    ptt: true,                  // voice note — waveform via engine.getAudioWaveform
    mimetype: 'audio/ogg; codecs=opus'
})
```

### sendFile

```js
await sock.sendFile(remoteJid, file, quoted?, options?)
```

Payload:

```js
await sock.sendFile('6281234567890@s.whatsapp.net', './report.pdf', null, {
    fileName: 'laporan.pdf',
    mimetype: 'application/pdf',
    caption: 'Laporan bulanan'
})
```

### sendSticker

```js
await sock.sendSticker(remoteJid, sticker, quoted?, options?)
```

Payload:

```js
await sock.sendSticker('6281234567890@s.whatsapp.net', './sticker.png', quotedMsg, {
    packname: 'Nexray Pack',
    author: '@nexray',
    categories: ['😀', '🔥'],

    // flag StickerMessage (semua opsional)
    isAnimated: false,
    stickerSentTs: Date.now(),
    isAvatar: false,
    isAiSticker: false,
    isLottie: false,
    premium: 1,
    // extraFields: { ... }   // field StickerMessage lain apa pun
})
```

Non-WebP input is converted automatically. EXIF metadata is **always**
embedded (`sticker-pack-name`, `sticker-pack-publisher`, `emojis`, and the
`premium` / `is-avatar-sticker` / `is-ai-sticker` / `is-lottie-sticker`
flags). When `premium`/`isAvatar`/`isAiSticker` is set, the message also
carries `messageContextInfo.limitSharingV2`.

### sendStickerPack

```js
await sock.sendStickerPack(remoteJid, payload, quoted?)
```

Payload — pack fields + stickers array (each sticker: buffer/path/url or
`{ sticker, emojis, accessibilityLabel }`):

```js
await sock.sendStickerPack('6281234567890@s.whatsapp.net', {
    name: 'My Pack',
    publisher: '@nexray',
    description: 'Sticker pack description',
    emojis: ['😀'],
    cover: './cover.png',                       // required buffer/path/url
    stickers: [
        { sticker: './s1.png', emojis: ['😀'], accessibilityLabel: 'satu' },
        { sticker: 'https://example.com/s2.webp' },
        './s3.png'                              // shorthand — just media
    ]
}, quotedMsg)
```

Max 60 stickers; each sticker under 1MB; converted to WebP automatically.

### sendAlbum

```js
await sock.sendAlbum(remoteJid, items, quoted?, options?)
```

Payload — array of `{ image }` / `{ video }` items (min 1), all relayed in
parallel under one album bubble:

```js
await sock.sendAlbum('6281234567890@s.whatsapp.net', [
    { image: './photo1.jpg', caption: 'first' },
    { video: './clip.mp4' },
    { image: Buffer.from(...) }
], quotedMsg, {
    messageId: 'album-root-id'
})
```

### sendInteractive

```js
await sock.sendInteractive(remoteJid, payload, quoted?, options?)
await sock.sendInteractive(remoteJid, buttons, quoted?, options?) // shortcuts
```

Payload — quoted message lewat parameter ke-3 (setelah `remoteJid`), tombol
pakai **`interactiveButtons`**:

```js
await sock.sendInteractive('6281234567890@s.whatsapp.net', {
    text: 'Pilih opsi di bawah',           // body text
    footer: 'Nexray Interactive',
    title: 'Interactive Header',           // header title (no media)
    mentions: ['62811111111@s.whatsapp.net'],
    contextInfo: { forwardingScore: 1 },
    interactiveButtons: [                  // native flow buttons (bukan `buttons`)
        {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: 'Option A', id: 'a' })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: 'Visit site',
                url: 'https://example.com',
                merchant_url: 'https://example.com'
            })
        }
    ],
    messageParamsJson: { action: 'choose' } // or a JSON string
}, quotedMsg)
```

Header media — `image`, `video`, atau `location` (thumbnail otomatis di-resize 300x300):

```js
// image header
await sock.sendInteractive('6281234567890@s.whatsapp.net', {
    text: 'Image header',
    footer: 'Nexray',
    image: './database/assets/allmenu.jpg',  // atau video: './clip.mp4'
    interactiveButtons: [
        {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: 'Continue', id: 'continue' })
        }
    ]
}, message)   // quoted di akhir — tidak di tengah payload

// location header
await sock.sendInteractive('6281234567890@s.whatsapp.net', {
    text: 'Lokasi toko kami',
    location: {
        degreesLatitude: -6.2,
        degreesLongitude: 106.8,
        name: 'Jakarta',
        jpegThumbnail: './thumb.jpg'        // opsional, di-resize 300x300
    },
    interactiveButtons: [
        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Rute', id: 'route' }) }
    ]
})
```

`interactiveButtons` sudah menjadi internal `nativeFlowMessage.buttons` —
tidak perlu field `nativeFlow` terpisah.

Commerce surfaces:

```js
await sock.sendInteractive('6281234567890@s.whatsapp.net', {
    text: 'Katalog kami',
    interactiveButtons: [{ name: 'quick_reply', buttonParamsJson: '{}' }],
    bizJid: '6281234567890@s.whatsapp.net'  // or shopSurface: 'SHOP'
})
```

Passing buttons directly (shortcut form):

```js
await sock.sendInteractive('6281234567890@s.whatsapp.net', [
    { text: 'Option A', id: 'a' },
    { text: 'Option B', id: 'b' }
], quotedMsg, { footer: 'footer text' })
```

### sendContact

```js
await sock.sendContact(remoteJid, contact | contact[], quoted?, options?)
```

Payload — satu kontak, array kontak (digabung jadi satu vcard), atau raw vcard
string; quoted lewat parameter ke-3:

```js
// array kontak — quoted di parameter ke-3
await sock.sendContact('6281234567890@s.whatsapp.net', [
    {
        name: 'Lia Wynn',
        org: '🛎️ Waitress',
        email: 'my-email@gmail.com',
        website: '',
        location: 'Jakarta',
        other: '❤️ Simplified WhatsApp API',
        number: '6281111111111'
    },
    {
        name: '❤️ My Big Brother',
        org: '👥 Siblings',
        email: 'his-email@gmail.com',
        website: '...',
        location: 'Jakarta',
        other: '❤️ Simplified WhatsApp API',
        number: '6281111111111'
    }
], message)

// kontak tunggal (classic fields juga didukung)
await sock.sendContact('6281234567890@s.whatsapp.net', {
    name: 'Elrayy',
    organization: '@nexray',
    title: 'Developer',
    phones: [{ type: 'WORK', number: '6281234567890' }],
    email: 'elrayy@example.com',
    url: 'https://example.com'
})

// kontak bisnis — title/description shorthand → X-WA-BIZ-NAME / X-WA-BIZ-DESCRIPTION
await sock.sendContact('6281234567890@s.whatsapp.net', {
    name: config.owner_name,
    org: config.bot_name,
    title: config.owner_name,
    description: 'A beginner who has skill issues',
    number,
    email: config.owner_email,
    website: config.owner_website,
    location: config.region,
    other: `Owner ${config.bot_name}`
    // bizName/bizDescription also still work as aliases
})

// raw vcard string
const vcard = `BEGIN:VCARD
VERSION:3.0
N:Owner;;;; 
FN:Owner
ORG:${config.bot_name}
TITLE:${config.bot_name}
TEL;TYPE=WORK;waid=${number}:${number}
EMAIL;type=INTERNET:${config.owner_email}
URL:${config.owner_website}
ADR;TYPE=WORK:;;${config.region};;;
NOTE:Owner ${config.bot_name}
X-WA-BIZ-NAME:${config.owner_name}
X-WA-BIZ-DESCRIPTION:some description
END:VCARD`
await sock.sendContact('6281234567890@s.whatsapp.net', vcard, message)
```

### sendProduct

```js
await sock.sendProduct(remoteJid, product, quoted?, options?)
```

Payload — full `productMessage` (`image` accepts Buffer, URL, path, or an
already-prepared imageMessage; `interactiveButtons` supports any native
flow button; `price` in rupiah is converted to `priceAmount1000`):

```js
await sock.sendProduct('6281234567890@s.whatsapp.net', {
    // media — Buffer, URL, atau path
    image: './product.jpg',
    title: '© Nexray Bot v1.0.0',
    productId: 'product-001',
    currencyCode: 'IDR',
    price: 150000,                  // rupiah → priceAmount1000 (150000000)
    // priceAmount1000: 150000,     // atau langsung dalam 1000ths (prioritas)
    productImageCount: 1,
    // firstImageUrl: 'https://files.catbox.moe/hykp52.jpg',
    // salePriceAmount1000: 100000,
    // retailerId: 'retailer-001',

    // wajib — JID pemilik bisnis
    businessOwnerJid: '6281234567890@s.whatsapp.net',

    // teks
    caption: 'Belanja sekarang!',
    footer: 'Nexray Store',

    // native flow buttons — support penuh
    interactiveButtons: [
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: 'Download Now',
                url: 'https://autoresbot.com/download'
            })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: 'Developer Channel',
                url: 'https://whatsapp.com/channel/0029VaDSRuf05MUekJbazP1D'
            })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: 'My Channel',
                url: 'https://whatsapp.com/channel/0000000000000000000000'
            })
        },
        {
            name: 'automated_greeting_message_view_catalog',
            buttonParamsJson: JSON.stringify({
                business_phone_number: '6281234567890',
                catalog_product_id: 'product-001'
            })
        }
    ],

    hasMediaAttachment: true
}, quotedMsg)
```

### sendLivePhoto

```js
await sock.sendLivePhoto(remoteJid, { video, image? }, quoted?, options?)
// legacy: await sock.sendLivePhoto(remoteJid, image, video, quoted?, options?)
```

Payload — the image message is relayed first (`pairedMediaType: 5`), then
the video message follows with `pairedMediaType: 6` and a
`messageAssociation` (type 12) pointing at the image message key. The image
is optional — it falls back to the video thumbnail:

```js
await sock.sendLivePhoto('6281234567890@s.whatsapp.net', {
    video: './live.mov',
    image: './photo.jpg'        // optional — falls back to video thumbnail
}, quotedMsg, {
    caption: 'Live photo'
})
```

### sendThumbnailPreview

```js
await sock.sendThumbnailPreview(remoteJid, text, opts?, message?)
```

Payload — text + link preview; `message` (optional) is the quoted message:

```js
// preview kecil (default) — thumbnail opsional
await sock.sendThumbnailPreview('6281234567890@s.whatsapp.net', 'Cek link ini!', {
    title: 'Nexray',
    body: 'Deskripsi preview',
    url: 'https://example.com',
    thumbnail: './thumb.jpg'            // opsional — jadi jpegThumbnail
}, quotedMsg)

// preview besar — thumbnail wajib
await sock.sendThumbnailPreview('6281234567890@s.whatsapp.net', 'Video baruku!', {
    title: 'Reels Nexray',
    body: 'Lihat video terbaru',
    url: 'https://example.com/reels',
    largeThumb: true,
    ratio: 'landscape',                 // 'landscape' | 'portrait' | 'square'
    thumbnail: './thumb.jpg',           // wajib untuk largeThumb: true
    icon: './favicon.png',              // opsional — favicon
    duration: 30,                       // linkMediaDuration (detik, untuk video/audio)
    postType: 1                         // 0=NONE, 1=REEL, 2=LIVE_VIDEO, 3=LONG_VIDEO, 4=SINGLE_IMAGE, 5=CAROUSEL
}, quotedMsg)
```

### sendCard

```js
await sock.sendCard(remoteJid, payload, quoted?, options?)
```

Payload — carousel cards with `image` **or** `video` per card (media is
required per card). Each card is built as `nativeFlowMessage` +
`header` + `body`:

```js
await sock.sendCard('6281234567890@s.whatsapp.net', {
    text: 'Pilih produk:',
    footer: 'Nexray Store',
    cards: [
        {
            title: 'Produk A',
            subtitle: 'Rp 10.000',
            image: './product-a.jpg',        // or video: './product-a.mp4'
            caption: 'Deskripsi singkat',    // body text per card
            footer: 'Footer A',              // optional
            buttons: [
                { name: 'quick_reply', buttonParamsJson: { display_text: 'Beli', id: 'buy-a' } }
            ]
        },
        {
            title: 'Produk B',
            subtitle: 'Rp 20.000',
            image: './product-b.jpg',
            buttons: [
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Beli', id: 'buy-b' }) }
            ]
        }
    ]
}, quotedMsg)
```

`buttonParamsJson` accepts an object (JSON-stringified automatically) or a
string. Produces `interactiveMessage.carouselMessage` with
`carouselCardType: 0` and `messageVersion: 1`.

### sendPoll / sendQuiz

```js
// form baru
await sock.sendPoll(remoteJid, values, quoted?, options?)
await sock.sendQuiz(remoteJid, values, quoted?, options?)      // newsletter JID only
// legacy
await sock.sendPoll(remoteJid, name, values, options?, quotedOrOptions?)
await sock.sendQuiz(remoteJid, name, values, correctOption, quoted?, options?)
```

Payload — `selectableCount: 1` sends `pollCreationMessageV3`,
`toAnnouncementGroup` sends `pollCreationMessageV2`, otherwise
`pollCreationMessage`; quizzes send `pollCreationMessageV5` with
`pollType: 1` + `correctAnswer`:

```js
await sock.sendPoll('6281234567890@s.whatsapp.net', ['✨ Yes', '💀 No'], quotedMsg, {
    name: '🔥 Is it good?',
    selectableCount: 1,
    endDate: new Date(Date.now() + 86400000),
    hideVoter: false,
    canAddOption: false,
    toAnnouncementGroup: false
})

// quiz — newsletter JID wajib
await sock.sendQuiz('1211111111111@newsletter', ['✨ Yes', '💀 No'], quotedMsg, {
    name: '🔥 Quiz!',
    correctAnswer: '✨ Yes'
})
```

Legacy `correctOption` is 1-based (index of the correct answer in `values`).

### sendPollResult

```js
await sock.sendPollResult(remoteJid, name, values, key, quoted?, options?)
```

Payload:

```js
await sock.sendPollResult('6281234567890@s.whatsapp.net', 'Framework favorit?', ['Nexray', 'Lainnya'], pollMsg.key)
```

### sendGroupStatus

```js
await sock.sendGroupStatus(jid, text, options?)
```

Payload:

```js
await sock.sendGroupStatus('group@g.us', 'Pengumuman penting!', {
    color: '#0EABF4',        // background
    textColor: '#FFFFFF',
    font: 0,
    fontSize: 'small',
    closeFriends: false
})
```

### sendStatusMentions

```js
await sock.sendStatusMentions(text, jidList, options?)
```

Payload:

```js
await sock.sendStatusMentions('Mention status', ['62811111111@s.whatsapp.net', '62822222222@s.whatsapp.net'], {
    jid: 'status@broadcast'
})
```

### sendEvent

```js
await sock.sendEvent(remoteJid, event, quoted?, options?)
```

Payload:

```js
await sock.sendEvent('6281234567890@s.whatsapp.net', {
    name: 'Community Meetup',
    description: 'Monthly sync',
    startDate: new Date(Date.now() + 86400000),   // or startTime
    endDate: new Date(Date.now() + 90000000),     // or endTime (optional)
    location: {
        degreesLatitude: -6.2,
        degreesLongitude: 106.8,
        name: 'Jakarta'
    },
    call: { isVideo: false },   // resolved via the engine's getCallLink → joinLink
    isCancelled: false,         // proto field `isCanceled`
    extraGuestsAllowed: true,
    isScheduleCall: false,
    // joinLink: ''             // optional — overrides the call-resolved link
}, quotedMsg)
```

`startDate` is required and validated; `endDate` is optional. The payload
always carries `messageContextInfo.messageSecret` and `isCanceled`.

### sendOrder / sendInVoice

```js
await sock.sendOrder(remoteJid, order, quoted?, options?)
await sock.sendInVoice(remoteJid, invoice, quoted?, options?)
```

Payload:

```js
await sock.sendOrder('6281234567890@s.whatsapp.net', {
    orderId: 'ORDER-001',
    thumbnail: 'https://example.com/thumb.jpg',
    itemCount: 2,
    status: 'IN_PROGRESS',
    surface: 'CATALOG',
    message: 'Pesanan diproses',
    orderTitle: 'Order 001',
    sellerJid: '6281234567890@s.whatsapp.net',
    token: 'token-value',
    totalAmount1000: 50000,
    totalCurrencyCode: 'IDR'
})

await sock.sendInVoice('6281234567890@s.whatsapp.net', {
    invoiceId: 'INV-001',
    invoiceUrl: 'https://example.com/invoice',
    currencyCodeIso4217: 'IDR',
    amount1000: 25000,
    invoiceName: 'Invoice 001',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    description: 'Invoice description',
    image: './thumb.jpg'    // optional — prepared as the encrypted attachment
})
```

When `image`/`thumbnail` is provided, the attachment fields
(`attachmentType`, `attachmentMimetype`, `attachmentMediaKey`,
`attachmentDirectPath`, `attachmentFileSha256`, `attachmentFileEncSha256`,
`attachmentJpegThumbnail`) are embedded in `invoiceMessage`, and a
`token` is always generated.

### sendLocation

```js
await sock.sendLocation(remoteJid, location, quoted?, button?, options?)
```

Payload — thumbnail otomatis di-resize 300x300; mention via `mentions`
(eksplisit):

```js
// tanpa tombol — location message polos dengan mention
await sock.sendLocation('6281234567890@s.whatsapp.net', {
    degreesLatitude: -6.2,
    degreesLongitude: 106.8,
    name: 'Jakarta',
    address: 'Monas',
    jpegThumbnail: './thumb.jpg'        // Buffer, URL, atau path — di-resize 300x300
}, quotedMsg, null, {
    caption: 'Kita ketemu di sini',
    mentions: ['62811111111@s.whatsapp.net'],
    // contextInfo: { forwardingScore: 1 }
})

// dengan tombol — buttonsMessage (headerType 5 + locationMessage)
await sock.sendLocation('6281234567890@s.whatsapp.net', {
    degreesLatitude: -6.2,
    degreesLongitude: 106.8,
    name: 'Jakarta',
    address: 'Monas'
}, quotedMsg, null, {
    caption: 'Temui aku di sini',
    footer: 'Nexray Maps',
    buttons: [
        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Lihat rute', id: 'route' }) },
        { text: 'Buka Maps', id: 'maps' }   // plain buttons are normalized to { buttonId, buttonText, type: 1 }
    ]
})

// single button via parameter `button`
await sock.sendLocation('6281234567890@s.whatsapp.net', {
    degreesLatitude: -6.2,
    degreesLongitude: 106.8,
    name: 'Jakarta'
}, quotedMsg, {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: 'Lihat rute', id: 'route' })
})
```

## Newsletter

Newsletter media annotation is centralized. Configure a default:

```js
Client(sock, {
    engines: [Baileys],
    newsletterAnnotation: {
        newsletterJid: 'channel@newsletter',
        newsletterName: 'My Channel'
    }
})
```

The annotation (polygon vertices + newsletter info) is applied automatically to
image/video relays toward `@newsletter` JIDs, or pass
`options.newsletterAnnotation` per message to override.

Newsletter follow:

```js
Client(sock, {
    engines: [Baileys],
    newsletterFollow: ['channel@newsletter']
})
```

## NODES

Shared protocol node shapes used by the helpers, exported for direct use:

```js
import { NODES } from '@nexray/lib'
```

- `mixed` — interactive native flow (used by sendInteractive / sendCard / sendLocation buttons)
- `payment_key_info`, `catalog_message`, `order_details` — commerce native flows
- `poll_creation`, `quiz_creation` — poll meta nodes (used by sendPoll / sendQuiz)
- `event_creation` — event meta node (used by sendEvent)
- `bot_ai` — AI labels (used by `ai: true`)

## Utils

```js
import { Utils } from '@nexray/lib'
```

- `sleep`, `delay`, `getRandom`, `pickRandom`, `random`, `size`, `formatBytes`
- `sharp(input)` — resize 300x300 cover (Buffer / URL / path)
- `isUrl`, `isURL`, `isUrlValid`, `isUrlInText`, `extractLink`
- `getDevice(id)`, `generateMessageID()`, `generateMessageIDV2(userJid?)`
- `toBuffer`, `getStream`, `getMimeType`
- `hasNonNullishProperty`, `texted(font, text)`, `example(prefix, command, args)`, `jsonFormat(value)`
- `extend({ ... })` — inject project-local utilities into the namespace (`Utils.extend`)

```js
import { Utils } from '@nexray/lib'

Utils.size(Buffer.alloc(2048))                  // '2.00 KB'
Utils.size(Buffer.alloc(2048), 1)               // true  (lebih besar dari 1 MB)
Utils.texted('bold', 'halo')                    // '*halo*'
Utils.example('.', 'menu')                      // '• *Example* : .menu '
Utils.jsonFormat({ a: 1, self: null })          // JSON 2-space, aman circular
const thumb = await Utils.sharp('./foto.jpg')   // Buffer 300x300

// inject utility lokal ke namespace
Utils.extend({ greeting: () => 'halo' })
```

## Error Handling

Every error is a `NexrayError` with a stable `code`:

`INVALID_ENGINE`, `INVALID_OPTIONS`, `INVALID_SOCKET`, `INVALID_JID`,
`INVALID_MEDIA`, `INVALID_MESSAGE`, `INVALID_DATE`, `NEWSLETTER_ONLY`,
`MEDIA_DOWNLOAD`, `MEDIA_PROCESS`, `RELAY_FAILED`, `NOT_IMPLEMENTED`,
`MISSING_ARGUMENT`.

```js
import { ErrorCodes } from '@nexray/lib'
try {
    await sock.sendText('', 'x')
} catch (error) {
    if (error.code === ErrorCodes.INVALID_JID) { /* ... */ }
}
```

## Project Structure

```
lib/
├── index.js        # ESM entry (main)
├── index.mjs       # dual entry (node:module, import & require)
├── core/
│   ├── client.js    # socket wrapping + config validation
│   ├── message.js  # relay pipeline + message helpers
│   ├── serialize.js
│   ├── node.js     # NODES protocol shapes
│   └── index.js
├── constant/
│   ├── error.js
│   └── index.js
├── types/
│   ├── baileys.js
│   ├── utils.js
│   └── index.js
└── utils/
    ├── exif.js
    ├── sticker-pack.js
    ├── logs.js
    ├── cryptokey.js
    ├── converter.js
    ├── chiper.js
    ├── function.js
    └── index.js
```

## Development

```bash
npm run check   # syntax check core files
npm test        # run the test suite
```

## License

ISC