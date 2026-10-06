## SIMPLICITY WHATSAPP BOT

> `@nexray/zapo` is a TypeScript connector for building WhatsApp bots on top of [zapo-js](https://www.npmjs.com/package/zapo-js). It creates and manages a WhatsApp connection, forwards sock events, serializes incoming and outgoing messages, loads optional plugins, and adds high-level helpers for common message types.

### Options

The following is the default configuration used when initializing a new Zapo connection. This setup is tailored for projects using this lib, and includes options for session management, plugin loading, and handling bot-specific behavior.

```Javascript
type SessionType = 'mongo' | 'postgres' | 'local' | 'mysql' | 'sqlite' | 'redis'

export interface ConnectionOpts {
   online?: boolean,
   presence?: boolean,
   stealth?: string,
   custom_id: string,
   pairing?: {
      state: boolean,
      number: string,
      code?: string
   },
   multiple?: boolean,
   create_session?: {
      type: SessionType,
      session: string,
      config?: any,
      number?: string | number,
      owner?: string | number
   },
   setting?: any,
   engines: any[],
   debug: boolean,
}
```

### Connection

Simple way to make connection. The constructor returns the socket directly and
opens the connection in the background; use `await sock.ready()` when the
caller needs the session to be online before continuing.

```Javascript
import { Client, Utils, Config } from '@nexray/zapo'

const sock = new Client({
   plugsdir: 'plugins',
   presence: true,
   online: true,
   pairing: {
      state: true, // Set to 'false' if you want to use QR scan
      number: '6285xxxxxxx', // Your bot number
      code: 'nexrayBOT' // If you want a custom pairing code, enter 8 alphanumeric characters
   },
   create_session: { type: 'sqlite', session: 'bot-session' },
   // stealth: 'ios', // Stealth mode to avoid bot detection, device list : ios, android, web, dekstop
   custom_id: 'nexray',
   engines: [store, voip], // Init store or voip
   debug: false // Set to 'true' if you want to see how this module works :v
})
```

### Plugins (`plugsdir`)

Every `.js` file inside the folder (recursively) is scanned. A module may export:

```Javascript
// zapo plugin definition or factory
export default defineWaClientPlugin({ ... })

// simple run(ctx)
export async function run(ctx) { ... }

// bot-style plugin: Commands drive the presence gate
export default {
   handle,
   Commands: ['runtime', 'rt'],
   OnlyPremium: false,
   OnlyOwner: false,
}
```

`Commands` is collected per module. With `presence: true`, read receipts and the
"typing" chat-state only fire when the message matches a registered command —
plain chat no longer triggers presence. Matching supports any mix of prefixes:

```Javascript
const sock = new Client({
   plugsdir: 'plugins',              // Commands: ['runtime', 'rt'] collected automatically
   prefix: ['.', '!', '#'],          // multiple prefixes
   // requirePrefix: true,           // uncomment to reject bare commands
   presence: true,
   custom_id: 'nexray',
   create_session: { type: 'sqlite', session: 'bot-session' },
})
```

| Message | `prefix` set | `requirePrefix` | Presence |
| --- | --- | --- | --- |
| `.runtime` | `['.','!','#']` | – | yes |
| `!rt` | `['.','!','#']` | – | yes |
| `runtime` | `['.','!','#']` | – | yes (no-prefix allowed) |
| `runtime` | `['.','!','#']` | `true` | no |
| `.unknown` | `['.','!','#']` | – | no (not in `Commands`) |
| `halo` | `['.','!','#']` | – | no |

Use `Utils.matchCommand(text, commands, { prefixes, requirePrefix })` to run the
same check inside your own handler.

### Handling Events (Built-in)

Built-in adapter events are available on both the client instance and the
socket helper: `sock.on(...)` is forwarded to the adapter emitter, while raw
zapo events stay on `sock.ev.on(...)`.

```Javascript
sock.on('connect', () => console.log)
sock.on('error', error => console.log(error))
sock.on('ready', () => console.log)
sock.on('stories', ctx => console.log(ctx))
sock.on('message', ctx => console.log(ctx))
sock.on('message.delete', ctx => console.log(ctx))
sock.on('group.add', ctx => console.log(ctx))
sock.on('group.remove', ctx => console.log(ctx))
sock.on('group.promote', ctx => console.log(ctx))
sock.on('group.demote', ctx => console.log(ctx))
sock.on('group.request', ctx => console.log(ctx))
sock.on('presence', ctx => console.log(ctx))
```

### Event Piping (Pipelining)

You can also use the default events from Zapo.

```Javascript
sock.ev.on('voip_call_incoming', (update) => console.log(update))
sock.ev.on('voip_call_state', (update) => console.log(update))
sock.ev.on('voip_call_ended', (update) => console.log(update))
sock.ev.on('voip_call_error', (update) => console.log(update))
sock.ev.on('voip_call_outbound_audio_finished', (update) => console.log(update))
sock.ev.on('voip_call_inbound_video', (update) => console.log(update))
sock.ev.on('voip_call_inbound_video_rtp', (update) => console.log(update))
sock.ev.on('message', (update) => console.log(update))
sock.ev.on('message_send', (update) => console.log(update))
sock.ev.on('message_addon', (update) => console.log(update))
sock.ev.on('message_protocol', (update) => console.log(update))
sock.ev.on('message_bot_chunk', (update) => console.log(update))
sock.ev.on('message_unavailable', (update) => console.log(update))
sock.ev.on('receipt', (update) => console.log(update))
sock.ev.on('presence', (update) => console.log(update))
sock.ev.on('chatstate', (update) => console.log(update))
sock.ev.on('call', (update) => console.log(update))
sock.ev.on('group', (update) => console.log(update))
sock.ev.on('newsletter', (update) => console.log(update))
sock.ev.on('newsletter_message_update', (update) => console.log(update))
sock.ev.on('business', (update) => console.log(update))
sock.ev.on('picture', (update) => console.log(update))
sock.ev.on('privacy', (update) => console.log(update))
sock.ev.on('blocklist', (update) => console.log(update))
sock.ev.on('own_username', (update) => console.log(update))
sock.ev.on('mutation', (update) => console.log(update))
sock.ev.on('mutation_send', (update) => console.log(update))
sock.ev.on('history_sync_chunk', (update) => console.log(update))
sock.ev.on('group_history_bundle', (update) => console.log(update))
sock.ev.on('offline_resume', (update) => console.log(update))
sock.ev.on('offline_thread_metadata', (update) => console.log(update))
sock.ev.on('mex_notification', (update) => console.log(update))
sock.ev.on('stream_failure', (update) => console.log(update))
sock.ev.on('stanza_error', (update) => console.log(update))
```

### Message Metadata

```Javascript
{
   rawNode: {
      tag: 'message',
      attrs: {
         from: '120363418787692501@g.us',
         type: 'text',
         id: 'A512151D2087CBD787C23C1129D69EE5',
         participant: '8792385306797@lid',
         sts: '1790580592042831',
         offline: '0',
         verified_level: 'high',
         notify: 'nexray Creative',
         addressing_mode: 'lid',
         expiration: '86400',
         verified_name: '4892374714914454331',
         participant_pn: '6285887776722@s.whatsapp.net',
         t: '1790580591'
      },
      content: [
         [Object],
         [Object],
         [Object],
         [Object]
      ]
   },
   key: {
      remoteJid: '120363418787692501@g.us',
      id: 'A512151D2087CBD787C23C1129D69EE5',
      fromMe: false,
      isGroup: true,
      isBroadcast: false,
      isNewsletter: false,
      participantAlt: '6285887776722@s.whatsapp.net',
      senderDevice: 0,
      participant: '8792385306797@lid'
   },
   stanzaType: 'text',
   offline: true,
   timestampSeconds: 1790580591,
   expirationSeconds: 86400,
   pushName: 'nexray Creative',
   message: e {
      extendedTextMessage: e {
         endCardTiles: [],
         text: '=> m',
         previewType: 0,
         contextInfo: [e],
         inviteLinkGroupTypeV2: 0
      },
      messageContextInfo: e {
         threadId: [],
         messageSecret: [Uint8Array],
         botMetadata: [e]
      }
   },
   id: 'A512151D2087CBD787C23C1129D69EE5',
   isBot: false,
   fromMe: false,
   chat: '120363418787692501@g.us',
   sender: '6285887776722@s.whatsapp.net',
   isGroup: true,
   mtype: 'extendedTextMessage',
   quoted: null,
   mentionedJid: [],
   expiration: 86400,
   text: '=> m',
   reply: [Function(anonymous)],
   react: [AsyncFunction(anonymous)],
   download: [AsyncFunction(anonymous)]
}
```
### Messaging Function

```Javascript
// declaration variable sock

// send a text message (auto tagged)
sock.reply(m.chat, `Test!`, m)

// send a react message
sock.sendReact(m.chat, `💀`, m.key)

// send a ptv message (round video note, duration up to 1 minute)
sock.sendFile(m.chat, './media/video/yemete.mp4', '', '', m, {
   ptv: true
})

// send a text message with custom ad-reply thumbnail
// (contextInfo.externalAdReplyInfo, tap opens `url`)
sock.sendMessageModify(m.chat, `Test!`, m, {
   title: '© nexray-bot',
   largeThumb: true,
   ads: false,
   /* can buffer or url */
   thumbnail: 'https://iili.io/HP3ODj2.jpg',
   url: 'https://chat.whatsapp.com/HYknAquOTrECm9KPJJQO1V'
})

// send a text message with a custom link preview
// (extendedTextMessage + matchedText, built from `url`)
sock.sendMessageModify(m.chat, `Test!`, m, {
   title: '© nexray-bot',
   largeThumb: true,
   type: 'preview-link',
   /* choose: landscape (default), portrait, square */
   ratio: 'landscape',
   /* can buffer or url */
   thumbnail: 'https://iili.io/HP3ODj2.jpg',
   url: 'https://chat.whatsapp.com/HYknAquOTrECm9KPJJQO1V'
})

// send a file from path, url, or buffer (auto extension)
sock.sendFile(m.chat, 'https://iili.io/HP3ODj2.jpg', 'image.jpg', 'Test!', m)

// send a document from path, url, or buffer (auto extension)
sock.sendFile(m.chat, 'https://iili.io/HP3ODj2.jpg', 'image.jpg', 'Test!', m, {
   document: true
})

// send a photo live (motion photo) from path, url, or buffer (video)
// thumbnail is optional (Buffer | URL | Path) for the preview frame
sock.sendFile(m.chat, 'https://cdn.videy.co/7QUk0zRO1.mp4', 'video.mp4', 'Test!', m, {
   photo_live: true,
   thumbnail: './media/photo.jpg'
})

// send a voicenote from path, url, or buffer
sock.sendFile(m.chat, './media/audio/ah.mp3', '', '', m, {
   ptt: true
})

// send a audio from path, url, or buffer with thumbnail in audio tag
sock.sendFile(m.chat, './media/audio/ah.mp3', '', '', m, {
   audio_tag: {
      APIC: < Buffer >
   }
})

// send a sticker message from url or buffer
sock.sendSticker(m.chat, 'https://iili.io/HP3ODj2.jpg', m, {
   packname: 'Sticker by',
   author: '© nexray.js'
})

// send an AI sticker message from url or buffer
sock.sendSticker(m.chat, 'https://iili.io/HP3ODj2.jpg', m, {
   packname: 'Sticker by',
   author: '© nexray.js',
   meta: true
})

// send a lock sticker from url or buffer
sock.sendSticker(m.chat, 'https://iili.io/HP3ODj2.jpg', m, {
   packname: 'Sticker by',
   author: '© nexray.js',
   lock: true
})

// send a premium sticker message from url or buffer
sock.sendSticker(m.chat, 'https://iili.io/HP3ODj2.jpg', m, {
   packname: 'Sticker by',
   author: '© nexray.js',
   premium: true
})

// send poll result
sock.pollResult(m.chat, {
   name: 'Demo Poll Result',
   votes: [{
      name: 'Jokowi',
      count: 1500
   }, {
      name: 'Prabowo',
      count: 200
   }]
}, m)

// send contact message
sock.sendContact(m.chat, [{
   name: 'Wildan Izzudin',
   number: '6285887776722',
   about: 'Owner & Creator'
}], m, {
   org: 'nexray Network',
   website: 'https://api.nexray.my.id',
   email: 'contact@nexray.my.id'
})

// send interactive button message (your own risk)
var buttons = [{
   name: "quick_reply",
   buttonParamsJson: JSON.stringify({
      display_text: "OWNER",
      id: '.owner'
   }),
}, {
   name: "cta_url",
   buttonParamsJson: JSON.stringify({
      display_text: "Rest API",
      url: "https://api.nexray.my.id",
      merchant_url: "https://api.nexray.my.id"
   })
}, {
   name: "cta_copy",
   buttonParamsJson: JSON.stringify({
      display_text: "Copy",
      copy_code: "123456"
   })
}, {
   name: "cta_call",
   buttonParamsJson: JSON.stringify({
      display_text: "Call",
      phone_number: "6285887776722"
   })
}, {
   name: "single_select",
   buttonParamsJson: JSON.stringify({
      title: "Tap!",
      sections: [{
         rows: [{
            title: "Owner",
            description: `X`,
            id: `.owner`
         }, {
            title: "Runtime",
            description: `Y`,
            id: `.run`
         }]
      }]
   })
}]

// button & list
sock.replyButton(m.chat, buttons, m, {
   header: '',
   content: 'Hi!',
   // v2: true, (for product style with image)
   type: 'interactive',
   footer: '',
   media: global.db.setting.cover // video or image link
})

// button & list (multiple)
sock.replyButton(m.chat, buttons, m, {
   header: '',
   content: 'Hi!',
   // v2: true, (for product style with image)
   footer: '',
   media: global.db.setting.cover, // video or image link
   multiple: {
      name: 'オートメーション',
      code: 'nexray-bot',
      list_title: 'Select Menu',
      button_title: 'Tap Here!'
   },
   type: 'interactive'
})

// carousel message
const cards = [{
   header: {
      image: global.db.setting.cover,
      hasMediaAttachment: true,
   },
   body: {
      text: "P"
   },
   nativeFlowMessage: {
      buttons: [{
         name: "cta_url",
         buttonParamsJson: JSON.stringify({
            display_text: 'Contact Owner',
            url: 'https://api.nexray.eu',
            webview_presentation: null
         })
      }]
   }
}, {
   header: {
      image: global.db.setting.cover,
      hasMediaAttachment: true,
   },
   body: {
      text: "P"
   },
   nativeFlowMessage: {
      buttons: [{
         name: "cta_url",
         buttonParamsJson: JSON.stringify({
            display_text: 'Contact Owner',
            url: 'https://api.nexray.eu',
            webview_presentation: null
         })
      }]
   }
}]

sock.replyButton(m.chat, [], m, {
   title: global.header,
   type: 'interactive',
   content: 'Hi! @0',
   cards
})

// send old button all type
var buttons = [{
   text: 'Runtime',
   command: '.runtime'
}, {
   text: 'Statistic',
   command: '.stat'
}]

// button text
sock.replyButton(m.chat, buttons, m, {
   text: 'Hi @0',
   footer: global.footer // do not empty
})

// button image & video
sock.replyButton(m.chat, buttons, m, {
   text: 'Hi @0', // do not empty
   footer: global.footer, // do not empty
   media: global.db.setting.cover // video or image link
})

// button document
sock.replyButton(m.chat, buttons, m, {
   text: 'Hi @0', // do not empty
   footer: global.footer, // do not empty
   media: global.db.setting.cover, // file link (all extension)
   document: {
      filename: 'nexray.jpg'
   }
})

// button location
sock.replyButton(m.chat, buttons, m, {
   text: 'Hi @0', // do not empty
   footer: global.footer, // do not empty
   media: global.db.setting.cover, // file link (all extension)
   location: {
      name: global.header,
      description: 'オートメーション'
   }
})

// old button + native flow
sock.replyButton(m.chat, [{
   text: 'Runtime',
   command: '.runtime'
}, {
   name: 'single_select',
   params: {
      title: 'Tap!',
      sections: [{
         rows: [{
            title: 'Runtime',
            description: '---',
            id: '.runtime'
         }, {
            title: 'Statistic',
            description: '---',
            id: '.stat'
         }]
      }]
   }
}], m, {
   text: 'Hi @0', // do not empty
   footer: global.footer, // do not empty
   media: global.db.setting.cover // video or image link
})

// send album message (parent albumMessage + child association MEDIA_ALBUM)
sock.sendAlbumMessage(m.chat, [{
   url: 'https://i.pinimg.com/736x/6f/a3/6a/6fa36aa2c367da06b2a4c8ae1cf9ee02.jpg',
   caption: 'Content 1st', // optional
   type: 'image' // optional
}, {
   url: 'https://i.pinimg.com/736x/0b/97/6f/0b976f0a7aa1aa43870e1812eee5a55d.jpg',
   caption: 'Content 2nd', // optional
   type: 'image' // optional
}, {
   url: 'https://i.pinimg.com/736x/8c/6d/db/8c6ddb5fe6600fcc4b183cb2ee228eb7.jpg',
   caption: 'Content 2nd', // optional
   type: 'image' // optional
}], m)

// send group status (video & image; mime decides the kind)
sock.groupStatus(m.chat, {
   media: 'https://i.pinimg.com/736x/0b/97/6f/0b976f0a7aa1aa43870e1812eee5a55d.jpg', // Support URL and Buffer
   caption: 'Hi!'
})

// send group status (audio)
sock.groupStatus(m.chat, {
   media: 'https://example.com/audio.mp3' // Support URL and Buffer
})

// send group status (text)
sock.groupStatus(m.chat, {
   text: 'Hi!'
})

// send group status (close friends)
sock.groupStatus(m.chat, {
   text: 'Hi!'
}, {
   private: true
})

// send group status (instant)
sock.groupStatus(m.chat, m.quoted.fakeObj, {
   private: true
})

// send meta message v1 (rich message)
sock.sendMetaMsg(m.chat, [{
      text: `Hi @${m.sender.replace(/@.+/, '')} ✨, This is an example of a simple meta message that supports *mentions*, *tables* and *code format*.\n\nAnd below is an example of the code format.`
   },
   {
      code: {
         language: 'javascript',
         code: fs.readFileSync('./error.js', 'utf-8')
      }
   },
   {
      text: `And this is an example of a table.`
   },
   {
      table: {
         title: 'Data',
         headers: ['Code', 'Artist'],
         rows: [
            ['SSID-738', 'Yua Mikami'],
            ['RTXU-849', `@${m.sender.replace(/@.+/, '')}`]
         ]
      }
   }, {
      text: 'You can add text, tables, and code formats as you like. 😎'
   },], m, {
      title: global.header,
      mentions: [m.sender]
})

// send meta message v2 (rich message)
sock.sendMetaMsg(m.chat, [
   {
      text: `This is an example of a meta message that does not support *~mentions~* and *~tables~*, but has many variations. Such as citations [](https://api.nexray.eu) and links [nexray API](https://api.nexray.eu).\n\nCode formatting can still works :`
   },
   {
      code: {
         language: 'javascript',
         code: fs.readFileSync('./error.js', 'utf-8')
      }
   },
   {
      muted: 'There is also muted text like this.'
   },
   {
      suggestions: ['N', 'E', 'O', 'X', 'R', 'B', 'O', 'T']
   },
   {
      sources: [{
         icon: 'https://i.pinimg.com/736x/b4/e0/12/b4e012b9e55bc101eb2c89655888e2f1.jpg',
         title: 'Github',
         url: 'https://github.com/nexray/nexray-bot'
      }]
   }], m, {
   title: global.header
})

// send meta message v3 (rich message)
sock.sendMetaMsg(m.chat, [
   {
      text: 'Photo and video media messages are supported, however, they do not support *~mentions~* and *~tables~*.\n\n---\n\nHere is an example of a reel:'
   },
   {
      reels: [
         'https://i.pinimg.com/736x/48/58/17/485817189f76066e8b22637d1310d3b4.jpg',
         'https://i.pinimg.com/736x/0e/32/e3/0e32e35b0324a541ba7fe705330febde.jpg',
         'https://i.pinimg.com/736x/88/78/b1/8878b18952e3587dd5c7502f35155731.jpg'
      ].map(image => ({
         creator: 'nexray Creative',
         avatar: 'https://avatars.githubusercontent.com/u/52621597?v=4',
         verified: true,
         thumbnail: image,
         url: 'https://api.nexray.eu',
         source: 'IG'
      }))
   },
   {
      text: '\n\n---\n\nHere is an example of a social media post:'
   },
   {
      posts: [{
         media: 'https://i.pinimg.com/736x/ba/fd/92/bafd92cf5c8fbd802cf59c51286fc13f.jpg',
         caption: '하늘이 무너져도 솟아날 구멍은 있다는데, 난 그냥 그 구멍으로 들어가서 낮잠 잘래.',
         source: 'FACEBOOK'
      }, {
         media: 'https://i.pinimg.com/1200x/ec/0a/fd/ec0afd363645fa73d9d17df1136fddd4.jpg',
         caption: '냉장고랑 진지하게 대화했다. 걔는 자꾸 불빛을 깜빡이며 나한테 우주적 신호를 보내는 것 같아.',
         source: 'THREADS'
      }, {
         media: 'https://i.pinimg.com/736x/53/dd/f9/53ddf9fcf881b704548f2b6c676b07a6.jpg',
         caption: '어제 먹은 떡볶이가 사실 내 전생일지도 몰라. 쫄깃한 인생.',
         source: 'INSTAGRAM'
      }].map(v => ({
         username: 'nexray Creative',
         avatar: 'https://avatars.githubusercontent.com/u/52621597?v=4',
         verified: true,
         caption: v.caption,
         url: 'https://api.nexray.eu',
         thumbnail: v.media,
         source: v.source,
         post_type: 'PHOTO'
      }))
   },
   {
      text: '\n\n---\n\nHere is an example of a non-slide product:\n\n'
   },
   {
      products: {
         title: 'Script Selfbot (WhatsApp Bot) [Free Update]',
         image: 'https://imgkub.com/images/2026/01/14/image586735a7ca2a894a.jpg',
         sale_price: 'Rp. 65.000',
         brand: 'nexray Creative',
         url: `https://wa.me/${Config.owner}`
      }
   },
   {
      text: '\n'
   },
   {
      products: {
         title: 'Payment Gateway',
         image: 'https://imgkub.com/images/2026/01/22/image7af565014aadeae6.jpg',
         sale_price: 'Rp. 80.000',
         brand: 'nexray Creative',
         url: `https://wa.me/${Config.owner}`
      }
   },
   {
      text: '\n\n---\n\nHere is an example of a slide product:'
   },
   {
      products: [{
         title: 'Script Premium (WhatsApp Bot) V5.1-Optima',
         image: 'https://imgkub.com/images/2025/12/07/image6e1f9b94ba9ced64.jpg',
         sale_price: 'Rp. 150.000'
      }, {
         title: 'Script E-Commerce (NeoCommerce)',
         image: 'https://imgkub.com/images/2025/12/07/image42981ad8a7441ff7.jpg',
         price: 'Rp. 175.000',
         sale_price: 'Rp. 150.000'
      }, {
         title: 'Script Selfbot (WhatsApp Bot)',
         image: 'https://imgkub.com/images/2026/01/14/image3b73a38fbc0a64c6.jpg',
         sale_price: 'Rp. 55.000'
      }, {
         title: 'Temporary Uploader & URL Shortener',
         image: 'https://imgkub.com/images/2025/12/13/imagef7b7c40836e6b3d2.jpg',
         sale_price: 'Rp. 60.000'
      }].map(v => ({
         ...v,
         brand: 'nexray Creative',
         url: `https://wa.me/${Config.owner}`
      }))
   }], m, {
   title: global.header
})
```

### Meta Message Notes

- Rich response media must be a **URL**; a buffer is uploaded first
  (`image`, `video`, reel/post thumbnails, source icons). Without a URL the
  media is dropped by the proto and never shown.
- `title` is rendered as the first text submessage.
- `suggestions` is sent as empty dynamic metadata — WhatsApp fills the chips
  server-side.
- `products` is rendered as price text (with `brand` and `url`), because
  `AIRichResponseSubMessageType` has no product type.
- `deep: true` sends submessages through the `botForwardedMessage` ->
  `richResponseMessage` wrapper with bot-forward attributes (`forwardOrigin: 4`,
  default `botJid 867051314767696@bot`, override with `botJid`).

### Interactive Notes

- `replyButton` interactive mode automatically attaches the `<biz>` native-flow
  node required by group chats; without it the server rejects the stanza with
  SMAX_INVALID (479).
- `options.customNodes` (array of raw nodes) is forwarded verbatim for any
  protocol feature the typed helpers do not cover.

### Group Status Notes

- Content is wrapped in `groupStatusMessageV2` — the same wrapper real clients
  send; zapo descends into this wrapper when resolving the stanza type.
- The group is attached as a mention via `contextInfo.groupMentions`, so the
  caption stays exactly as typed.
- `media` kind is detected from its mimetype: video or image (audio is not a
  supported group status kind).
- `background` / `color` on text status are **not supported**: colored status
  text lives in `ConsumerApplication.StatusTextMesage`, which is not reachable
  through `Proto.Message` in zapo. Use `profile.setTextStatus` for the modern
  emoji + text status instead.
- Close friends is selected with `{ private: true }` (mapped to zapo
  `statusSetting: 'close_friends'`); `private.name` / `private.emoji` are ignored.

### Exclusive Message

This feature can be enabled simply by adding the `{ exclusive: true }` parameter. It allows messages to be sent within a group, but the message can only be seen by the sender. Other members of the group cannot see it.


```Javascript
sock.reply(m.chat, 'Hi, this message can only be seen by you.', m, { exclusive: true })
```

The `m` (quoted message) parameter is required and must always be provided when
using this feature. The content is wrapped in a `deviceSentMessage` addressed to
the sender in `m`, so only that device renders it. Text and media are supported;
other content types (poll, reaction, button) throw.