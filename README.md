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
  - [Event](#event)
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
  engines: [baileys],                // REQUIRED — your own require('baileys') instance, first entry wins
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
  updateProtoOnStartup?: boolean     // default true — reserved, does not block attach
})
```

`Client()` throws immediately if `engines` is missing or empty — there is no implicit
`require('baileys')` fallback anywhere in this library, by design (see
[Changelog](#changelog--fixes-in-this-revision)).

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

Internally `sendPoll`/`sendQuiz` build a plain `{ poll: {...} }` content object, and
`sendPollResult`/`sendQuizResult` build `{ pollResult: {...} }` — baileys' own
`generateWAMessageContent` translates these into the correct
`pollCreationMessage`/`pollCreationMessageV2`/`V3`/`V5` or
`pollResultSnapshotMessage`/`V3` proto (and generates `messageSecret` for you).
`sendQuizResult` is `sendPollResult` with `pollType: 1` — there's no separate code path
for quiz results since the underlying payload shape is identical.

### Event

```js
await sock.sendEvent(m.chat, {
  name: 'Community Meetup',
  description: 'Monthly sync',
  startDate: new Date(Date.now() + 86400000),
  endDate: new Date(Date.now() + 90000000),   // optional
  location: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: 'Jakarta' }, // optional
  call: 'audio',                // optional — 'audio' | 'video'
  isCancelled: false,           // optional
  extraGuestsAllowed: true,     // optional
  isScheduleCall: false         // optional
}, m)
```

Uses baileys' native `event` content-key (`eventMessage`). `startDate` is required and
accepts a `Date`, ISO string, or epoch ms (coerced to `Date` internally).

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

### Everything broke: `generateWAMessage is not a function`, `prepareWAMessageMedia is not a function`, `extractVideoThumb / generateThumbnail both unavailable`

**Bug:** in the previous revision's `engines`-only refactor, `attachSendHelpers`
destructured `generateWAMessage` and `generateWAMessageFromContent` into local
variables named `baileys.generateWAMessage`/`.generateWAMessageFromContent`, but a
follow-up edit that added the `baileysFn()` safety wrapper accidentally **renamed the
main engine reference variable** without updating every place in the file that still
referred to the old name `baileys.xxx`. Since JavaScript variable declarations are
function-scoped, this didn't throw a syntax error — it silently created a
`ReferenceError`-prone gap where `sendText`, `sendPoll`, `sendMetaMsg`, `sendSticker`,
and `sendLivePhoto` all called into what was effectively an undefined reference at
runtime, surfacing as different, confusing `TypeError`s depending on which function
each one happened to touch first.

**Fix:** the engine reference is resolved once per `attachSendHelpers(sock)` call into
a single `baileys` variable (a **live object reference** — not a snapshot of
individual functions), and every call site — `baileys.prepareWAMessageMedia(...)`,
`baileys.extractVideoThumb(...)`, `baileys.generateThumbnail(...)`,
`baileys.STORIES_JID`, and so on — reads straight through that same reference with no
local reimplementation of anything baileys itself provides.
`generateWAMessage`/`generateWAMessageFromContent` additionally go through a
`baileysFn(sock, name)` helper that re-resolves the function fresh on every call and
throws a clear, specific error (naming exactly which function is missing and why) if
it's ever genuinely absent from the configured engine — instead of a bare
`TypeError: X is not a function` several stack frames deep.

`getBaileys(sock)` also now transparently unwraps one common ESM/CJS interop shape:
if the object passed via `engines: [baileys]` doesn't have `generateWAMessage` at the
top level but does have it under `.default` (which some bundlers/loaders produce for
`baileys`), that `.default` object is used automatically.

### `sendLivePhoto` — no local thumbnail-extraction reimplementation

Per explicit request, `extractLiveThumb` now calls `baileys.generateThumbnail(path,
'video', {})` and `baileys.extractVideoThumb(path, offset, size)` directly with zero
local video-frame-extraction logic of its own — it only decides *which* baileys
function to try and in what order (`extractVideoThumb` first for quality/retries if
present, `generateThumbnail` as the guaranteed-available fallback), never reimplements
what either of them does.

### `engines: [baileys]` is now required — no more implicit `require('baileys')`

**Before:** the library called `require('baileys')` on its own as a last-resort
fallback if no engine was configured, relying on it being installed as a peer
dependency in the consumer's `node_modules`.

**After:** `require('baileys')` does not appear anywhere in this library anymore.
`Client(sock, options)` now **requires** `options.engines: [baileys]` and throws
immediately if it's missing:

```js
const baileys = require('baileys')
Client(sock, { engines: [baileys] })
```

This also registers the engine globally (via `Utils.setEngine`), so standalone
`Utils.getDevice()` / `Utils.getStream()` / `Utils.toBuffer()` /
`Utils.getAudioWaveform()` calls work without needing socket access — call
`Utils.setEngine(baileys)` yourself if you need those before calling `Client()`.

### Poll / poll result messages sent as invisible "raw" payloads — corrected root cause

The previous revision's notes attributed this to baileys not supporting the
`poll`/`pollResult` content-keys at all, and worked around it by building raw proto
objects directly. That diagnosis was based on an unrepresentative test double — the
**actual** installed baileys build (a patched fork, confirmed via its own source)
supports `poll` and `pollResult` content-keys natively, including `messageSecret`
generation and mention/`nonJidMentions` handling. The real, more subtle bug was
elsewhere (see `sendSticker` below) — polls were structurally fine.

**Fix:** `sendPoll` / `sendQuiz` / `sendPollResult` / `sendQuizResult` are back to the
simple, thin approach — building a plain `{ poll: {...} }` / `{ pollResult: {...} }`
content object and letting baileys' own `generateWAMessageContent` build the correct
`pollCreationMessage*` / `pollResultSnapshotMessage*` proto and `messageSecret`. This
is less code, matches how the installed baileys fork actually works, and
`sendQuizResult` is now just `sendPollResult` with `pollType: 1` — there's no separate
quiz-result code path since the underlying payload is identical.

### `sendText` — `mentionAll` now uses `nonJidMentions`, not a manually-built `mentionedJid`

**Bug:** `{ mentionAll: true }` fetched `sock.groupMetadata(jid)` and manually built a
`contextInfo.mentionedJid` array from every participant's JID. This worked, but sent a
large, LID-format-fragile array over the wire instead of the clean mechanism WhatsApp
actually expects for "@all".

**Fix:** `mentions` / `mentionAll` are now passed straight through as **content-level**
keys (siblings of `text`, not nested in `contextInfo`), because baileys'
`generateWAMessageContent` already resolves them itself — `mentionAll: true` becomes
`contextInfo.nonJidMentions = 1`, and `mentions: [...]` becomes
`contextInfo.mentionedJid`. No `groupMetadata` fetch needed anymore.

### `sendSticker` — URL input silently failed with "could not resolve media to a buffer"

**Bug:** `prepareStickerBuffer` pre-wrapped string input through `normalizeMediaInput`,
turning a plain URL string into `{ url: '...' }` *before* calling `resolveToBuffer`.
But `resolveToBuffer` only handled raw strings and Buffers — any object input
(including that `{ url }` wrapper) hit an early `return null` with no attempt to fetch
it at all, which then surfaced as a generic "could not resolve media to a buffer"
error with no indication a double-wrapping bug was the cause.

**Fix:** `resolveToBuffer` now unwraps `{ url }` / `{ path }` objects back into a plain
string before deciding whether to fetch or read from disk, and the sticker call site
passes its input directly instead of pre-wrapping it. URL, path, and Buffer sticker
input all resolve correctly now.

### `sendLivePhoto` — "extractVideoThumb unavailable" even though baileys was installed

**Bug:** the installed baileys build only re-exports `generateThumbnail` on its main
module barrel; the lower-level `extractVideoThumb` (used internally by
`generateThumbnail`) lives in `messages-media.js` and isn't re-exported separately in
every build. Checking `baileys.extractVideoThumb` directly returned `undefined`, and
the previous code treated that as a hard failure with no fallback.

**Fix:** `sendLivePhoto`'s frame extraction now tries `baileys.extractVideoThumb`
first if it happens to be available (better quality — multiple seek-offset retries,
controllable size), and falls back to `baileys.generateThumbnail(path, 'video', {})` —
which **is** always exported, since baileys uses it internally for every video
upload — decoding its returned base64 thumbnail. Only throws if both paths are
unavailable or fail to produce a valid JPEG.

### `sendEvent` — new

Added, using baileys' native `event` content-key:

```js
await sock.sendEvent(m.chat, {
  name: 'Community Meetup',
  description: 'Monthly sync',
  startDate: new Date(Date.now() + 86400000),
  endDate: new Date(Date.now() + 90000000),   // optional
  location: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: 'Jakarta' }, // optional
  call: 'audio',                // optional — 'audio' | 'video'
  isCancelled: false,           // optional
  extraGuestsAllowed: true,     // optional
  isScheduleCall: false         // optional
}, m)
```

`startDate` is required and coerced to a `Date` if you pass an ISO string or epoch
ms — baileys calls `.getTime()` on it internally with no null-check, so this avoids a
crash on a loosely-typed input.

### Older fixes (carried over from previous revisions)

- `sendThumbnailPreview` accepts `quoted` in either the 3rd or 4th position (real bot
  code often writes the options object before the trailing `m`), fixed a dead-code path
  that referenced an unassigned `msg` when `largeThumb` was falsy, and
  `resolveToBuffer` now throws real, descriptive errors instead of silently returning
  `null` on network/file failures.
- `sendSticker` `packname`/`author`/`emojis` are embedded into the WebP's EXIF chunk
  (the only place WhatsApp actually reads sticker metadata from), and
  `sendStickerPack` was implemented.
- `sendContact` supports both personal and WhatsApp Business-style vCards
  (`TITLE`, `ADR`, `X-WA-BIZ-NAME`, `X-WA-BIZ-DESCRIPTION`).
- `sendFile`'s type-routing checks converted to `hasNonNullishProperty`.
- All ~26 send helpers are named function declarations attached once via a single
  `Object.assign(sock, {...})`, instead of individual `sock.sendX = function` assignments.
- Client options renamed with backward-compatible fallbacks: `custom_id`
  (`messageIdPrefix`), `newsletterFollow` (`autoFollowNewsletter`), `engines`
  (`baileys`), plus new `stealth` (`ios`/`android`/`web`/`desktop`/`dekstop`) for
  device-shaped message IDs.

---

## License

ISC
