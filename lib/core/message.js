/** @module core/message */

import path from 'path';
// file-type v16 ekspor default { fromBuffer, fromFile }; v22 named exports.
import * as ftModule from 'file-type';
const ftFromBuffer = ftModule.fileTypeFromBuffer ?? ftModule.default?.fromBuffer;
const ftFromFile = ftModule.fileTypeFromFile ?? ftModule.default?.fromFile;
import mimeTypes from 'mime-types';
import webpmux from 'node-webpmux';
import nodeid3 from 'node-id3';
import { toBytes } from '../utils/converter.js';

/**
 * Bungkus webp stiker dengan exif `sticker-pack-*`. Tanpa exif stiker tetap
 * terkirim tapi tanpa nama pack.
 *
 * @param {Uint8Array|Buffer} bytes webp
 * @param {string} [packname]
 * @param {string} [author]
 * @returns {Promise<Uint8Array|Buffer>}
 */
async function addStickerExif(bytes, packname, author) {
  if (!packname && !author) return bytes;
  try {
    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    const json = Buffer.from(
      JSON.stringify({
        'sticker-pack-id': 'nexray-zapo',
        'sticker-pack-name': packname ?? '',
        'sticker-pack-publisher': author ?? '',
      }),
      'utf-8',
    );
    const img = new webpmux.Image();
    await img.load(bytes);
    img.exif = Buffer.concat([exifAttr, json]);
    return await img.save(null);
  } catch {
    return bytes; // Bukan webp / libwebp gagal muat -> kirim tanpa exif.
  }
}

/** Tulis tag APIC (cover) ke mp3; format non-ID3 dikirim apa adanya. */
function applyAudioTag(bytes, { title, artist, APIC }) {
  try {
    return nodeid3.write({ title, artist, APIC }, Buffer.from(bytes));
  } catch {
    return bytes;
  }
}

/**
 * Ambil byte atau stream dari path/url/buffer/stream.
 *
 * @param {*} source
 * @returns {Promise<{bytes: Uint8Array|Buffer|null, stream: object|null}>}
 */
export async function resolveMediaInput(source) {
  if (source == null) return { bytes: null, stream: null };
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return { bytes: source, stream: null };
  if (source instanceof ArrayBuffer) return { bytes: new Uint8Array(source), stream: null };
  if (typeof source === 'string' || source?.url) {
    return { bytes: await toBytes(typeof source === 'string' ? source : source.url), stream: null };
  }
  if (source.stream) return { bytes: null, stream: source.stream };
  return { bytes: await toBytes(source), stream: null };
}

/**
 * Deteksi mimetype via file-type, lalu mime-types dari nama file.
 *
 * @param {Uint8Array|Buffer|null} bytes
 * @param {string} [filename]
 * @returns {Promise<{mime: string|null, ext: string}>}
 */
export async function detectExtAndMime(bytes, filename = '') {
  let mime = null;
  if (bytes) {
    try {
      mime = (await ftFromBuffer(bytes))?.mime ?? null;
    } catch {
      mime = null;
    }
  }
  if (!mime && filename) mime = mimeTypes.lookup(filename) || null;

  const ext = path.extname(filename || '').replace('.', '');
  return { mime, ext: ext || (mime ? mimeTypes.extension(mime) || '' : '') };
}

/** Opsi adapter yang tidak boleh diteruskan ke sendMessage. */
const stripOptions = (options, keys) => {
  const out = { quoted: options.message, ...options };
  for (const key of keys) delete out[key];
  return out;
};

/**
 * Balas pesan (teks atau media) dengan quote otomatis.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {string|object} content
 * @param {object} [message] ctx pesan yang dikutip
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export function reply(sock, chat, content, message, options = {}) {
  const own = typeof content === 'string' ? { text: content } : content;
  return sock.sendMessage(chat, own, { quoted: message, ...options });
}

/** Kirim reaksi. */
export function sendReact(sock, chat, emoji, key) {
  return sock.sendMessage(chat, { react: { text: emoji, key } });
}

/**
 * Kirim file dari path/url/buffer, jenis dideteksi dari mimetype.
 * Opsi: ptt, document, photo_live, audio_tag, caption, mime.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {*} source
 * @param {string} [filename]
 * @param {string} [caption]
 * @param {object} [message]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function sendFile(
  sock,
  chat,
  source,
  filename = '',
  caption = '',
  message = null,
  options = {},
) {
  const { bytes, stream } = await resolveMediaInput(source);
  const { mime, ext } = await detectExtAndMime(bytes, filename);

  let resolvedName = filename || (ext ? `file.${ext}` : 'file');
  if (!path.extname(resolvedName) && ext) resolvedName += `.${ext}`;

  const media = bytes ?? stream;
  const captionText = options.caption ?? caption;
  const content = {};

  if (options.document) {
    content.document = media;
    content.mimetype = options.mime ?? mime ?? 'application/octet-stream';
    content.fileName = resolvedName;
    if (captionText) content.caption = captionText;
  } else if (options.ptt) {
    content.audio = media;
    content.mimetype = options.mime ?? mime ?? 'audio/ogg; codecs=opus';
    content.ptt = true;
  } else if (options.photo_live) {
    content.video = media;
    content.mimetype = options.mime ?? mime ?? 'video/mp4';
    content.viewOnce = true;
    if (captionText) content.caption = captionText;
  } else if (options.audio_tag) {
    content.audio = applyAudioTag(media, options.audio_tag);
    content.mimetype = options.mime ?? mime ?? 'audio/mpeg';
  } else {
    const m = options.mime ?? mime ?? '';
    if (m.startsWith('image/') || m.startsWith('video/')) {
      content[m.startsWith('image/') ? 'image' : 'video'] = media;
      if (captionText) content.caption = captionText;
    } else if (m.startsWith('audio/')) {
      content.audio = media;
      content.mimetype = m;
    } else {
      content.document = media;
      content.mimetype = m || 'application/octet-stream';
      content.fileName = resolvedName;
      if (captionText) content.caption = captionText;
    }
  }

  return sock.sendMessage(
    chat,
    content,
    stripOptions(options, ['ptt', 'document', 'photo_live', 'audio_tag', 'mime']),
  );
}

/** Kirim PTV (video durasi pendek bulat). */
export function sendPtv(sock, chat, source, caption = '', message = null, options = {}) {
  return sendFile(sock, chat, source, '', caption, message, { ...options, ptvAsPtv: true });
}

/**
 * Kirim stiker. Opsi: packname, author, meta (AI sticker), lock, premium.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {*} source
 * @param {object} [message]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function sendSticker(sock, chat, source, message = null, options = {}) {
  const { bytes } = await resolveMediaInput(source);

  // Field proto StickerMessage: isAiSticker, isLottie, premium.
  const content = {
    sticker: await addStickerExif(bytes, options.packname, options.author),
    mimetype: 'image/webp',
  };
  if (options.meta) content.isAiSticker = true;
  if (options.lock) content.isLottie = false;
  if (options.premium) content.premium = 1;

  return sock.sendMessage(
    chat,
    content,
    stripOptions(options, ['packname', 'author', 'meta', 'lock', 'premium']),
  );
}

/**
 * Teks dengan thumbnail preview-link custom.
 * Opsi: title, body, thumbnail (url/buffer), url, ads, largeThumb, ratio.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {string} text
 * @param {object} [message]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function sendMessageModify(sock, chat, text, message = null, options = {}) {
  let thumbnail;
  if (options.thumbnail) thumbnail = (await resolveMediaInput(options.thumbnail)).bytes;

  return sock.sendMessage(
    chat,
    {
      text,
      contextInfo: {
        externalAdReplyInfo: {
          title: options.title ?? '',
          body: options.body ?? '',
          mediaType: options.type === 'preview-link' ? 4 : 1,
          thumbnail,
          showAdAttribution: !!options.ads,
          sourceUrl: options.url ?? '',
        },
      },
    },
    { quoted: message },
  );
}

/** Hasil poll (PollResultSnapshotMessage). */
export async function pollResult(sock, chat, data, message = null) {
  const pollVotes = (data.votes ?? []).map((v) => ({
    optionName: String(v.name ?? v.optionName ?? ''),
    optionVoteCount: Number(v.count ?? v.optionVoteCount ?? 0),
  }));

  return sock.sendMessage(
    chat,
    { pollResultSnapshotMessage: { name: data.name ?? '', pollVotes } },
    { quoted: message },
  );
}

/** Bangun satu vCard 3.0. */
const vcard = (c, options) =>
  [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${c.name}`,
    `TEL;type=CELL;type=VOICE;waid=${c.number}:+${String(c.number).replace(/\D/g, '')}`,
    c.about ? `NOTE:${c.about}` : null,
    options.org ? `ORG:${options.org}` : null,
    options.website ? `URL:${options.website}` : null,
    options.email ? `EMAIL:${options.email}` : null,
    'END:VCARD',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Kirim kontak (satu atau banyak). Opsi: org, website, email, displayName.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {Array<{name: string, number: string, about?: string}>|object} contacts
 * @param {object} [message]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export function sendContact(sock, chat, contacts, message = null, options = {}) {
  const list = Array.isArray(contacts) ? contacts : [contacts];

  return sock.sendMessage(
    chat,
    {
      contacts: {
        displayName: list.length === 1 ? list[0].name : options.displayName ?? `${list.length} contacts`,
        contacts: list.map((c) => ({ displayName: c.name, vcard: vcard(c, options) })),
      },
    },
    { quoted: message },
  );
}

/** Penerima status grup: seluruh anggota. */
const groupRecipients = async (sock, chat) =>
  ((await sock.groupMetadata(chat)).participants ?? [])
    .map((p) => p.phoneNumber ?? p.id ?? p.jid)
    .filter(Boolean);

/**
 * Kirim album: media dikirim berurutan dalam satu kalkulasi album.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {Array<{url: string, media?: string, caption?: string, type?: string}>} items
 * @param {object} [message]
 * @returns {Promise<object>}
 */
export async function sendAlbumMessage(sock, chat, items, message = null) {
  const contents = [];
  for (const item of items) {
    const { bytes } = await resolveMediaInput(item.url ?? item.media);
    const { mime } = await detectExtAndMime(bytes);
    const type = item.type ?? (mime?.startsWith('video/') ? 'video' : 'image');
    contents.push({ [type]: bytes, caption: item.caption ?? '', mimetype: mime });
  }

  const sendOptions = { quoted: message };
  const [first, ...rest] = contents;
  const result = await sock.sendMessage(chat, first ?? {}, sendOptions);
  for (const content of rest) await sock.sendMessage(chat, content, sendOptions);
  return result;
}

/**
 * Status grup (close friends bila `options.private`). Mendukung media, audio,
 * teks, atau pesan instant (objek ctx sebagai `data`).
 *
 * @param {object} sock
 * @param {string} chat
 * @param {object|string} data {media, caption} | {text, background, color} | fakeObj
 * @param {object} [options] {private: {name, emoji}}
 * @returns {Promise<object>}
 */
export async function groupStatus(sock, chat, data, options = {}) {
  const content = {};

  if (data?.message || data?.key) {
    // Instant: data adalah pesan terkutip yang sudah jadi.
    Object.assign(content, data.message);
  } else if (data.media) {
    const { bytes } = await resolveMediaInput(data.media);
    const { mime } = await detectExtAndMime(bytes);
    if (mime?.startsWith('audio/')) content.audio = bytes;
    else {
      content.image = bytes;
      if (data.caption) content.caption = data.caption;
    }
  } else if (data.text) {
    content.text = data.text;
  }

  const sendOptions = {};
  if (options.private) {
    // CLOSE_FRIENDS = 1 pada ContextInfo.StatusAudienceMetadata.AudienceType.
    sendOptions.contextInfo = { raw: { statusAudienceMetadata: { audienceType: 1 } } };
  }

  return sock.zapo.status.send({
    content,
    recipients: await groupRecipients(sock, chat),
    options: Object.keys(sendOptions).length ? sendOptions : undefined,
  });
}

/** Native flow button -> proto NativeFlowButton. */
const toNativeFlowButton = (b) => ({
  name: b.name,
  buttonParamsJson:
    typeof b.buttonParamsJson === 'string'
      ? b.buttonParamsJson
      : JSON.stringify(b.buttonParamsJson ?? b.params ?? {}),
});

/** Old button -> proto Button. */
const toOldButton = (b, index) => ({
  buttonId: b.command ?? b.id ?? `btn${index}`,
  buttonText: { displayText: b.text ?? b.displayText ?? 'Tap' },
  type: 1,
});

/** Header InteractiveMessage dari media/document/location. */
async function buildHeader(header = {}) {
  const out = { hasMediaAttachment: !!header.media };
  if (header.media) {
    const { bytes } = await resolveMediaInput(header.media);
    const { mime } = await detectExtAndMime(bytes);
    if (mime?.startsWith('image/')) out.imageMessage = { mimetype: mime };
    else if (mime?.startsWith('video/')) out.videoMessage = { mimetype: mime };
    else {
      out.documentMessage = {
        mimetype: mime ?? 'application/octet-stream',
        title: header.document?.filename ?? 'file',
      };
    }
    out.jpegThumbnail = bytes;
  } else if (header.location) {
    out.locationMessage = { name: header.location.name, address: header.location.description };
  }
  return out;
}

/**
 * replyButton — interactive (native flow, carousel) ATAU old-style button.
 * Interactive: buttons [{name, buttonParamsJson}], opsi {type: 'interactive',
 * content, footer, media, multiple, cards}.
 * Old-style: buttons [{text, command}], opsi {text, footer, media, document,
 * location}.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {Array<object>} buttons
 * @param {object} [message]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function replyButton(sock, chat, buttons = [], message = null, options = {}) {
  const interactive = options.type === 'interactive' || buttons.some((b) => b.name);

  if (interactive) {
    const base = {
      header: await buildHeader({
        media: options.media,
        document: options.document,
        location: options.location,
      }),
      body: { text: options.content ?? options.text ?? '' },
      footer: { text: options.footer ?? '' },
      contextInfo: options.mentions ? { mentionedJid: options.mentions } : undefined,
    };

    let protoMsg;
    if (options.cards?.length) {
      protoMsg = {
        interactiveMessage: {
          ...base,
          carouselMessage: { cards: options.cards, messageVersion: 1, carouselCardType: 1 },
        },
      };
    } else {
      const nativeFlow = {
        buttons: buttons.map(toNativeFlowButton),
        messageVersion: 1,
      };
      if (options.multiple) {
        nativeFlow.buttons.unshift({
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: options.multiple.list_title ?? 'Select',
            sections: [
              {
                title: options.multiple.button_title ?? options.multiple.name,
                rows: [{ title: options.multiple.name, id: options.multiple.code ?? 'm' }],
              },
            ],
          }),
        });
      }
      protoMsg = { interactiveMessage: { ...base, nativeFlowMessage: nativeFlow } };
    }

    return sock.sendMessage(chat, protoMsg, { quoted: message });
  }

  const inner = {
    buttons: buttons.map(toOldButton),
    headerType: 1,
    contentText: options.text ?? '',
    footerText: options.footer ?? '',
  };

  if (options.media) {
    const { bytes } = await resolveMediaInput(options.media);
    const { mime } = await detectExtAndMime(bytes, options.document?.filename);

    if (options.document) {
      inner.documentMessage = {
        mimetype: mime ?? 'application/octet-stream',
        title: options.document.filename ?? 'file',
        jpegThumbnail: bytes,
      };
      inner.headerType = 3;
    } else if (mime?.startsWith('video/')) {
      inner.videoMessage = { mimetype: mime, jpegThumbnail: bytes, caption: options.text };
      inner.headerType = 5;
    } else {
      inner.imageMessage = { mimetype: mime ?? 'image/jpeg', jpegThumbnail: bytes, caption: options.text };
      inner.headerType = 4;
    }
  } else if (options.location) {
    inner.locationMessage = {
      name: options.location.name,
      address: options.location.description,
    };
    inner.headerType = 6;
  } else {
    inner.text = options.text ?? '';
    inner.headerType = 2;
  }

  return sock.sendMessage(chat, { buttonsMessage: inner }, { quoted: message });
}

/**
 * sendMetaMsg — AIRichResponse.
 * v1: [{text}, {code:{language, code}}, {table:{title, headers, rows}}]
 * v2: + {muted}, {suggestions}, {sources:[{icon, title, url}]}, {image}, {video}
 * v3: + {reels}, {posts}, {products} (objek atau array slide)
 *
 * @param {object} sock
 * @param {string} chat
 * @param {Array<object>} parts
 * @param {object} [message]
 * @param {object} [options] {title, mentions}
 * @returns {Promise<object>}
 */
export async function sendMetaMsg(sock, chat, parts = [], message = null, options = {}) {
  const submessages = [];

  for (const part of parts) {
    if (part.text != null || part.muted != null) {
      submessages.push({
        messageType: 2,
        messageText: typeof (part.text ?? part.muted) === 'string' ? part.text ?? part.muted : JSON.stringify(part.text),
      });
    } else if (part.code) {
      submessages.push({
        messageType: 5,
        codeMetadata: {
          codeLanguage: part.code.language ?? 'plaintext',
          codeBlocks: [{ codeContent: part.code.code ?? '' }],
        },
      });
    } else if (part.table) {
      submessages.push({
        messageType: 4,
        tableMetadata: {
          title: part.table.title,
          rows: [
            { items: part.table.headers ?? [], isHeading: true },
            ...(part.table.rows ?? []).map((r) => ({ items: r.map(String) })),
          ],
        },
      });
    } else if (part.suggestions) {
      submessages.push({ messageType: 6, dynamicMetadata: { type: 0 } });
    } else if (part.sources) {
      for (const s of part.sources) {
        submessages.push({
          messageType: 3,
          imageMetadata: {
            imageUrl: { imagePreviewUrl: s.icon, sourceUrl: s.url },
            imageText: s.title,
            alignment: 0,
            tapLinkUrl: s.url,
          },
        });
      }
    } else if (part.image || part.video) {
      const media = part.image ?? part.video;
      submessages.push({
        messageType: 3,
        imageMetadata: {
          imageUrl: { imagePreviewUrl: typeof media === 'string' ? media : undefined },
          imageText: part.caption ?? '',
        },
      });
    } else if (part.reels || part.posts) {
      submessages.push({
        messageType: 9,
        contentItemsMetadata: {
          contentType: 1,
          itemsMetadata: (part.reels ?? part.posts).map((v) => ({
            reelItem: {
              title: v.creator ?? v.username ?? '',
              profileIconUrl: v.avatar,
              thumbnailUrl: v.thumbnail ?? v.media,
              videoUrl: v.url,
            },
          })),
        },
      });
    } else if (part.products) {
      const list = Array.isArray(part.products) ? part.products : [part.products];
      submessages.push({
        messageType: 2,
        messageText: list
          .map((p) => `${p.title}\n${p.price ? `~~${p.price}~~ ` : ''}${p.sale_price ?? ''}`)
          .join('\n\n'),
      });
    }
  }

  return sock.sendMessage(
    chat,
    { aiRichResponseMessage: { messageType: 1, submessages } },
    {
      quoted: message,
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
    },
  );
}
