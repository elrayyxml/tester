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
  messageIdPrefix?: string,          // default 'NEXRAY' — prefixes generated message IDs
  autoFollowNewsletter?: false | string | string[], // opt-in only, no hidden behavior
  newsletterAnnotation?: false | {
    newsletterJid: string,
    newsletterName: string,
    accessibilityText?: string,
    contentType?: number,            // default 1
    serverMessageId?: number,        // default: random
    polygonVertices?: { x: number, y: number }[]  // default: built-in vertices
  },
  bot?: (id: string) => boolean,     // used to detect bot/business-relayed message IDs
  baileys?: object,                  // override which baileys module instance is used
  updateProtoOnStartup?: boolean     // default true — reserved, does not block attach
})
```

Everything you pass is stored on `sock.__nexray` and merged with defaults — you can
read it back at any time (`sock.__nexray.newsletterAnnotation`, etc.), and any extra
keys you pass through are preserved as-is for your own use.

### Overriding the baileys module

`@nexray/lib` resolves `require('baileys')` **once**, at module load, and reuses that
single reference for every send call (see
[Changelog](#changelog--fixes-in-this-revision) below). If you need to inject a
different baileys build (a fork, a patched version, a mock in tests), pass it explicitly:

```js
Client(sock, {
  baileys: require('my-baileys-fork')
})
```

This override takes priority over the module-level `require('baileys')` on every call,
with no extra `require()` overhead in the hot path.

---

## Calling convention

- **Quoted message** is always **positional** (`…, m)`), matching neoxr/Baileys
  conventions — never buried inside an options object unless you're using the
  options-object-only overload documented per method.
- **Media** accepts `Buffer | path string | http(s) url | { url }` everywhere.
- Most helpers accept **either** `(jid, payload, quoted, opts)` **or**
  `(jid, payload, opts)` — if the 3rd positional argument doesn't look like a quoted
  message (`m` / `{ key }` / `{ id, chat }`) and does look like an options object, it's
  treated as `opts` automatically. When in doubt, pass `quoted` positionally and put
  everything else in the trailing `opts` object.
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

Internally `sendPoll`/`sendQuiz` build the same `{ poll: {...} }` content shape Baileys'
own `generateWAMessageContent` expects (`pollCreationMessageV3` for single-select,
`pollCreationMessage` for multi-select, `pollCreationMessageV5` for quizzes), and
`sendPollResult`/`sendQuizResult` build `{ pollResult: { name, votes } }`, which maps to
`pollResultSnapshotMessage` / `pollResultSnapshotMessageV3` respectively.

### Contact

```js
await sock.sendContact(m.chat, [{
  name: 'Owner',
  number: '62812xxxxxxx',
  about: 'Creator'
}], m, {
  org: 'Nexray',
  website: 'https://example.com',
  email: 'a@b.com'
})
```

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

### `sendLivePhoto` thumbnail fix

**Bug:** when no `image` was supplied, `sendLivePhoto` extracted a preview frame from
the video with `extractVideoThumb(path, '00:00:00', ...)` — seeking to the *exact*
start of the file. On many encodes there is no decodable keyframe at that precise
offset, so ffmpeg returns an empty or corrupt buffer and the resulting image message
either fails to send or renders as a blank/broken thumbnail.

**Fix:** frame extraction now tries a short list of small forward offsets —
`00:00:01`, `00:00:00.5`, then `00:00:00` as a last resort — and keeps the first
**non-empty** buffer it gets back, instead of trusting a single attempt at the exact
start of the file:

```js
var offsets = ['00:00:01', '00:00:00.5', '00:00:00']
for (var i = 0; i < offsets.length; i++) {
  var buf = await extractVideoThumb(inputPath, offsets[i], { width: 640, height: 640 }).catch(() => null)
  if (buf && Buffer.isBuffer(buf) && buf.length > 0) return buf
}
```

In the common case this costs nothing extra — the first offset (`00:00:01`) succeeds
immediately on virtually all real-world video files, and the fallback chain only runs
when a frame genuinely fails to decode.

### `require('baileys')` hoisted to module scope

**Before:** `require('baileys')` was called *inside* several hot-path functions
(`getBaileys()` on every send call, and inside `Utils.getDevice`, `Utils.getStream`,
`Utils.toBuffer`, `Utils.getAudioWaveform` on every call), relying on Node's module
cache to make this cheap.

**After:** each file now resolves `baileys` exactly **once**, at module load, into a
top-level `baileys` binding:

```js
var baileys
try { baileys = require('baileys') } catch (_a) { baileys = null }
```

Per-socket overrides (`Client(sock, { baileys: myFork })`) still take priority and are
checked first — the module-level binding is only the fallback, so you can still swap
baileys builds per-socket without touching the require path.

### `hasNonNullishProperty` dispatch pattern

Added `Utils`-level `hasNonNullishProperty(obj, key)` (mirroring Baileys' own internal
guard) and switched every payload-shape dispatcher in `lib/helpers/message.js` — the
`sendAlbum` item normalizer/counter, `groupStatus`'s media dispatcher, and
`sendStatusMentions`'s payload dispatcher — from ad-hoc truthy checks
(`if (it.image)`) to explicit `else if (hasNonNullishProperty(it, 'image'))` chains.

### New send helpers

Four methods were added to close gaps in the poll family:

- **`sock.sendQuiz(jid, values, quoted?, opts)`** — newsletter-only quiz poll
  (`opts.correctAnswer` required).
- **`sock.sendPollResult(jid, name, votes, quoted?, opts?)`** — poll result snapshot
  card (`votes: [{ name, voteCount }]`).
- **`sock.sendQuizResult(jid, name, votes, quoted?, opts?)`** — same shape as
  `sendPollResult`, tagged as a quiz result card.
- **`sock.pollResult(jid, { name, votes: [{ name, count }] }, quoted?, opts?)`** —
  neoxr-compatible alias that wraps `sendPollResult`.

`sendPoll` itself was also extended to accept the full native option set
(`toAnnouncementGroup`, `endDate`, `hideVoter`, `canAddOption`) and the Baileys-native
positional call shape (`sendPoll(jid, [values], m, opts)`), in addition to the
neoxr-style options object it already supported.

---

## License

ISC
