# @nexray/lib

A lightweight, readable helper layer for Baileys-based WhatsApp applications.

`@nexray/lib` provides a small set of high-level socket helpers while keeping Baileys as the message-generation and media-processing engine. The library does not bundle Baileys and does not implicitly load it.

The public API is intentionally small:

```js
const { Client, Utils } = require('@nexray/lib')
```

ESM:

```js
import { Client, Utils } from '@nexray/lib'
```

---

## Table of Contents

- [Overview](#overview)
- [Design Principles](#design-principles)
- [Requirements](#requirements)
- [Installation](#installation)
- [Initialization](#initialization)
- [Engine Architecture](#engine-architecture)
- [Public API](#public-api)
- [Message Helpers](#message-helpers)
  - [sendText](#sendtext)
  - [sendImage](#sendimage)
  - [sendVideo](#sendvideo)
  - [sendAudio](#sendaudio)
  - [sendDocument](#senddocument)
  - [sendSticker](#sendsticker)
  - [sendAlbum](#sendalbum)
  - [sendInteractive](#sendinteractive)
  - [sendCarousel](#sendcarousel)
  - [sendMetaMsg](#sendmetamsg)
  - [sendAIRich](#sendairich)
  - [sendPoll](#sendpoll)
  - [sendQuiz](#sendquiz)
  - [sendPollResult](#sendpollresult)
  - [sendQuizResult](#sendquizresult)
  - [sendEvent](#sendevent)
  - [sendContact](#sendcontact)
  - [sendProduct](#sendproduct)
  - [sendLivePhoto](#sendlivephoto)
  - [sendThumbnailPreview](#sendthumbnailpreview)
  - [copyNForward](#copynforward)
- [Interactive Payload Reference](#interactive-payload-reference)
- [AI Rich Payload Reference](#ai-rich-payload-reference)
- [Media Handling](#media-handling)
- [Quoted Messages](#quoted-messages)
- [Mentions](#mentions)
- [Newsletter Annotation](#newsletter-annotation)
- [Utils](#utils)
- [Error Handling](#error-handling)
- [Error Codes](#error-codes)
- [Project Structure](#project-structure)
- [Compatibility](#compatibility)
- [Development](#development)
- [Changelog](#changelog)
- [License](#license)

---

## Overview

The library is designed for projects that already have a Baileys socket and want a clean helper layer around it.

The architecture follows three rules:

1. Baileys remains responsible for protocol-specific message generation.
2. `@nexray/lib` adds ergonomic helpers instead of reimplementing Baileys internals.
3. The socket receives helper methods without replacing the original Baileys API.

Example:

```js
const baileys = require('baileys')
const { Client } = require('@nexray/lib')

const sock = Client(rawSocket, {
  engines: [baileys]
})

await sock.sendText(
  '628123456789@s.whatsapp.net',
  'Hello from Nexray'
)
```

---

## Design Principles

### Readable source

The package is distributed as normal JavaScript. There is no intentional source obfuscation.

### Explicit Baileys engine

The package does not perform an implicit:

```js
require('baileys')
```

The consumer supplies the exact Baileys build that should be used.

### Thin wrappers

Media generation, protobuf generation and protocol-specific serialization remain delegated to the configured Baileys engine whenever the engine provides the required primitive.

### Consistent validation

Invalid arguments use `NexrayError` with a stable error code.

### Predictable payloads

High-level helpers normalize input into standard Baileys message structures before the message is relayed.

---

## Requirements

- Node.js 20 or newer
- A compatible Baileys build
- A connected Baileys socket
- `sharp` when image processing or thumbnail generation is required

The library itself does not establish a WhatsApp connection.

---

## Installation

Install the library:

```bash
npm install @nexray/lib
```

Install Baileys in the application:

```bash
npm install baileys
```

If the application uses another Baileys-compatible fork:

```bash
npm install <your-baileys-package>
```

The selected module must expose the Baileys primitives required by the helpers you use.

---

## Initialization

### CommonJS

```js
const baileys = require('baileys')
const { Client } = require('@nexray/lib')

const sock = Client(rawSocket, {
  engines: [baileys]
})
```

### ESM

```js
import baileys from 'baileys'
import { Client } from '@nexray/lib'

const sock = Client(rawSocket, {
  engines: [baileys]
})
```

### Options

```js
Client(sock, {
  engines: [baileys],
  messageIdPrefix: 'NEXRAY',
  stealth: null,
  newsletterAnnotation: null,
  autoFollowNewsletter: null
})
```

| Option | Type | Description |
|---|---|---|
| `engines` | `Array` | Baileys engine. The first entry is used. |
| `messageIdPrefix` | `string` | Prefix used by the local message ID helper. |
| `custom_id` | `string` | Alias of `messageIdPrefix`. |
| `stealth` | `string\|null` | Optional stealth identifier configuration. |
| `newsletterAnnotation` | `object\|null` | Default newsletter media annotation. |
| `autoFollowNewsletter` | `string\|string[]\|null` | Optional newsletter follow configuration. |

`engines` is required.

---

# Engine Architecture

The configured Baileys module is stored on:

```js
sock.__nexray.baileys
```

Internal helpers resolve Baileys primitives through the configured engine.

Examples include:

```js
generateWAMessage
generateWAMessageFromContent
prepareWAMessageMedia
getDevice
getStream
toBuffer
getAudioWaveform
```

This prevents the helper package from silently using a different Baileys version than the application.

---

# Public API

The public exports are:

```js
const {
  Client,
  Utils
} = require('@nexray/lib')
```

Internal modules under:

```text
lib/helpers/
lib/core/
lib/constant/
```

are implementation details.

---

# Message Helpers

## sendText

### Signature

```js
await sock.sendText(jid, text, quoted?, options?)
```

### Example

```js
await sock.sendText(
  '628123456789@s.whatsapp.net',
  'Hello world'
)
```

### With mention

```js
await sock.sendText(
  jid,
  `Hello @${sender.split('@')[0]}`,
  null,
  {
    mentions: [sender]
  }
)
```

### Options

```js
{
  mentions: ['628123456789@s.whatsapp.net'],
  mentionedJid: ['628123456789@s.whatsapp.net'],
  mentionAll: false,
  expiration: 0,
  linkPreview: true,
  contextInfo: {}
}
```

---

## sendImage

### Signature

```js
await sock.sendImage(jid, image, caption?, quoted?, options?)
```

### Payload

```js
await sock.sendImage(
  jid,
  './media/image.jpg',
  'Image caption',
  quotedMessage,
  {
    mentions: [],
    jpegThumbnail: null
  }
)
```

Supported media input:

```js
Buffer
```

```js
'./media/image.jpg'
```

```js
'https://example.com/image.jpg'
```

```js
{
  url: './media/image.jpg'
}
```

---

## sendVideo

### Signature

```js
await sock.sendVideo(jid, video, caption?, quoted?, options?)
```

### Example

```js
await sock.sendVideo(
  jid,
  './media/video.mp4',
  'Video caption',
  quotedMessage
)
```

Video options may include:

```js
{
  ptv: false,
  gifPlayback: false
}
```

---

## sendAudio

### Signature

```js
await sock.sendAudio(jid, audio, quoted?, options?)
```

Example:

```js
await sock.sendAudio(
  jid,
  './media/audio.mp3',
  quotedMessage,
  {
    ptt: true,
    mimetype: 'audio/ogg; codecs=opus'
  }
)
```

---

## sendDocument

### Signature

```js
await sock.sendDocument(jid, document, fileName?, quoted?, options?)
```

Example:

```js
await sock.sendDocument(
  jid,
  './files/document.pdf',
  'document.pdf',
  quotedMessage
)
```

---

## sendSticker

### Signature

```js
await sock.sendSticker(jid, sticker, quoted?, options?)
```

Example:

```js
await sock.sendSticker(
  jid,
  './media/sticker.webp',
  quotedMessage
)
```

Sticker conversion is delegated to the configured Baileys/media implementation where available.

---

## sendAlbum

### Signature

```js
await sock.sendAlbum(jid, items, quoted?, options?)
```

### Payload

```js
await sock.sendAlbum(jid, [
  {
    image: './media/one.jpg',
    caption: 'First image'
  },
  {
    image: './media/two.jpg',
    caption: 'Second image'
  },
  {
    video: './media/video.mp4',
    caption: 'Video'
  }
], quotedMessage)
```

An album requires at least two media items.

Each item can contain:

```js
{
  image: Buffer | string | { url: string },
  caption: string
}
```

or:

```js
{
  video: Buffer | string | { url: string },
  caption: string
}
```

---

# sendInteractive

`sendInteractive` creates a native-flow interactive message.

Aliases:

```js
sock.sendIAMessage
sock.sendButton
```

all point to the same implementation.

## Supported call forms

### Form 1

```js
await sock.sendInteractive(
  jid,
  buttons,
  quotedMessage,
  options
)
```

### Form 2

```js
await sock.sendInteractive(
  jid,
  message,
  options
)
```

where `message` is a Baileys message object and `options` contains the interactive payload.

### Form 3

```js
await sock.sendInteractive(
  jid,
  {
    text: 'Hello',
    footer: 'Footer',
    interactiveButtons: buttons
  },
  quotedMessage
)
```

---

# sendInteractive Payload

The following payload is supported directly:

```js
await sock.sendInteractive(remoteJid, message, {
  text:
    `Hello @${senderLid.split('@')[0]} 🫟,\n` +
    `Your devices I am ${global.bot_name}, a bot assistant ready to help you. ` +
    `To see all menus, send a message allmenu. I have been updated to version ${global.version}. ` +
    `Don't forget to contact the owner for rental or donations.\n\n` +
    `*Website* : ${global.API}\n` +
    `*Library* : @elrayyxml/baileys`,
  footer: global.footer,
  mentions: [senderLid],
  title: '© ' + global.bot_name + ' v' + global.version,
  media: {
    location: {
      degreesLatitude: 0,
      degreesLongitude: 0,
      name: '© ' + global.bot_name + ' v' + global.version,
      jpegThumbnail: './database/assets/allmenu.jpg'
    }
  },
  interactiveButtons: [
    {
      name: 'call_permission_request',
      buttonParamsJson: JSON.stringify({
        has_multiple_buttons: true
      })
    },
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: 'nexray api',
        url: 'https://api.nexray.eu.cc',
        merchant_url: 'https://api.nexray.eu.cc',
        has_multiple_buttons: true
      })
    },
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: 'nexray cdn',
        url: 'https://cdn.nexray.web.id',
        merchant_url: 'https://cdn.nexray.web.id',
        has_multiple_buttons: true
      })
    },
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: 'nexray code',
        url: 'https://code.nexray.web.id',
        merchant_url: 'https://code.nexray.web.id',
        has_multiple_buttons: true
      })
    },
    {
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: 'Next Page',
        sections: [
          {
            title: 'Main Menu',
            rows: [
              {
                title: 'Download',
                description: 'Media download commands',
                id: '.menu download'
              },
              {
                title: 'Tools',
                description: 'Utility tools',
                id: '.menu tools'
              },
              {
                title: 'Owner',
                description: 'Owner only commands',
                id: '.menu owner'
              },
              {
                title: 'Group',
                description: 'Group management',
                id: '.menu group'
              },
              {
                title: 'Fun',
                description: 'Fun & games',
                id: '.menu fun'
              }
            ]
          }
        ],
        has_multiple_buttons: true
      })
    }
  ],
  messageParamsJson: {
    limited_time_offer: {
      text: 'オートメーション',
      url: 'https://api.nexray.eu.cc',
      copy_code: 'elrayyxml',
      expiration_time: 1771649813289000
    },
    bottom_sheet: {
      in_thread_buttons_limit: 2,
      divider_indices: [1, 2, 3, 4, 5, 999],
      list_title: 'Select Menu',
      button_title: 'Tap Here'
    },
    tap_target_configuration: {
      title: 'elrayyxml',
      description: 'WhatsApp Bot library based on Baileys',
      canonical_url: 'https://instagram.com/elrayyxml',
      domain: 'https://api.nexray.eu.cc',
      button_index: 0
    }
  }
})
```

### Important media behavior

A native-flow interactive header accepts prepared media such as an image or video message.

The payload above uses:

```js
media.location.jpegThumbnail
```

The library treats this thumbnail as the visual header image.

It does not insert `locationMessage` into the interactive header because an interactive header is not a general-purpose location message container. Doing so can produce a message that is successfully relayed but has no visible media on the receiving client.

The thumbnail is therefore converted through Baileys:

```js
prepareWAMessageMedia({
  image: thumbnail
}, {
  upload: sock.waUploadToServer
})
```

and attached as:

```js
header: {
  title: '...',
  hasMediaAttachment: true,
  imageMessage: {
    ...
  }
}
```

This is the important distinction between a media payload being present in the JavaScript object and the media being a valid renderable interactive header.

---

# Interactive Buttons

## quick_reply

```js
{
  name: 'quick_reply',
  buttonParamsJson: JSON.stringify({
    display_text: 'OWNER',
    id: '.owner'
  })
}
```

## cta_url

```js
{
  name: 'cta_url',
  buttonParamsJson: JSON.stringify({
    display_text: 'Website',
    url: 'https://example.com',
    merchant_url: 'https://example.com'
  })
}
```

## cta_copy

```js
{
  name: 'cta_copy',
  buttonParamsJson: JSON.stringify({
    display_text: 'Copy',
    copy_code: 'NEXRAY'
  })
}
```

## cta_call

```js
{
  name: 'cta_call',
  buttonParamsJson: JSON.stringify({
    display_text: 'Call',
    phone_number: '628123456789'
  })
}
```

## single_select

```js
{
  name: 'single_select',
  buttonParamsJson: JSON.stringify({
    title: 'Select Menu',
    sections: [
      {
        title: 'Main Menu',
        rows: [
          {
            title: 'Download',
            description: 'Media download commands',
            id: '.menu download'
          },
          {
            title: 'Tools',
            description: 'Utility commands',
            id: '.menu tools'
          }
        ]
      }
    ]
  })
}
```

## send_location

```js
{
  name: 'send_location',
  buttonParamsJson: JSON.stringify({
    display_text: 'Share Location'
  })
}
```

## call_permission_request

```js
{
  name: 'call_permission_request',
  buttonParamsJson: JSON.stringify({
    has_multiple_buttons: true
  })
}
```

Unknown native-flow button names are not rewritten. Their `name` and JSON parameters are passed through.

---

# messageParamsJson

`messageParamsJson` can be supplied as an object:

```js
messageParamsJson: {
  limited_time_offer: {
    text: 'Promotion',
    url: 'https://example.com',
    copy_code: 'NEXRAY',
    expiration_time: 1771649813289000
  },
  bottom_sheet: {
    in_thread_buttons_limit: 2,
    divider_indices: [1, 2, 3, 4, 5, 999],
    list_title: 'Select Menu',
    button_title: 'Tap Here'
  }
}
```

or as a JSON string:

```js
messageParamsJson: JSON.stringify({
  bottom_sheet: {
    in_thread_buttons_limit: 2,
    divider_indices: [1, 2, 3, 4, 5, 999],
    list_title: 'Select Menu',
    button_title: 'Tap Here'
  }
})
```

Invalid JSON produces:

```text
NexrayError
code: INVALID_OPTIONS
message: messageParamsJson must contain valid JSON.
```

---

# Interactive media

## Image

```js
await sock.sendInteractive(jid, {
  text: 'Image header',
  footer: 'Nexray',
  media: './media/header.jpg',
  interactiveButtons: [
    {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Continue',
        id: 'continue'
      })
    }
  ]
})
```

## Remote image

```js
media: 'https://example.com/header.jpg'
```

## Buffer

```js
media: imageBuffer
```

## Video

```js
await sock.sendInteractive(jid, {
  text: 'Video header',
  media: './media/header.mp4',
  interactiveButtons: [
    {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Open',
        id: 'open'
      })
    }
  ]
})
```

The library automatically selects the video header when `options.video` is supplied.

---

# sendCarousel

### Signature

```js
await sock.sendCarousel(jid, cards, quoted?, options?)
```

### Payload

```js
await sock.sendCarousel(jid, [
  {
    image: './media/one.jpg',
    caption: 'Card One',
    buttons: [
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: 'Open',
          url: 'https://example.com'
        })
      }
    ]
  },
  {
    image: './media/two.jpg',
    caption: 'Card Two',
    buttons: [
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: 'Open',
          url: 'https://example.org'
        })
      }
    ]
  }
], quotedMessage, {
  content: 'Browse the cards',
  footer: 'Nexray'
})
```

Each card can contain:

```js
{
  image: Buffer | string | { url: string },
  media: Buffer | string | { url: string },
  caption: string,
  title: string,
  buttons: []
}
```

---

# sendMetaMsg

`sendMetaMsg` sends a WhatsApp AI Rich Response payload.

Alias:

```js
sock.sendAIRich
```

Both methods use the same implementation.

### Signature

```js
await sock.sendMetaMsg(jid, content, quoted?, options?)
```

---

# AI Rich Payload Reference

AI Rich Response is not a normal media message.

The protocol defines `AIRichResponseMessage` as a container with:

```text
messageType
submessages
unifiedResponse
contextInfo
```

The supported rich submessage types include text, inline images, grid images, tables, code, dynamic media and additional protocol-defined content types.

Because the protocol expects rich media metadata rather than a normal `imageMessage` attachment, placing:

```js
imageMessage: ...
```

inside an arbitrary rich-response object does not make the image render.

The library therefore uses the actual AI Rich image metadata structure for rich images.

---

## Text

```js
await sock.sendMetaMsg(jid, [
  {
    text: 'Hello from Nexray'
  }
])
```

Generated submessage:

```js
{
  messageType: 2,
  messageText: 'Hello from Nexray',
  inlineEntities: []
}
```

---

## Code

```js
await sock.sendMetaMsg(jid, [
  {
    code: {
      language: 'javascript',
      code: 'console.log("Hello World")'
    }
  }
])
```

Generated structure:

```js
{
  messageType: 5,
  codeMetadata: {
    codeLanguage: 'javascript',
    codeBlocks: [
      {
        highlightType: 0,
        codeContent: 'console.log("Hello World")'
      }
    ]
  }
}
```

---

## Table

```js
await sock.sendMetaMsg(jid, [
  {
    table: {
      title: 'Data',
      headers: ['Name', 'Value'],
      rows: [
        ['A', '100'],
        ['B', '200']
      ]
    }
  }
])
```

Generated structure:

```js
{
  messageType: 4,
  tableMetadata: {
    title: 'Data',
    rows: [
      {
        isHeading: true,
        items: ['Name', 'Value']
      },
      {
        isHeading: false,
        items: ['A', '100']
      },
      {
        isHeading: false,
        items: ['B', '200']
      }
    ]
  }
}
```

---

# AI Rich Image

Use an HTTP or HTTPS URL for an AI Rich image.

```js
await sock.sendMetaMsg(jid, [
  {
    image: 'https://example.com/image.jpg',
    imageText: 'Example image',
    tapLinkUrl: 'https://example.com'
  }
])
```

Generated structure:

```js
{
  messageType: 3,
  imageMetadata: {
    imageURL: {
      imagePreviewURL: 'https://example.com/image.jpg',
      imageHighResURL: 'https://example.com/image.jpg',
      sourceURL: 'https://example.com/image.jpg'
    },
    imageText: 'Example image',
    tapLinkUrl: 'https://example.com'
  }
}
```

This is an AI Rich image metadata payload.

It is different from:

```js
{
  imageMessage: {
    ...
  }
}
```

which belongs to a normal WhatsApp media message.

---

# AI Rich Dynamic Media

Dynamic media can be represented with:

```js
await sock.sendMetaMsg(jid, [
  {
    dynamic: {
      type: 1,
      version: 1,
      url: 'https://example.com/image.gif',
      loopCount: 0
    }
  }
])
```

Structure:

```js
{
  messageType: 6,
  dynamicMetadata: {
    type: 1,
    version: 1,
    url: 'https://example.com/image.gif',
    loopCount: 0
  }
}
```

Dynamic media type values depend on the Baileys/WhatsApp protocol version.

---

# AI Rich content object

Instead of an array, the helper also accepts:

```js
await sock.sendMetaMsg(jid, {
  headerText: 'Header',
  contentText: 'Main content',
  image: 'https://example.com/image.jpg',
  code: {
    language: 'javascript',
    code: 'console.log(1)'
  },
  table: {
    title: 'Data',
    headers: ['A', 'B'],
    rows: [
      ['1', '2']
    ]
  },
  footerText: 'Footer'
})
```

---

# Why AI Rich media can appear invisible

A normal Baileys media payload is generated using:

```js
prepareWAMessageMedia({
  image: {
    url: 'https://example.com/image.jpg'
  }
}, {
  upload: sock.waUploadToServer
})
```

The result contains an `imageMessage`.

AI Rich Response does not use that structure for its inline-image submessage.

AI Rich expects:

```js
{
  messageType: 3,
  imageMetadata: {
    imageURL: {
      imagePreviewURL: 'https://...',
      imageHighResURL: 'https://...',
      sourceURL: 'https://...'
    }
  }
}
```

Therefore a raw AI Rich message can be accepted by the server while an incorrectly embedded media object is ignored by the receiving client.

`@nexray/lib` now separates these two representations.

For URL-based rich images, use:

```js
{
  image: 'https://example.com/image.jpg'
}
```

For a normal local or buffered media attachment, use a standard media helper such as:

```js
sendImage()
```

or an interactive media header.

---

# sendAIRich

`sendAIRich` is an alias:

```js
sock.sendAIRich === sock.sendMetaMsg
```

Example:

```js
await sock.sendAIRich(jid, [
  {
    text: 'AI response'
  },
  {
    image: 'https://example.com/image.jpg',
    imageText: 'Preview'
  },
  {
    code: {
      language: 'javascript',
      code: 'const value = 42'
    }
  }
])
```

---

# Rich Response Options

```js
{
  botJid: '867051314767696@bot',
  disclaimerText: 'AI generated response',
  sources: [
    {
      title: 'Documentation',
      url: 'https://example.com',
      icon: 'https://example.com/icon.png'
    }
  ],
  quoted: quotedMessage,
  messageId: 'CUSTOM_ID',
  additionalNodes: []
}
```

---

# sendPoll

Supported call styles include:

```js
await sock.sendPoll(
  jid,
  ['Yes', 'No'],
  quotedMessage,
  {
    name: 'Do you like this library?',
    selectableCount: 1
  }
)
```

and:

```js
await sock.sendPoll(
  jid,
  'Do you like this library?',
  {
    options: ['Yes', 'No'],
    multiselect: false
  },
  quotedMessage
)
```

---

# sendQuiz

Newsletter quiz example:

```js
await sock.sendQuiz(
  '1211111111111@newsletter',
  [
    '✨ Yes',
    '💀 No'
  ],
  quotedMessage,
  {
    name: 'Quiz',
    correctAnswer: '✨ Yes'
  }
)
```

---

# sendPollResult

```js
await sock.sendPollResult(
  jid,
  'Poll Result',
  [
    {
      name: 'Option A',
      voteCount: 133
    },
    {
      name: 'Option B',
      voteCount: 18
    }
  ],
  quotedMessage
)
```

---

# sendQuizResult

```js
await sock.sendQuizResult(
  jid,
  'Quiz Result',
  [
    {
      name: 'Correct',
      voteCount: 133
    },
    {
      name: 'Wrong',
      voteCount: 18
    }
  ],
  quotedMessage
)
```

---

# sendEvent

```js
await sock.sendEvent(jid, {
  name: 'Community Meetup',
  description: 'Monthly sync',
  startDate: new Date(Date.now() + 86400000),
  endDate: new Date(Date.now() + 90000000),
  location: {
    degreesLatitude: -6.2,
    degreesLongitude: 106.8,
    name: 'Jakarta'
  },
  call: 'audio',
  isCancelled: false,
  extraGuestsAllowed: true,
  isScheduleCall: false
}, quotedMessage)
```

`startDate` is required.

Accepted date forms are:

```js
Date
```

ISO string:

```js
'2026-08-20T10:00:00.000Z'
```

or epoch milliseconds.

---

# sendContact

```js
await sock.sendContact(jid, [
  {
    name: 'Owner',
    number: '628123456789',
    about: 'Creator'
  }
], quotedMessage, {
  org: 'Nexray',
  website: 'https://example.com',
  email: 'owner@example.com'
})
```

Business contact:

```js
await sock.sendContact(jid, [
  {
    name: 'Owner',
    number: '628123456789',
    business: true,
    bizName: 'Nexray Bot',
    bizDescription: 'WhatsApp automation',
    title: 'Owner',
    region: 'Indonesia',
    email: 'owner@example.com',
    website: 'https://example.com'
  }
], quotedMessage)
```

---

# sendProduct

```js
await sock.sendProduct(jid, {
  image: './media/product.jpg',
  title: 'Nexray Product',
  productId: 'SKU-001',
  businessOwnerJid: '628123456789@s.whatsapp.net',
  caption: 'Product description',
  footer: 'Nexray',
  price: 150000,
  currencyCode: 'IDR',
  interactiveButtons: [
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: 'Open Website',
        url: 'https://example.com'
      })
    }
  ]
}, quotedMessage)
```

---

# sendLivePhoto

```js
await sock.sendLivePhoto(jid, {
  video: './media/video.mp4'
}, quotedMessage)
```

Optional still image:

```js
await sock.sendLivePhoto(jid, {
  video: './media/video.mp4',
  image: './media/cover.jpg'
}, quotedMessage)
```

When an image is omitted, the helper delegates thumbnail extraction to the configured Baileys engine.

---

# sendThumbnailPreview

```js
await sock.sendThumbnailPreview(
  jid,
  'Check this out',
  {
    title: 'Nexray',
    body: 'Example preview',
    url: 'https://example.com',
    thumbnail: './media/thumb.jpg',
    largeThumb: true,
    ratio: 'landscape',
    icon: './media/icon.png'
  },
  quotedMessage
)
```

---

# copyNForward

```js
await sock.copyNForward(jid, message)
```

Force-forward:

```js
await sock.copyNForward(jid, message, true)
```

---

# Media Handling

Baileys supports several media input forms.

## Buffer

```js
{
  image: imageBuffer
}
```

## Local path

```js
{
  image: './media/image.jpg'
}
```

## Remote URL

```js
{
  image: {
    url: 'https://example.com/image.jpg'
  }
}
```

The helper normalizes string media into:

```js
{
  url: media
}
```

and delegates preparation to:

```js
prepareWAMessageMedia()
```

The upload function is:

```js
sock.waUploadToServer
```

---

# Quoted Messages

Quoted messages can be supplied positionally:

```js
await sock.sendText(
  jid,
  'Reply',
  message
)
```

or through options:

```js
await sock.sendText(
  jid,
  'Reply',
  {
    quoted: message
  }
)
```

The helper builds the required quoted-message context before generating the outgoing message.

---

# Mentions

Example:

```js
await sock.sendInteractive(jid, {
  text: `Hello @${sender.split('@')[0]}`,
  mentions: [sender],
  interactiveButtons: [
    {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Continue',
        id: 'continue'
      })
    }
  ]
})
```

Supported aliases:

```js
mentions
mentionedJid
```

---

# Newsletter Annotation

Configure globally:

```js
Client(sock, {
  engines: [baileys],
  newsletterAnnotation: {
    newsletterJid: '1211111111111@newsletter',
    newsletterName: '@nexray',
    accessibilityText: '@nexray',
    contentType: 1,
    polygonVertices: [
      {
        x: 60.71664810180664,
        y: -36.39784622192383
      },
      {
        x: -16.710189819335938,
        y: 49.263675689697266
      },
      {
        x: -56.585853576660156,
        y: 37.85963439941406
      },
      {
        x: 20.840980529785156,
        y: -47.80188751220703
      }
    ]
  }
})
```

It can also be overridden per message through:

```js
{
  newsletterAnnotation: {
    ...
  }
}
```

---

# Utils

Import:

```js
const { Utils } = require('@nexray/lib')
```

## Utils.extend

```js
Utils.extend({
  formatRupiah(value) {
    return 'Rp' + Number(value).toLocaleString('id-ID')
  }
})

Utils.formatRupiah(50000)
```

Built-in methods are protected.

To explicitly override one:

```js
Utils.extend({
  formatBytes(value) {
    return String(value)
  }
}, {
  force: true
})
```

---

## Utility reference

```js
Utils.getDevice(id)
Utils.generateMessageID(prefix)
Utils.generateMessageIDV2(userId)

Utils.sleep(milliseconds)
Utils.delay(milliseconds)

Utils.formatBytes(bytes)
Utils.getRandom(extension)
Utils.pickRandom(array)

Utils.isUrl(value)
Utils.isURL(value)
Utils.isUrlValid(value)
Utils.isUrlInText(value)
Utils.extractLink(text)

Utils.toBuffer(input)
Utils.getStream(input)
Utils.getMimeType(input)
Utils.getAudioWaveform(buffer)

Utils.hasNonNullishProperty(object, key)

Utils.size(input, thresholdMB)
Utils.sharp(input)
Utils.random(array)
Utils.texted(format, text)
Utils.example(prefix, command, args)
Utils.jsonFormat(data)
```

---

# Error Handling

The package uses `NexrayError` for helper-level validation and engine errors.

Example:

```js
try {
  await sock.sendInteractive(jid, {
    text: 'Hello',
    interactiveButtons: []
  })
} catch (error) {
  console.error(error.name)
  console.error(error.code)
  console.error(error.message)
}
```

Example result:

```text
NexrayError
INVALID_OPTIONS
Interactive button parameters are invalid.
```

Errors intentionally use short, professional messages.

The message describes the failed validation or missing capability directly.

---

# Error Codes

| Code | Meaning |
|---|---|
| `ENGINE` | The configured Baileys engine is missing or does not expose a required primitive. |
| `INVALID_SOCKET` | The supplied socket is not a valid object. |
| `INVALID_JID` | A destination JID is required but was not provided. |
| `INVALID_OPTIONS` | The supplied options or payload are invalid. |
| `INVALID_MEDIA` | The supplied media input is empty or incompatible with the requested helper. |
| `MEDIA_DOWNLOAD` | A media download operation failed. |
| `MEDIA_PROCESS` | Media processing failed. |
| `RELAY_FAILED` | Message relay failed. |
| `NOT_IMPLEMENTED` | The configured Baileys engine does not expose the required feature. |

---

# Common Error Examples

## Missing engine

```text
NexrayError
ENGINE
No Baileys engine is configured.
```

Fix:

```js
const baileys = require('baileys')

Client(sock, {
  engines: [baileys]
})
```

## Missing JID

```text
NexrayError
INVALID_JID
sendInteractive requires a destination JID.
```

## Invalid button

```text
NexrayError
INVALID_OPTIONS
Interactive button 1 requires a name.
```

## Invalid JSON

```text
NexrayError
INVALID_OPTIONS
messageParamsJson must contain valid JSON.
```

## Missing media

```text
NexrayError
INVALID_MEDIA
prepareMedia: media input is empty
```

---

# Project Structure

```text
@nexray/
├── package.json
├── README.md
├── LICENSE
└── lib/
    ├── index.js
    ├── index.mjs
    │
    ├── constant/
    │   ├── index.js
    │   └── errors.js
    │
    ├── core/
    │   ├── index.js
    │   ├── client.js
    │   └── engine.js
    │
    ├── helpers/
    │   ├── index.js
    │   ├── context.js
    │   ├── generic.js
    │   ├── message.js
    │   ├── nodes.js
    │   ├── rich-message.js
    │   └── sticker.js
    │
    └── utils/
        ├── index.js
        ├── functions.js
        ├── media.js
        └── utils.js
```

---

# Internal Responsibilities

## `core/client.js`

Initializes the socket integration and registers the Baileys engine.

## `core/engine.js`

Resolves the configured Baileys engine and validates required primitives.

## `helpers/message.js`

Contains standard message helpers, media preparation, interactive messages, albums, polls, events and related send operations.

## `helpers/rich-message.js`

Builds AI Rich Response payloads and exposes:

```js
sendMetaMsg()
sendAIRich()
```

## `helpers/context.js`

Builds quoted-message and context metadata.

## `helpers/nodes.js`

Contains additional binary relay nodes required by specific message families.

## `utils/functions.js`

Contains small local utility functions and the explicit Baileys engine registry.

## `utils/media.js`

Provides thin wrappers around Baileys media primitives.

---

# Compatibility

The helper layer is intentionally dependent on the capabilities exposed by the configured Baileys engine.

A feature can only work when the selected engine provides the corresponding primitive and protocol support.

For example:

```js
prepareWAMessageMedia
```

is required for media-bearing interactive headers.

Likewise:

```js
generateWAMessageFromContent
```

is required for raw interactive message generation.

The library does not silently substitute incompatible implementations.

---

# Development

Clone the project:

```bash
git clone <repository-url>
cd @nexray
```

Install dependencies:

```bash
npm install
```

Syntax validation:

```bash
node --check lib/index.js
node --check lib/helpers/message.js
node --check lib/helpers/rich-message.js
```

A compatible Baileys package must be installed by the application or development environment when running integration tests.

---

# Recommended Integration Test

Use a real Baileys socket and test the following message families separately:

1. Text
2. Image
3. Video
4. Interactive without media
5. Interactive with image media
6. Interactive with location thumbnail
7. Interactive with `single_select`
8. Interactive with `cta_url`
9. Interactive with `messageParamsJson`
10. AI Rich text
11. AI Rich code
12. AI Rich table
13. AI Rich URL image
14. Poll
15. Album

For interactive media testing, inspect the generated payload before relay:

```js
const generated = await sock.sendInteractive(...)
console.dir(generated.message, {
  depth: null
})
```

The interactive header should contain:

```js
interactiveMessage: {
  header: {
    hasMediaAttachment: true,
    imageMessage: {
      ...
    }
  }
}
```

when an image header is supplied.

---

# Changelog

## 0.1.1

### Interactive media rendering

Fixed interactive headers that received:

```js
media: {
  location: {
    jpegThumbnail: './path/to/image.jpg'
  }
}
```

The thumbnail is now prepared as an `imageMessage` and attached to the interactive header.

The previous implementation inserted the location payload as `locationMessage` inside the interactive header. That structure is not a valid renderable media representation for native-flow headers, so the message could be relayed successfully while the visual media remained invisible.

### Interactive payload normalization

Improved support for:

```js
interactiveButtons
```

```js
messageParamsJson
```

```js
mentions
```

```js
quoted
```

and the call form:

```js
sendInteractive(jid, message, options)
```

JSON options are validated before relay.

### AI Rich Response

Improved AI Rich payload generation.

Added explicit support for:

```text
Text
Code
Table
Inline Image
Dynamic Media
```

AI Rich image payloads now use the protocol's image metadata representation instead of placing normal `imageMessage` data inside the rich-response container.

### Engine registration

`Client()` now registers the configured Baileys engine with the utility layer, allowing:

```js
Utils.getDevice()
Utils.getStream()
Utils.toBuffer()
Utils.getAudioWaveform()
```

to resolve the same engine configured for the socket.

### Error handling

Expanded the error-code registry and standardized validation errors.

---

# Protocol Notes

AI Rich Response and native-flow interactive messages are protocol-level WhatsApp message types.

They are not interchangeable with ordinary:

```js
text
image
video
document
```

payloads.

A payload being accepted by `relayMessage()` only proves that the stanza was submitted. It does not guarantee that every field is recognized as a renderable field by the receiving WhatsApp client.

For this reason, the helper deliberately distinguishes:

```text
Normal media message
Interactive media header
AI Rich image metadata
```

and builds each representation separately.

---

# License

ISC.
