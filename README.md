# @nexray/lib

Lightweight Baileys helper — relay-based send helpers + Utils, with a neoxr-style
(`sock.sendX(...)`) API on top of a plain [Baileys](https://github.com/WhiskeySockets/Baileys) socket.

`@nexray/lib` does not fork or wrap Baileys' connection layer. It **mutates the socket
you already have** by attaching ~30 `sock.sendX` methods to it, all built on
`generateWAMessage` / `generateWAMessageFromContent` + `sock.relayMessage` — the same
primitives Baileys itself uses internally. Nothing here reimplements encryption,
upload, or protocol handling; those all stay inside Baileys.

```bash
npm i @nexray/lib baileys
```

- Node.js >= 18
- `baileys` is a **peer dependency** — install it yourself (`>=6.7.0 || ^7.0.0-rc`)
- CommonJS **and** ESM both supported (`require('@nexray/lib')` / `import ... from '@nexray/lib'`)

---

## Table of contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Client options](#client-options)
- [Calling convention](#calling-convention)
- [Send API](#send-api)
  - [Text / react](#text--react)
  - [Image / Video / Audio](#image--video--audio)
  - [File (auto-route)](#file-auto-route)
  - [Location](#location)
  - [Sticker / sticker pack](#sticker--sticker-pack)
  - [Album](#album-min-2-media)
  - [Poll / Quiz / Poll result / Quiz result](#poll--quiz--poll-result--quiz-result)
  - [Contact](#contact)
  - [Product](#product)
  - [Interactive / buttons / carousel](#interactive--buttons--carousel)
  - [Meta / AIRich (rich message)](#meta--airich-rich-message)
  - [Group status / status@broadcast](#group-status--statusbroadcast)
  - [Live photo](#live-photo)
  - [Thumbnail preview (custom link preview)](#thumbnail-preview-custom-link-preview)
  - [Forward](#forward)
- [Media annotation (newsletter)](#media-annotation-newsletter)
- [The `hasNonNullishProperty` pattern](#the-hasnonnullishproperty-pattern)
- [Error handling](#error-handling)
- [Utils](#utils)
- [Exports](#exports)
- [Changelog / fixes in this revision](#changelog--fixes-in-this-revision)
- [License](#license)

---

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
    // polygonVertices optional (default baked in)
  },
  bot: (id) =>
    (id.startsWith('3EB0') && id.length === 40) ||
    id.startsWith('BAE') ||
    /[-]/.test(id)
})

// sock now has sock.sendText, sock.sendImage, sock.sendPoll, ... etc.
sock.ev.on('messages.upsert', async ({ messages }) => {
  const m = messages[0]
  if (!m.message) return
  await sock.reply(m.key.remoteJid, 'pong', m)
})
```

`Client(sock, options)` is a **pure attach** — it does not register any event
listeners for you (other than the optional `autoFollowNewsletter` timer) and does not
touch your auth/connection logic. Call it once, right after `makeWASocket(...)`.

---

## How it works

Every `sock.sendX` helper follows the same three-step shape:

1. **Build** a plain content object (`{ text: '...' }`, `{ image: buf, caption }`,
   `{ poll: {...} }`, …) — the same shape Baileys' own `generateWAMessageContent`
   understands.
2. **Generate** the full `proto.WebMessageInfo` via `generateWAMessage` /
   `generateWAMessageFromContent` (handles media upload, encryption keys, thumbnails,
   waveform, etc. — all inside Baileys, nothing is reimplemented here).
3. **Relay** it with `sock.relayMessage(jid, message, opts)` — the low-level send path,
   which is what `sock.sendMessage` uses under the hood too, but lets `@nexray/lib`
   attach `additionalNodes`, per-message newsletter annotations, and album/live-photo
   association without fighting Baileys' higher-level wrapper.

This means `@nexray/lib` stays a **thin layer**: if Baileys changes how a payload is
generated, `@nexray/lib` inherits the fix automatically as long as the content-object
shape (`{ poll: {...} }`, `{ album: [...] }`, …) is unchanged.

---

## Client options

```ts
Client(sock, {
  custom_id?: string,                // default 'NEXRAY' — prefixes generated message IDs (was messageIdPrefix)
  newsletterFollow?: false | string | string[], // opt-in only (was autoFollowNewsletter)
  newsletterAnnotation?: false | {
    newsletterJid: string,
    newsletterName: string,
    accessibilityText?: string,
    contentType?: number,            // default 1
    serverMessageId?: number,        // default: random
    polygonVertices?: { x: number, y: number }[]  // default: built-in vertices
  },
  bot?: (id: string) => boolean,     // used to detect bot/business-relayed message IDs
  stealth?: 'ios' | 'android' | 'web' | 'desktop' | 'dekstop', // device-shaped message IDs
  engines?: object[],                // e.g. [require('baileys')] — first entry wins (was `baileys:`)
  updateProtoOnStartup?: boolean     // default true — reserved, does not block attach
})
```

Everything you pass is stored on `sock.__nexray` and merged with defaults — you can
read it back at any time (`sock.__nexray.newsletterAnnotation`, etc.), and any extra
keys you pass through are preserved as-is for your own use.

The old option names (`messageIdPrefix`, `autoFollowNewsletter`, `baileys`) still work
as fallbacks — nothing breaks if you're upgrading from an older config.

### Stealth (device-shaped message IDs)

```js
Client(sock, { stealth: 'ios' })      // '3A' + 18 hex chars (20 total)
Client(sock, { stealth: 'web' })      // '3E' + 20 hex chars (22 total)
Client(sock, { stealth: 'android' })  // 21 raw hex chars
Client(sock, { stealth: 'desktop' })  // '3F' + 16 hex chars (18 total) — 'dekstop' also accepted
```

Shapes match Baileys' own `getDevice(id)` pattern-matching exactly, so a stealth-tagged
outgoing message ID reads as coming from that device type. When `stealth` is set it
takes priority over `custom_id`; leave it unset to use the readable prefix instead.

### Overriding the baileys module

`@nexray/lib` resolves `require('baileys')` **once**, at module load, and reuses that
single reference for every send call. If you need to inject a different baileys build
(a fork, a patched version, a mock in tests), pass it via `engines`:

```js
Client(sock, {
  engines: [require('my-baileys-fork')]
})
```

This override takes priority over the module-level `require('baileys')` on every call,
with no extra `require()` overhead in the hot path.

---

## Calling convention

- **Quoted message** is always **positional**, placed **right before the trailing
  options object** (`sendX(jid, ..., quoted, opts)`) — matching neoxr/Baileys
  conventions. It is never buried inside `opts` in the documented signature.
  `sendThumbnailPreview` is the one exception that accepts **either** order
  (`(jid, text, quoted, opts)` or `(jid, text, opts, quoted)`) since its options object
  is commonly written inline before the trailing `m` in real bot code — both orders are
  detected automatically and work identically.
- **Media** accepts `Buffer | path string | http(s) url | { url }` everywhere.
- Most helpers accept **either** `(jid, payload, quoted, opts)` **or**
  `(jid, payload, opts)` — if the 3rd positional argument doesn't look like a quoted
  message (`m` / `{ key }` / `{ id, chat }`) and does look like an options object, it's
  treated as `opts` automatically.
- `opts.messageId` lets you pin a specific message ID instead of the auto-generated one.
- `opts.expiration` sets disappearing-message duration (seconds) where applicable.
- `opts.mentions` / `opts.mentionedJid` accepts an array of JIDs.

---

## Send API

### Text / react

```js
await sock.reply(m.chat, 'Test!', m)                 // alias of sendText
await sock.sendText(m.chat, 'Hello', m, {
  mentions: [m.sender],
  expiration: 86400,
  linkPreview: false          // disable link preview for this message
})
await sock.sendReact(m.chat, '💀', m.key)
```

### Image / Video / Audio

```js
// image — auto newsletter annotation if Client({ newsletterAnnotation }) is set
await sock.sendImage(m.chat, 'https://…/a.jpg', 'caption', m)
await sock.sendImage(m.chat, './a.jpg', 'caption', m)
await sock.sendImage(m.chat, buffer, 'caption', m, {
  newsletterAnnotation: { newsletterJid: '…@newsletter', newsletterName: '@x' } // per-call override
})

await sock.sendVideo(m.chat, './v.mp4', 'caption', m, { gifPlayback: false })
await sock.sendPtv(m.chat, './note.mp4', m)           // round video note (video-note bubble)

await sock.sendAudio(m.chat, './a.mp3', m, { ptt: true })   // voice note, auto waveform via audio-decode
await sock.sendAudio(m.chat, buffer, m, { ptt: false })     // regular audio file
await sock.sendAudio(m.chat, 'https://…/a.ogg', m, { ptt: true })
```

### File (auto-route)

`sendFile` sniffs mimetype/extension and dispatches to `sendImage` / `sendVideo` /
`sendAudio` / the internal document sender for you:

```js
await sock.sendFile(m.chat, 'https://…/a.jpg', 'image.jpg', 'Test!', m)
await sock.sendFile(m.chat, './a.mp3', '', '', m, { ptt: true })
await sock.sendFile(m.chat, './doc.pdf', 'doc.pdf', 'Caption', m, { document: true })
```

### Location

```js
await sock.sendLocation(m.chat, { lat: -6.2, lng: 106.8, name: 'Jakarta' }, m)
// or positional [lat, lng]
await sock.sendLocation(m.chat, [-6.2, 106.8], m)
```

### Sticker / sticker pack

```js
await sock.sendSticker(m.chat, './s.webp', m)
await sock.sendSticker(m.chat, buffer, m)

// packname/author are embedded into the webp's EXIF chunk — this is the only place
// WhatsApp actually reads sticker metadata from (not a protobuf field), so both are
// written into the image bytes themselves before upload.
await sock.sendSticker(m.chat, './s.webp', m, {
  packname: 'My Pack',
  author: 'Nexray',
  emojis: ['🔥', '😀'],   // optional, defaults to ['🔥']
  isAvatar: false,        // optional
  isLottie: false,        // optional — animated Lottie sticker wrapper
  premium: false,         // optional — adds limitSharingV2 lock
  locked: false           // optional — same lock, without the premium flag
})

await sock.sendStickerPack(m.chat, {
  name: 'My Pack',
  publisher: 'nexray',
  cover: './cover.webp',        // currently informational only — not sent as a separate message
  stickers: [
    { data: './a.webp', emojis: ['😀'] },
    { data: buffer, emojis: ['🔥'] }
  ]
}, m)
```

`sendStickerPack` sends every sticker in the pack tagged with the same
`packname`/`publisher`, one relayed sticker message per item — WhatsApp has no native
multi-sticker "bundle" message, so this mirrors how real bots deliver packs. A failed
item is logged and skipped rather than aborting the whole pack.

### Album (min. 2 media)

```js
await sock.sendAlbum(m.chat, [
  { image: 'https://…/a.jpg', caption: '1' },
  { image: './b.jpg', caption: '2' },
  { video: buffer, caption: 'vid' }
], m)
// alias: sock.sendAlbumMessage(...)   — neoxr-compatible name
```

Each item accepts `{ image }`, `{ video }`, or the legacy `{ url, type: 'image'|'video' }`
shape. Every image/video item automatically receives newsletter annotations +
association back to the parent album key when `newsletterAnnotation` is configured.

### Poll / Quiz / Poll result / Quiz result

```js
// --- Regular poll message
await sock.sendPoll(m.chat, [
  '✨ Yes', '💀 No'
], m, {
  name: '🔥 Is it good?',
  selectableCount: 1,
  toAnnouncementGroup: false,
  endDate: Date.now() + 28_800_000, // optional — ms epoch or Date
  hideVoter: false,                 // optional
  canAddOption: false               // optional
})

// neoxr-compatible shape also works:
await sock.sendPoll(m.chat, 'Do you like this library?', {
  options: ['Yes', 'No'],
  multiselect: false
})

// --- Quiz (newsletter only)
await sock.sendQuiz('1211111111111@newsletter', [
  '✨ Yes', '💀 No'
], m, {
  name: '🔥 Quiz!',
  correctAnswer: '✨ Yes'
})

// --- Regular poll result / snapshot message
await sock.sendPollResult(m.chat, '📈 Poll Result', [
  { name: '🔥 Fire', voteCount: 133 },
  { name: '❤️ Love it', voteCount: 18 }
], m)

// --- Quiz result message (renders the trophy/quiz-result card)
await sock.sendQuizResult(m.chat, '🏆 Quiz Result', [
  { name: '🔥 Fire', voteCount: 133 },
  { name: '❤️ Love it', voteCount: 18 }
], m)

// --- neoxr-compatible alias: pollResult(jid, { name, votes: [{ name, count }] }, m)
await sock.pollResult(m.chat, {
  name: 'Demo Poll Result',
  votes: [
    { name: 'Jokowi', count: 1500 },
    { name: 'Prabowo', count: 200 }
  ]
}, m)
```

`sendPoll` accepts three call shapes:

| Shape | Example |
|---|---|
| Baileys-native positional | `sendPoll(jid, ['Yes','No'], m, { name, selectableCount, ... })` |
| neoxr-style options object | `sendPoll(jid, 'Question?', { options: [...], multiselect }, m)` |
| Plain values array + quoted | `sendPoll(jid, 'Question?', ['Yes','No'], m)` |

Internally `sendPoll`/`sendQuiz`/`sendPollResult`/`sendQuizResult` build the **raw
proto message directly** (`pollCreationMessage` / `pollCreationMessageV2` /
`pollCreationMessageV3` / `pollCreationMessageV5` for creation, and
`pollResultSnapshotMessage` / `pollResultSnapshotMessageV3` for results) via
`generateWAMessageFromContent`, instead of relying on baileys' higher-level
`generateWAMessageContent` to understand a `poll`/`pollResult` content-key. This makes
polls work on **any** baileys build, including ones that don't ship those content-key
branches — see [Changelog](#changelog--fixes-in-this-revision) for why this matters.

### Contact

```js
// personal contact
await sock.sendContact(m.chat, [{
  name: 'Owner',
  number: '62812xxxxxxx',
  about: 'Creator'
}], m, {
  org: 'Nexray',
  website: 'https://example.com',
  email: 'a@b.com'
})

// business-style contact card (adds TITLE, ADR, X-WA-BIZ-NAME, X-WA-BIZ-DESCRIPTION)
await sock.sendContact(m.chat, [{
  name: 'Owner Name',
  number: '62812xxxxxxx',
  business: true,
  bizName: 'My Bot',
  bizDescription: 'A beginner bot',
  title: 'My Bot',
  region: 'Indonesia',
  email: 'owner@bot.com',
  website: 'https://bot.com'
}], m)
```

Both produce a standard vCard 3.0 payload; the business variant matches the exact field
set WhatsApp Business uses (`N`, `FN`, `TITLE`, `TEL;TYPE=CELL;waid=`,
`EMAIL;type=INTERNET`, `URL`, `ADR;TYPE=WORK`, `NOTE`, `X-WA-BIZ-NAME`,
`X-WA-BIZ-DESCRIPTION`).

### Product

```js
await sock.sendProduct(remoteJid, {
  image: 'https://…/img.jpg',   // or Buffer / path — alias: productImage
  title: '© bot',
  productId: 'SKU-1',
  businessOwnerJid: '628…@s.whatsapp.net',
  caption: 'text body',
  footer: 'footer',
  price: 150000,                 // optional — rupiah-style integer, auto-converted to priceAmount1000
  currencyCode: 'IDR',           // optional
  interactiveButtons: [          // optional
    { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Download', url: 'https://…' }) },
    { name: 'automated_greeting_message_view_catalog', buttonParamsJson: JSON.stringify({
        business_phone_number: '628…',
        catalog_product_id: 'SKU-1'
    }) }
  ]
}, m)
```

### Interactive / buttons / carousel

```js
// Raw native-flow buttons (Baileys wire format)
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
  media: 'https://…/cover.jpg'   // image or video header — auto-detected
})
// aliases: sock.sendInteractive(...), sock.sendButton(...)

// Shorthand buttons (auto-normalized to native-flow)
await sock.sendInteractive(m.chat, [
  { text: 'OWNER', id: '.owner' },
  { text: 'Web', url: 'https://example.com' },
  { text: 'Copy', copy: 'KODE' },
  { text: 'Call', phone: '62812…' },
  { location: true }
], m, { content: 'Hi!', footer: 'foot' })

// Multiple / bottom-sheet list style (neoxr "multiple" option)
await sock.sendInteractive(m.chat, buttons, m, {
  content: 'Hi!',
  footer: 'foot',
  media: 'https://…/cover.jpg',
  multiple: {
    name: 'nexray',
    list_title: 'Select Menu',
    button_title: 'Tap Here!'
  }
})

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

### Meta / AIRich (rich message)

Rich, multi-block messages (text + code blocks + tables + links, or the reel/post/
product "meta v3" style). See `lib/helpers/rich-message.js` for the full block schema
(`text`, `code`, `table`, `muted`, `suggestions`, `sources`, `reels`, `posts`, `products`).

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

### Group status / status@broadcast

```js
// group status — image or video
await sock.groupStatus(m.chat, {
  image: 'https://…/a.jpg',   // or video: '...'
  caption: 'Hi!'
})

// group status — text
await sock.groupStatus(m.chat, {
  text: 'Hi!',
  background: '#FF0000',
  font: 2
}, { isGroupStatus: true })

// group status — private / close-friends style audience
await sock.groupStatus(m.chat, { text: 'Hi!' }, {
  private: { name: 'Nexray Creative', emoji: '🔥' }
})

// status@broadcast with mentions (visible to specific contacts)
await sock.sendStatusMentions(['628xxx@s.whatsapp.net'], {
  image: 'https://…/a.jpg',
  caption: 'Hi!'
})
await sock.sendStatusMentions(jids, { text: 'Hi!', background: '#FF0000' })
```

### Live photo

```js
// video is required; image is optional — if omitted, a still frame is
// extracted from the video automatically (see fix notes below)
await sock.sendLivePhoto(m.chat, {
  video: './clip.mp4'
  // image: './cover.jpg'  // optional — skips frame extraction if provided
}, m)
```

`sendLivePhoto` sends the paired image+video "live photo" bubble: an image message
(`pairedMediaType: 5`) followed by a video message (`pairedMediaType: 6`) associated
back to the image via `messageAssociation.parentMessageKey`. When you don't supply
`image`, a frame is pulled from the video with Baileys' `extractVideoThumb` — see the
[thumbnail fix notes](#sendlivephoto-thumbnail-fix) below for what changed.

### Thumbnail preview (custom link preview)

```js
await sock.sendThumbnailPreview(m.chat, 'Check this out!', {
  title: 'My Link',
  body: 'Description text',
  url: 'https://example.com',
  thumbnail: 'https://…/cover.jpg',  // or Buffer / path
  largeThumb: true,                  // big preview card vs small inline thumbnail
  ratio: 'landscape',                // 'landscape' | 'portrait' | 'square'
  icon: 'https://…/favicon.png'      // optional, only used with largeThumb
}, m)
```

### Forward

```js
await sock.copyNForward(m.chat, m)
await sock.copyNForward(m.chat, m, true)   // forceForward
```

---

## Media annotation (newsletter)

Set once globally via `Client(sock, { newsletterAnnotation })`, or override per-call
with `opts.newsletterAnnotation` on `sendImage` / `sendVideo` / `sendAlbum` / any
interactive/product/carousel call that carries an image or video header:

```js
Client(sock, {
  newsletterAnnotation: {
    newsletterJid: '1211111111111@newsletter',
    newsletterName: '@nexray',
    accessibilityText: '@nexray',
    contentType: 1,
    polygonVertices: [   // optional — defaults to a built-in vertex set
      { x: 60.71664810180664, y: -36.39784622192383 },
      { x: -16.710189819335938, y: 49.263675689697266 },
      { x: -56.585853576660156, y: 37.85963439941406 },
      { x: 20.840980529785156, y: -47.80188751220703 }
    ]
  }
})
```

Applies to: `sendImage`, `sendVideo`, each media item inside `sendAlbum`, and any
`imageMessage`/`videoMessage`/`productMessage.productImage` found in interactive
headers or carousel cards (walked recursively by `applyAnnotationsToMessage`).

---

## The `hasNonNullishProperty` pattern

Every place in `@nexray/lib` that needs to answer "does this payload object want to be
an album? a poll? a poll result?" uses the same guard baileys itself uses internally
(`generateWAMessageContent` in Baileys' `messages-media.js`), exported from
`Utils`/`lib/utils/functions.js`:

```js
function hasNonNullishProperty(message, key) {
  return message != null &&
    typeof message === 'object' &&
    key in message &&
    message[key] != null
}
```

Content dispatch reads as `else if` chains against this guard, matching Baileys' own
style, instead of ad-hoc truthy checks (`if (msg.album)`), so `0`, `''`, and `false`
values in payload fields are never mistaken for "absent":

```js
if (hasNonNullishProperty(message, 'video'))
  videoCount++
else if (hasNonNullishProperty(message, 'image'))
  imageCount++
```

This pattern is applied throughout `lib/helpers/message.js` — in `sendAlbum`'s item
normalizer/counter, `groupStatus`'s media-type dispatcher, and `sendStatusMentions`'s
payload dispatcher — anywhere the function has to decide **which kind of payload** it
received based on which key is present.

---

## Error handling

All validation errors throw `NexrayError` (`lib/constant/errors.js`), with a `.code`
matching one of `ErrorCodes`:

```js
const { NexrayError, ErrorCodes } = require('@nexray/lib') // via Utils/constant, see below
```

| Code | Meaning |
|---|---|
| `INVALID_SOCKET` | `Client(sock, ...)` was not given a valid socket object |
| `INVALID_JID` | Required `jid` argument missing |
| `INVALID_MEDIA` | Media input missing, empty, or the wrong shape for the call |
| `INVALID_OPTIONS` | Malformed options (e.g. `sendAlbum` with < 2 items, poll `selectableCount` out of range) |
| `MEDIA_DOWNLOAD` / `MEDIA_PROCESS` | Reserved for media pipeline failures |
| `RELAY_FAILED` | Reserved for relay-layer failures |
| `NOT_IMPLEMENTED` | Called a baileys primitive not present in the resolved baileys build |

`sendAlbum` catches per-item failures internally and logs them
(`console.error('[@nexray/lib] sendAlbum item failed:', ...)`) rather than aborting the
whole album — one bad media item won't cancel already-sent items.

---

## Utils

```js
const { Utils } = require('@nexray/lib')

Utils.extend({
  formatRupiah(n) {
    return 'Rp' + Number(n).toLocaleString('id-ID')
  }
})
Utils.formatRupiah(50000)

Utils.getDevice(id)             // proxies baileys.getDevice
Utils.sleep(1000)               // == Utils.delay(1000)
Utils.getAudioWaveform(buffer)  // proxies baileys.getAudioWaveform
Utils.getStream(item)           // proxies baileys.getStream
Utils.toBuffer(input)           // proxies baileys.toBuffer
Utils.getMimeType(path)         // via mime-types
Utils.generateMessageID(prefix)
Utils.generateMessageIDV2(userId)
Utils.formatBytes(bytes)
Utils.getRandom(ext)
Utils.pickRandom(array)
Utils.isUrl(text)
Utils.size(bufferOrBytes, thresholdMB?)
Utils.sharp(input)              // resize to 300x300 cover thumbnail via sharp
Utils.random(array)
Utils.texted('bold'|'italic'|'strike'|'mono', text)
Utils.example(prefix, command, args)
Utils.isURL(str)
Utils.isUrlValid(str)
Utils.isUrlInText(str)
Utils.extractLink(text)
Utils.jsonFormat(data)          // safe circular-reference-aware JSON.stringify
```

`Utils.extend()` refuses to silently overwrite any built-in method unless you pass
`{ force: true }` — this protects you from accidentally shadowing a core utility with a
plugin of the same name.

All `baileys.*` proxies (`getDevice`, `getStream`, `toBuffer`, `getAudioWaveform`)
resolve the `baileys` module **once** at module load (see
[Changelog](#changelog--fixes-in-this-revision)), and throw a clear
`Peer dependency "baileys" not found` error if it isn't installed, instead of a raw
`Cannot find module` stack trace.

---

## Exports

```js
const { Client, Utils } = require('@nexray/lib')
// ESM: import { Client, Utils } from '@nexray/lib'
```

Only `Client` and `Utils` are part of the public API surface (CJS + ESM, both point at
the same implementation — `lib/index.mjs` re-exports `lib/index.js` via
`createRequire`). Internals under `lib/helpers/*`, `lib/core/*`, `lib/constant/*` are
implementation details and may change without a major version bump.

---

## Changelog / fixes in this revision

### Poll / poll result / quiz messages sent as invisible "raw" payloads

**Bug:** `sendPollResult`, `sendQuizResult`, and the neoxr-style `pollResult` alias threw
`Error: Invalid media type` from `prepareWAMessageMedia`, and `sendPoll` sent a message
that relayed successfully but rendered as nothing on the recipient's screen. The cause:
these helpers built a `{ poll: {...} }` / `{ pollResult: {...} }` **content-key** object
and asked baileys' own `generateWAMessageContent` to translate it into the correct
proto — but not every installed baileys build recognizes those content-keys. When it
doesn't, `generateWAMessageContent`'s `if/else if` chain falls all the way through to
its final `else` branch, which assumes the object must be raw media, and tries (and
fails) to upload it as one.

**Fix:** poll and poll-result messages now build the **raw WhatsApp proto object
directly** — `pollCreationMessage` / `pollCreationMessageV2` / `pollCreationMessageV3`
/ `pollCreationMessageV5` for creation, `pollResultSnapshotMessage` /
`pollResultSnapshotMessageV3` for results — and hand it straight to
`generateWAMessageFromContent`, bypassing `generateWAMessageContent`'s content-key
translation entirely. This works identically regardless of which baileys build is
installed, since it no longer depends on that translation layer supporting polls at all.

### `sendThumbnailPreview` — false "thumbnail required" error

**Bug:** passing a perfectly valid `thumbnail: 'https://...'` URL still threw
`NexrayError: thumbnail required when largeThumb: true`. The internal
`resolveToBuffer()` helper swallowed **every** failure mode — network timeout, non-2xx
response, DNS failure — into a silent `null`, so a real fetch failure was reported as a
generic "you forgot to pass a thumbnail" message instead of the actual cause.

**Fix:** `resolveToBuffer()` now throws a `NexrayError` with the real reason
(`HTTP 403 Forbidden`, the underlying fetch error message, or "local file not found")
instead of returning `null` on failure. `sendThumbnailPreview` was also rewritten as a
plain `async function` (the previous compiled-generator version had an unreachable
branch that referenced an unassigned `msg` variable when `largeThumb` was falsy), and
now accepts `quoted` in **either** position — `(jid, text, quoted, opts)` or
`(jid, text, opts, quoted)` — since real bot code commonly writes the options object
before the trailing `m`.

### `sendSticker` — `packname`/`author` silently ignored

**Bug:** passing `{ packname, author }` had no effect on the sent sticker at all —
those fields were documented in a code comment but never actually implemented anywhere.
WhatsApp does not read sticker pack name/author from the message protobuf; it reads
them from a **WebP EXIF metadata chunk** embedded in the image bytes themselves, so
there was no way for the old code to have honored these options without writing that
chunk.

**Fix:** implemented real EXIF injection — `buildStickerExif` constructs the
WhatsApp-format JSON metadata blob (`sticker-pack-id`, `sticker-pack-name`,
`sticker-pack-publisher`, `emojis`, `is-avatar-sticker`), and `tagStickerWebp` splices
it into the WebP RIFF container (replacing any existing EXIF chunk), converting
non-webp input to webp via `sharp` first if needed. Also fixed a dead-code bug where
the primary (successful) send path returned an `undefined` message object instead of
the actual generated message.

### `sock.sendStickerPack is not a function`

**Bug:** documented in the previous README but never implemented — calling it threw a
plain `TypeError`.

**Fix:** implemented. Sends each sticker in the pack tagged with the pack's shared
`name`/`publisher`, one relayed message per item; a failed item is logged and skipped
rather than aborting the rest of the pack.

### `sendLivePhoto` — corrupted/invisible thumbnail

Two separate bugs, both now fixed:

1. **ffmpeg seek-to-zero failure**: extracting a preview frame with
   `extractVideoThumb(path, '00:00:00', ...)` frequently returned an empty or corrupt
   buffer, since many encodes have no decodable keyframe at the exact start of the
   file. Fixed by trying a short list of forward offsets (`00:00:01`, `00:00:00.5`,
   `00:00:00`) and validating the result actually starts with a JPEG SOI marker
   (`0xFFD8`) before accepting it.
2. **"file gambar rusak" (corrupted image file)**: when frame extraction failed *and*
   no offset produced a usable buffer, the old code silently fell back to uploading the
   **video's own raw bytes**, mislabeled as an `imageMessage`. `prepareMedia` performs
   no type validation, so this produced a message WhatsApp's client couldn't render —
   an "image" that was actually MP4 data. Fixed by throwing a clear
   `NexrayError('could not extract a valid frame from the video — pass { image }
   explicitly instead')` in that case, so a broken thumbnail is now impossible: either
   a real frame is used, or nothing is sent and the caller is told why. Remote video
   **URLs** (previously skipped entirely — extraction only worked for local paths and
   buffers) are now downloaded to a temp file first so ffmpeg can seek them too.

### `sendText` — `mentionAll` and `linkPreview: false` were no-ops

**Bug:** both options existed as empty conditional blocks with a comment but did
nothing — `{ mentionAll: true }` never actually mentioned anyone, and
`{ linkPreview: false }` never actually disabled the preview.

**Fix:** `mentionAll` now calls `sock.groupMetadata(jid)` (when `jid` is a group and
the method exists) and mentions every participant. `linkPreview: false` now passes an
explicit `linkPreview: null` into the generated content, which baileys' own
`generateLinkPreviewIfRequired` treats as "skip generation" (distinct from `undefined`,
which triggers auto-generation).

### `sendFile` routing didn't use `hasNonNullishProperty`

Converted `options.ptt`/`options.audio`/`options.document`/`options.image`/
`options.video`/`options.ptv` existence checks in `sendFile`'s auto-routing to
`hasNonNullishProperty(options, 'key')`, consistent with every other dispatch point in
the file. Also removed a dead `lower` variable that was computed but never read.

### Architecture: no more `sock.sendX = function (...) {...}`

Every send helper (`sendText`, `sendImage`, `sendPoll`, … — 26 in total) is now a plain
**named function declaration** (`function sendAudio(jid, ...) { ... }`) instead of an
anonymous function assigned directly onto the socket. All of them are attached to the
socket in a **single place**, at the end of `attachSendHelpers`, via one
`Object.assign(sock, { sendText, sendImage, ... })` call. Benefits: real function names
in stack traces (`at sendAudio (...)` instead of `at Object.<anonymous> (...)`),
functions can call each other directly instead of through `sock.`, and there is exactly
one line in the whole file where `sock.<name> = ...` happens.

### Client options renamed (old names still work as fallbacks)

| New name | Old name | Notes |
|---|---|---|
| `custom_id` | `messageIdPrefix` | prefixes generated message IDs |
| `newsletterFollow` | `autoFollowNewsletter` | `string \| string[]`, opt-in only |
| `engines: [baileys]` | `baileys: baileys` | first entry in the array wins |
| `stealth` | *(new)* | `'ios' \| 'android' \| 'web' \| 'desktop' \| 'dekstop'` |

`stealth` generates device-shaped message IDs matching Baileys' own `getDevice()`
pattern-matching exactly (`3A`+18 for iOS, `3E`+20 for web, 21 raw hex for android,
`3F`+16 for desktop) — see [Stealth](#stealth-device-shaped-message-ids) above.

### Older fixes (carried over from the previous revision)

- `require('baileys')` hoisted to module scope in every file (resolved once at load,
  not per send call), with `engines`/per-socket overrides still checked first.
- `hasNonNullishProperty(obj, key)` guard added and applied to `sendAlbum`'s item
  normalizer/counter, `groupStatus`'s media dispatcher, and `sendStatusMentions`'s
  payload dispatcher.

---

## License

ISC
