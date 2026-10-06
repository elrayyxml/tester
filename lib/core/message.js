/** @module core/message */

import path from 'path';
import * as ftModule from 'file-type';
const ftFromBuffer = ftModule.fileTypeFromBuffer ?? ftModule.default?.fromBuffer;
const ftFromFile = ftModule.fileTypeFromFile ?? ftModule.default?.fromFile;
import mimeTypes from 'mime-types';
import webpmux from 'node-webpmux';
import nodeid3 from 'node-id3';
import { toBytes, generateMessageID } from '../utils/converter.js';
import { sharpResize } from '../utils/functions.js';

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
    /**
     * TIFF header for the `sticker-pack-*` JSON blob. Bytes 14-17 hold the
     * blob length and bytes 18-21 hold its offset (22, right after the
     * header). Leaving the length at zero makes WhatsApp fall back to the
     * default pack name.
     */
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
    exifAttr.writeUIntLE(json.length, 14, 4);

    const image = new webpmux.Image();
    await image.load(bytes);
    image.exif = Buffer.concat([exifAttr, json]);
    return await image.save(null);
  } catch {
    return bytes;
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

/**
 * Upload media and return the CDN descriptor fields a raw proto message needs.
 *
 * @param {object} sock
 * @param {Uint8Array|Buffer|object} media
 * @param {{ type: string, mimetype?: string, includeThumbnail?: boolean }} options
 * @returns {Promise<object>}
 */
async function uploadMediaDescriptor(sock, media, { type, mimetype, includeThumbnail = false }) {
  const uploaded = await sock.waUploadToServer(media, { type, mimetype });
  const descriptor = {
    url: uploaded.url,
    directPath: uploaded.directPath,
    mediaKey: uploaded.mediaKey,
    fileSha256: uploaded.fileSha256,
    fileEncSha256: uploaded.fileEncSha256,
    fileLength: uploaded.fileLength,
    mediaKeyTimestamp: uploaded.mediaKeyTimestamp,
  };
  if (includeThumbnail && (media instanceof Uint8Array || Buffer.isBuffer(media))) {
    descriptor.jpegThumbnail = media;
  }
  return descriptor;
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
 * Kirim file dari path/url/buffer; jenis ditentukan dari mimetype terdeteksi.
 *
 * @remarks
 * `ptt` selalu mengirim mimetype Ogg/Opus (voice note), karena WhatsApp hanya
 * menampilkan bubble push-to-talk untuk Ogg/Opus. Sumber non-Ogg ditranskode
 * zapo saat opsi client `normalizeVoiceNote` aktif.
 * @param {object} sock
 * @param {string} chat
 * @param {*} source
 * @param {string} [filename]
 * @param {string} [caption]
 * @param {object} [message]
 * @param {object} [options] `ptt`, `ptv`, `document`, `photo_live`, `audio_tag`,
 *   `caption`, `mime`, plus opsi kirim lain yang diteruskan apa adanya.
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
    /**
     * Voice notes must advertise Ogg/Opus; other source mimetypes render as
     * a plain audio attachment instead of a push-to-talk bubble. Non-Ogg
     * input is transcoded by zapo when `normalizeVoiceNote` is enabled on the
     * client.
     */
    const detected = options.mime ?? mime;
    content.audio = media;
    content.mimetype = detected?.startsWith('audio/ogg') ? detected : 'audio/ogg; codecs=opus';
    content.ptt = true;
  } else if (options.ptv) {
    content.ptv = media;
    content.mimetype = options.mime ?? mime ?? 'video/mp4';
  } else if (options.photo_live) {
    /**
     * Photo live = motion photo: gambar parent (pairedMediaType 5) + video
     * child (pairedMediaType 6) terkait via messageAssociation MOTION_PHOTO
     * (12). Jalur raw proto, zapo tidak punya typed builder.
     * `options.photo` wajib: sumber gambar parent (buffer/url/path).
     */
    const { bytes: imageBytes } = await resolveMediaInput(options.photo);
    if (!imageBytes) {
      throw new Error('Option "photo_live" requires "options.photo" (image buffer, URL, or path).');
    }

    const imageDescriptor = await uploadMediaDescriptor(sock, imageBytes, { type: 'image', mimetype: 'image/jpeg' });
    const videoDescriptor = await uploadMediaDescriptor(sock, media, { type: 'video', mimetype: 'video/mp4' });

    const parentKey = { remoteJid: chat, id: generateMessageID(sock.identity), fromMe: true };

    const parentResult = await sock.relayMessage(
      chat,
      {
        imageMessage: {
          ...imageDescriptor,
          mimetype: 'image/jpeg',
          caption: captionText,
        },
        messageContextInfo: {
          messageAssociation: { associationType: 12, parentMessageKey: parentKey },
        },
      },
      {
        contextInfoRaw: { pairedMediaType: 5, statusSourceType: 0 },
        messageId: parentKey.id,
        quoted: message,
      },
    );

    const parentMessageKey = parentResult?.key?.id ? parentResult.key : parentKey;

    return sock.relayMessage(
      chat,
      {
        videoMessage: {
          ...videoDescriptor,
          mimetype: 'video/mp4',
        },
        messageContextInfo: {
          messageAssociation: { associationType: 12, parentMessageKey },
        },
      },
      {
        contextInfoRaw: {
          pairedMediaType: 6,
          statusSourceType: 0,
          stanzaId: parentMessageKey.id,
          participant: chat,
        },
        quoted: message,
      },
    );
  } else if (options.audio_tag) {
    content.audio = applyAudioTag(media, options.audio_tag);
    content.mimetype = options.mime ?? (mime?.startsWith('audio/') ? mime : 'audio/mpeg');
  } else {
    const m = options.mime ?? mime ?? '';
    if (m.startsWith('image/') || m.startsWith('video/')) {
      content[m.startsWith('image/') ? 'image' : 'video'] = media;
      content.mimetype = m;
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
    stripOptions(options, ['ptt', 'ptv', 'document', 'photo_live', 'audio_tag', 'mime']),
  );
}

/**
 * Kirim stiker dengan exif `sticker-pack-name`/`sticker-pack-publisher`.
 *
 * @remarks
 * `lock` menandai stiker sebagai avatar terkunci, yang di proto berarti
 * `isAvatar: true` + `isAiSticker: true` sekaligus. `meta` hanya menyalakan
 * `isAiSticker`. `premium` mengisi `premium: 1`.
 * @param {object} sock
 * @param {string} chat
 * @param {*} source webp buffer, URL, atau path
 * @param {object} [message]
 * @param {object} [options] `packname`, `author`, `meta`, `lock`, `premium`
 * @returns {Promise<object>}
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

  const content = {
    sticker: await addStickerExif(bytes, options.packname, options.author),
    mimetype: 'image/webp',
  };

  if (options.lock) {
    content.isAvatar = true;
    content.isAiSticker = true;
  } else if (options.meta) {
    content.isAiSticker = true;
  }
  if (options.premium) content.premium = 1;

  return sock.sendMessage(
    chat,
    content,
    stripOptions(options, ['packname', 'author', 'meta', 'lock', 'premium']),
  );
}

/**
 * Byte thumbnail dari input buffer/URL/path, atau undefined bila input kosong
 * atau gagal ditranscode.
 */
async function thumbnailBytes(input) {
  if (!input) return undefined;
  try {
    const { bytes } = await resolveMediaInput(input);
    return await sharpResize(bytes);
  } catch {
    return undefined;
  }
}

/** Dimensi thumbnail per preset ratio. */
const RATIO_SIZES = {
  landscape: [320, 180],
  portrait: [180, 320],
  square: [320, 320],
};

/** First http(s) URL inside `text`, used when no explicit `url` is given. */
const firstUrlInText = (text) => text.match(/\bhttps?:\/\/\S+/i)?.[0];

/**
 * Teks dengan thumbnail atau preview-link custom.
 * Tanpa `type`: ad-reply thumbnail (`contextInfo.externalAdReplyInfo`).
 * Dengan `type: 'preview-link'`: link preview buatan sendiri melalui
 * `linkPreview` override zapo, yang diterjemahkan menjadi
 * `extendedTextMessage` ber-`matchedText` + `previewType` (bukan ad-reply).
 *
 * @remarks
 * The preview-link mode sends a `linkPreview` object, so `url` does not have
 * to appear in `text` — the object skips zapo's fetcher and uses the supplied
 * fields. When `url` is omitted, the first URL found in `text` is used.
 * @param {object} sock
 * @param {string} chat
 * @param {string} text
 * @param {object} [message] ctx pesan untuk quote
 * @param {object} [options] `title`, `body`, `thumbnail` (buffer/URL/path), `url`,
 *   `ads`, `largeThumb`, `ratio` ('landscape' | 'portrait' | 'square'), `type`,
 *   `quoted`, `mentions`
 * @returns {Promise<object>}
 */
export async function sendMessageModify(sock, chat, text, message = null, options = {}) {
  const quoted = options.quoted ?? message;
  const displayText = text;

  if (options.type === 'preview-link') {
    const thumb = await thumbnailBytes(options.thumbnail);
    const [width, height] = RATIO_SIZES[options.ratio] ?? RATIO_SIZES.landscape;
    const matchedText = options.url ?? firstUrlInText(displayText);

    if (!matchedText) {
      throw new Error('Option "type: preview-link" requires "url" or a URL present in "text".');
    }

    return sock.sendMessage(
      chat,
      {
        type: 'text',
        text: displayText,
        linkPreview: {
          matchedText,
          title: options.title ?? '',
          description: options.body ?? '',
          ...(thumb ? { previewType: 5, thumbnail: { bytes: thumb, width, height } } : {}),
        },
      },
      { quoted, ...(options.mentions?.length ? { mentions: options.mentions } : {}) },
    );
  }

  const thumbnail = await thumbnailBytes(options.thumbnail);
  const [width, height] = RATIO_SIZES[options.ratio] ?? [];
  const adReply = {
    title: options.title ?? '',
    body: options.body ?? '',
    mediaType: 1,
    thumbnail,
    renderLargerThumbnail: !!options.largeThumb,
    showAdAttribution: !!options.ads,
    sourceUrl: options.url ?? '',
  };
  if (width) {
    adReply.thumbnailWidth = width;
    adReply.thumbnailHeight = height;
  }

  return sock.sendMessage(
    chat,
    { text: displayText, contextInfo: { externalAdReplyInfo: adReply } },
    { quoted },
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
 * Kirim album: parent berupa proto `albumMessage` (placeholder dengan
 * expectedImageCount/expectedVideoCount), lalu tiap item dikirim sebagai
 * child imageMessage/videoMessage ber-association MEDIA_ALBUM (1).
 * Jalur raw proto, zapo tidak punya typed builder album.
 *
 * @param {object} sock
 * @param {string} chat
 * @param {Array<{url?: string, media?: string, caption?: string, type?: string}>} items
 * @param {object} [message]
 * @returns {Promise<object>} hasil kirim parent album
 */
export async function sendAlbumMessage(sock, chat, items, message = null) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('sendAlbumMessage requires a non-empty items array.');
  }

  const resolved = [];
  for (const item of items) {
    const { bytes } = await resolveMediaInput(item.url ?? item.media);
    const { mime } = await detectExtAndMime(bytes);
    const mediaType = (item.type ?? (mime?.startsWith('video/') ? 'video' : 'image')) === 'video' ? 'video' : 'image';
    resolved.push({ bytes, mime, mediaType, caption: item.caption ?? '' });
  }

  const sendOptions = { quoted: message };
  const expectedImageCount = resolved.filter((r) => r.mediaType === 'image').length;
  const expectedVideoCount = resolved.filter((r) => r.mediaType === 'video').length;

  const parent = await sock.relayMessage(
    chat,
    { albumMessage: { expectedImageCount, expectedVideoCount } },
    sendOptions,
  );

  const parentKey = { remoteJid: chat, id: parent?.key?.id, fromMe: true };

  for (const item of resolved) {
    const descriptor = await uploadMediaDescriptor(sock, item.bytes, {
      type: item.mediaType,
      mimetype: item.mime,
    });

    await sock.relayMessage(
      chat,
      {
        [`${item.mediaType}Message`]: { ...descriptor, mimetype: item.mime, caption: item.caption },
        messageContextInfo: {
          messageAssociation: { associationType: 1, parentMessageKey: parentKey },
        },
      },
      sendOptions,
    );
  }

  return parent;
}

/**
 * Post a status (story) to every member of a group, or to close friends when
 * `options.private` is set. Accepts image/video/audio media with a caption,
 * plain text, or an existing message object for an instant reshare.
 *
 * @remarks
 * `data.background` and `data.color` are ignored: colored broadcast text lives
 * in `ConsumerApplication.StatusTextMesage`, which `Proto.Message` on the wire
 * does not expose through zapo. `options.private.name` and `emoji` are also
 * ignored — the close-friends audience is selected with zapo's
 * `statusSetting: 'close_friends'`.
 * @param {object} sock
 * @param {string} chat
 * @param {object} data Media with `media`/`caption`, text with `text`, or an existing message.
 * @param {object} [options] `{ private }` to post to the close-friends audience.
 * @returns {Promise<object>}
 */
export async function groupStatus(sock, chat, data, options = {}) {
  let content;

  if (data?.message || data?.key) {
    content = data.message ?? data.key?.message ?? {};
  } else if (data?.media) {
    const { bytes } = await resolveMediaInput(data.media);
    const { mime } = await detectExtAndMime(bytes);

    if (mime?.startsWith('video/')) content = { type: 'video', media: bytes, mimetype: mime };
    else if (mime?.startsWith('audio/')) content = { type: 'audio', media: bytes, mimetype: mime };
    else content = { type: 'image', media: bytes, mimetype: mime ?? 'image/jpeg' };

    if (data.caption && mime?.startsWith('image/')) content.caption = data.caption;
  } else if (data?.text) {
    content = data.text;
  } else {
    throw new Error('groupStatus requires "media", "text", or an existing message in the first argument.');
  }

  return sock.zapo.status.send({
    content,
    recipients: await groupRecipients(sock, chat),
    ...(options.private ? { statusSetting: 'close_friends' } : {}),
  });
}

/** Native flow button -> proto NativeFlowButton. */
const toNativeFlowButton = (button) => {
  const params =
    typeof button.buttonParamsJson === 'string'
      ? button.buttonParamsJson
      : button.buttonParamsJson ?? button.params;

  if (params !== undefined) {
    return { name: button.name, buttonParamsJson: typeof params === 'string' ? params : JSON.stringify(params) };
  }

  return {
    name: button.name ?? 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: button.text ?? button.displayText ?? 'Tap',
      id: button.command ?? button.id ?? 'tap',
    }),
  };
};

/** Old button -> proto Button. */
const toOldButton = (b, index) => ({
  buttonId: b.command ?? b.id ?? `btn${index}`,
  buttonText: { displayText: b.text ?? b.displayText ?? 'Tap' },
  type: 1,
});

/** Header InteractiveMessage dari judul teks, media, document, atau location. */
async function buildHeader(sock, header = {}) {
  const out = { hasMediaAttachment: !!header.media };
  if (header.title) out.title = header.title;
  if (header.media) {
    const { bytes } = await resolveMediaInput(header.media);
    const { mime } = await detectExtAndMime(bytes);
    const mediaType = header.document ? 'document' : mime?.startsWith('video/') ? 'video' : 'image';
    const descriptor = await uploadMediaDescriptor(sock, bytes, {
      type: mediaType,
      mimetype: mime,
      includeThumbnail: true,
    });

    if (header.document) {
      out.documentMessage = {
        ...descriptor,
        mimetype: mime ?? 'application/octet-stream',
        title: header.document.filename ?? 'file',
      };
    } else if (mime?.startsWith('video/')) {
      out.videoMessage = { ...descriptor, mimetype: mime };
    } else {
      out.imageMessage = { ...descriptor, mimetype: mime ?? 'image/jpeg' };
    }
  } else if (header.location) {
    out.locationMessage = {
      degreesLatitude: header.location.degreesLatitude ?? 0,
      degreesLongitude: header.location.degreesLongitude ?? 0,
      name: header.location.name,
      address: header.location.description ?? header.location.address,
    };
  }
  return out;
}

/**
 * replyButton — interactive (native flow, carousel) atau tombol gaya lama.
 * Interactive: `buttons` ber-`name`/`buttonParamsJson`, opsi `{ type:
 * 'interactive', header, content, footer, media, multiple, cards, v2 }`.
 * Old-style: `buttons` ber-`text`/`command`, opsi `{ text, footer, media,
 * document, location }`.
 *
 * @remarks
 * Header media (media/document) dan gambar kartu carousel wajib pre-uploaded;
 * helper ini yang mengunggahnya. Tombol gaya lama yang dicampur ke jalur
 * interactive dikonversi menjadi native flow `quick_reply`.
 * @param {object} sock
 * @param {string} chat
 * @param {Array<object>} [buttons]
 * @param {object} [message]
 * @param {object} [options]
 * @returns {Promise<object>} hasil kirim dari zapo
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
    /**
     * Header interactive: `title` (teks), atau `media`/`document`/`location`.
     * Header media dan kartu carousel wajib pre-uploaded; zapo tidak
     * mengunggahnya sendiri.
     */
    const header = await buildHeader(sock, {
      title: options.header ?? options.title,
      media: options.media,
      document: options.document,
      location: options.location,
    });

    const base = {
      header,
      body: { text: options.content ?? options.text ?? '' },
      footer: { text: options.footer ?? '' },
      contextInfo: options.mentions ? { mentionedJid: options.mentions } : undefined,
    };

    if (options.cards?.length) {
      const cards = await Promise.all(options.cards.map((card) => buildCarouselCard(sock, card)));
      return sock.sendMessage(
        chat,
        {
          interactiveMessage: {
            ...base,
            carouselMessage: { cards, messageVersion: 1, carouselCardType: 1 },
          },
        },
        { quoted: message },
      );
    }

    const nativeFlow = { buttons: buttons.map(toNativeFlowButton), messageVersion: 1 };

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

    return sock.sendMessage(
      chat,
      {
        interactiveMessage: {
          ...base,
          messageVersion: options.v2 ? 2 : 1,
          nativeFlowMessage: nativeFlow,
        },
      },
      { quoted: message },
    );
  }

  const inner = {
    buttons: buttons.map(toOldButton),
    headerType: 1,
    contentText: options.text ?? '',
    footerText: options.footer ?? '',
  };

  if (options.document || options.media) {
    const headerType = options.document
      ? 'document'
      : (await detectExtAndMime((await resolveMediaInput(options.media)).bytes)).mime?.startsWith('video/')
        ? 'video'
        : 'image';
    const descriptor = await uploadHeaderMedia(sock, options.media, {
      type: headerType,
      document: options.document,
      caption: options.text,
    });

    if (headerType === 'document') {
      inner.documentMessage = descriptor;
      inner.headerType = 3;
    } else if (headerType === 'video') {
      inner.videoMessage = descriptor;
      inner.headerType = 5;
    } else {
      inner.imageMessage = descriptor;
      inner.headerType = 4;
    }
  } else if (options.location) {
    inner.locationMessage = {
      degreesLatitude: options.location.degreesLatitude ?? 0,
      degreesLongitude: options.location.degreesLongitude ?? 0,
      name: options.location.name,
      address: options.location.description ?? options.location.address,
    };
    inner.headerType = 6;
  } else {
    inner.text = options.text ?? '';
    inner.headerType = 2;
  }

  return sock.sendMessage(chat, { buttonsMessage: inner }, { quoted: message });
}

/**
 * Siapkan header media (image/video/document) yang sudah diunggah ke CDN.
 * zapo tidak mengunggah header sendiri, dan tanpa descriptor server menolak
 * stanza dengan SMAX_INVALID (479).
 *
 * @param {object} sock
 * @param {*} media buffer/URL/path
 * @param {{ type: string, document?: { filename?: string }, caption?: string }} options
 * @returns {Promise<object>} proto imageMessage/videoMessage/documentMessage
 */
async function uploadHeaderMedia(sock, media, { type, document, caption }) {
  const { bytes } = await resolveMediaInput(media);
  const { mime } = await detectExtAndMime(bytes, document?.filename);
  const descriptor = await uploadMediaDescriptor(sock, bytes, {
    type,
    mimetype: mime,
    includeThumbnail: true,
  });

  if (type === 'document') {
    return {
      ...descriptor,
      mimetype: mime ?? 'application/octet-stream',
      title: document?.filename ?? 'file',
      fileName: document?.filename ?? 'file',
      caption,
    };
  }
  return { ...descriptor, mimetype: mime ?? (type === 'video' ? 'video/mp4' : 'image/jpeg'), caption };
}

/**
 * Bangun satu kartu carousel: header (teks atau media pre-uploaded) plus
 * body dan native flow bawaan kartu.
 *
 * @param {object} sock
 * @param {object} card
 * @returns {Promise<object>}
 */
async function buildCarouselCard(sock, card) {
  const header = { ...(card.header ?? {}) };

  if (header.image) {
    const uploaded = await uploadHeaderMedia(sock, header.image, { type: 'image' });
    header.imageMessage = { ...uploaded, ...(header.imageMessage ?? {}) };
    header.hasMediaAttachment = true;
    delete header.image;
  } else if (header.video) {
    const uploaded = await uploadHeaderMedia(sock, header.video, { type: 'video' });
    header.videoMessage = { ...uploaded, ...(header.videoMessage ?? {}) };
    header.hasMediaAttachment = true;
    delete header.video;
  }

  return { ...card, header };
}

/**
 * sendMetaMsg — rich response (AIRichResponse).
 * v1: `[{ text }, { code: { language, code } }, { table: { title, headers, rows } }]`
 * v2: tambah `{ muted }`, `{ suggestions }`, `{ sources: [{ icon, title, url }] }`,
 *     `{ image }`, `{ video }`
 * v3: tambah `{ reels }`, `{ posts }`, `{ products }` (objek atau array slide)
 *
 * @remarks
 * Media hanya boleh berupa URL; buffer diunggah dulu lewat `waUploadToServer`.
 * `suggestions` dikirim sebagai dynamic metadata kosong karena chip saran
 * diisi server, dan `products` dirender sebagai teks harga karena
 * `AIRichResponseSubMessageType` tidak punya tipe produk.
 * @param {object} sock
 * @param {string} chat
 * @param {Array<object>} parts
 * @param {object} [message]
 * @param {object} [options] `{ title, mentions }`
 * @returns {Promise<object>}
 */
export async function sendMetaMsg(sock, chat, parts = [], message = null, options = {}) {
  const submessages = [];

  /**
   * Rich response hanya menerima URL, bukan byte media: `imagePreviewUrl`,
   * `thumbnailUrl`, dan `profileIconUrl` semuanya string. Media buffer
   * diunggah lebih dulu agar URL valid dihasilkan; tanpa itu medannya hilang
   * tanpa jejak di sisi penerima.
   */
  const resolveUrl = async (media, uploadType = 'image') => {
    if (!media) return undefined;
    if (typeof media === 'string' && /^https?:\/\//i.test(media)) return media;
    if (media.url) return media.url;
    const uploaded = await sock.waUploadToServer(media, { type: uploadType });
    return uploaded?.url;
  };

  if (options.title) submessages.push({ messageType: 2, messageText: options.title });

  for (const part of parts) {
    if (part.text != null || part.muted != null) {
      const body = part.text ?? part.muted;
      submessages.push({
        messageType: 2,
        messageText: typeof body === 'string' ? body : JSON.stringify(body),
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
      for (const source of part.sources) {
        submessages.push({
          messageType: 3,
          imageMetadata: {
            imageUrl: {
              imagePreviewUrl: await resolveUrl(source.icon),
              sourceUrl: source.url,
            },
            imageText: source.title,
            alignment: 0,
            tapLinkUrl: source.url,
          },
        });
      }
    } else if (part.image || part.video) {
      const media = part.image ?? part.video;
      submessages.push({
        messageType: 3,
        imageMetadata: {
          imageUrl: { imagePreviewUrl: await resolveUrl(media, part.video ? 'video' : 'image') },
          imageText: part.caption ?? '',
          tapLinkUrl: part.url,
        },
      });
    } else if (part.reels || part.posts) {
      const items = part.reels ?? part.posts;
      const rendered = [];
      for (const item of items) {
        rendered.push({
          reelItem: {
            title: item.creator ?? item.username ?? '',
            profileIconUrl: await resolveUrl(item.avatar),
            thumbnailUrl: await resolveUrl(item.thumbnail ?? item.media),
            videoUrl: item.url,
          },
        });
      }
      submessages.push({
        messageType: 9,
        contentItemsMetadata: { contentType: 1, itemsMetadata: rendered },
      });
    } else if (part.products) {
      /**
       * `AIRichResponseSubMessageType` tidak punya tipe produk, jadi produk
       * dirender sebagai teks harga — satu-satunya representasi yang didukung
       * proto ini.
       */
      const list = Array.isArray(part.products) ? part.products : [part.products];
      const lines = await Promise.all(
        list.map(async (product) => {
          const heading = product.brand ? `*${product.title}* — ${product.brand}` : `*${product.title}*`;
          const price = product.price ? `~~${product.price}~~ ` : '';
          const link = product.url ? `\n${product.url}` : '';
          return `${heading}\n${price}${product.sale_price ?? ''}${link}`;
        }),
      );
      submessages.push({ messageType: 2, messageText: lines.join('\n\n') });
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
