/** @module core/message */

import path from 'path';
import * as ftModule from 'file-type';
const ftFromBuffer = ftModule.fileTypeFromBuffer ?? ftModule.default?.fromBuffer;
const ftFromFile = ftModule.fileTypeFromFile ?? ftModule.default?.fromFile;
import mimeTypes from 'mime-types';
import nodeid3 from 'node-id3';
import { toBytes, generateMessageID } from '../utils/converter.js';
import { sharpResize } from '../utils/functions.js';

/**
 * JSON identitas paket stiker yang dibaca WhatsApp: id dihitung dari
 * packname + author (hash per paket) agar pengelompokan koleksi konsisten.
 *
 * @param {string} packName
 * @param {string} author
 * @returns {string}
 */
const packJson = (packName, author) =>
  JSON.stringify({
    'sticker-pack-id': `nexray-${Date.now()}`,
    'sticker-pack-name': packName,
    'sticker-pack-publisher': author,
    emojis: [],
  });

/**
 * Header EXIF TIFF standar stiker WhatsApp. Panjang blob JSON ditulis pada
 * offset 14; membiarkannya nol membuat WhatsApp jatuh ke nama paket bawaan.
 *
 * @param {string} packName
 * @param {string} author
 * @returns {Buffer}
 */
function buildStrictExif(packName, author) {
  const data = Buffer.from(packJson(packName, author), 'utf8');
  const head = Buffer.alloc(26);
  head.write('II', 0, 'ascii');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(1, 8);
  head.writeUInt16LE(0x5741, 10);
  head.writeUInt16LE(7, 12);
  head.writeUInt32LE(data.length, 14);
  head.writeUInt32LE(26, 18);
  head.writeUInt32LE(0, 22);
  return Buffer.concat([head, data]);
}

/**
 * Pecah berkas webp menjadi daftar chunk RIFF; `null` bila bukan webp utuh.
 *
 * @param {Buffer} webp
 * @returns {Array<{fourcc: string, payload: Buffer}>|null}
 */
function parseChunks(webp) {
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const fourcc = webp.toString('ascii', offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > webp.length) return null;
    chunks.push({ fourcc, payload: Buffer.from(webp.subarray(start, end)) });
    offset = end + (size % 2);
  }
  return chunks;
}

/** @param {Buffer} buf @returns {boolean} */
function isValidWebp(buf) {
  if (buf.length < 12) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  return Array.isArray(parseChunks(buf));
}

/** @param {Array<{fourcc: string, payload: Buffer}>} chunks @returns {Buffer} */
function serialize(chunks) {
  let size = 4;
  for (const chunk of chunks) size += 8 + chunk.payload.length + (chunk.payload.length % 2);
  const buf = Buffer.alloc(8 + size);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(size, 4);
  buf.write('WEBP', 8, 'ascii');
  let offset = 12;
  for (const chunk of chunks) {
    buf.write(chunk.fourcc, offset, 'ascii');
    buf.writeUInt32LE(chunk.payload.length, offset + 4);
    chunk.payload.copy(buf, offset + 8);
    offset += 8 + chunk.payload.length + (chunk.payload.length % 2);
  }
  return buf;
}

/**
 * Sisipkan EXIF di level chunk RIFF: flag EXIF pada header VP8X dinyalakan dan
 * chunk EXIF lama diganti. Data gambar tidak disentuh, jadi webp animasi tetap
 * utuh — `node-webpmux` menulis ulang header VP8X tanpa bit alpha dan membuat
 * area transparan stiker animasi tampil putih.
 *
 * @param {Buffer} webp
 * @param {Buffer} exif
 * @returns {Buffer}
 */
function injectExif(webp, exif) {
  if (!isValidWebp(webp)) return webp;
  const chunks = parseChunks(webp);
  if (!chunks) return webp;

  const out = [];

  if (chunks[0].fourcc === 'VP8X') {
    const vp8x = Buffer.from(chunks[0].payload);
    vp8x[0] |= 0x08;
    out.push({ fourcc: 'VP8X', payload: vp8x });
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].fourcc === 'EXIF') continue;
      out.push(chunks[i]);
    }
  } else {
    const vp8 = chunks.find((c) => c.fourcc === 'VP8 ');
    const vp8l = chunks.find((c) => c.fourcc === 'VP8L');
    let canvas = null;
    if (vp8 && vp8.payload.length >= 10 && vp8.payload[3] === 0x9d && vp8.payload[4] === 0x01 && vp8.payload[5] === 0x2a) {
      canvas = {
        w: (vp8.payload[6] | (vp8.payload[7] << 8)) & 0x3fff,
        h: (vp8.payload[8] | (vp8.payload[9] << 8)) & 0x3fff,
      };
    } else if (vp8l && vp8l.payload.length >= 5 && vp8l.payload[0] === 0x2f) {
      const b1 = vp8l.payload[1];
      const b2 = vp8l.payload[2];
      const b3 = vp8l.payload[3];
      const b4 = vp8l.payload[4];
      canvas = {
        w: (((b2 & 0x3f) << 8) | b1) + 1,
        h: (((b2 >> 6) & 0x03) | (b3 << 2) | ((b4 & 0x0f) << 10)) + 1,
      };
    }
    if (!canvas) return webp;

    const hasAlpha = chunks.some((c) => c.fourcc === 'ALPH');
    const payload = Buffer.alloc(10);
    payload[0] = (hasAlpha ? 0x02 : 0) | 0x08;
    payload[4] = (canvas.w - 1) & 0xff;
    payload[5] = ((canvas.w - 1) >> 8) & 0xff;
    payload[6] = ((canvas.w - 1) >> 16) & 0xff;
    payload[7] = (canvas.h - 1) & 0xff;
    payload[8] = ((canvas.h - 1) >> 8) & 0xff;
    payload[9] = ((canvas.h - 1) >> 16) & 0xff;
    out.push({ fourcc: 'VP8X', payload });
    out.push(...chunks);
  }

  out.push({ fourcc: 'EXIF', payload: exif });
  const result = serialize(out);
  return isValidWebp(result) ? result : webp;
}

/**
 * Bungkus webp stiker dengan exif `sticker-pack-*` (packname/author). Tanpa
 * exif stiker tetap terkirim tapi tanpa nama pack.
 *
 * @param {Uint8Array|Buffer} bytes webp
 * @param {string} [packname]
 * @param {string} [author]
 * @returns {Promise<Uint8Array|Buffer>}
 */
async function addStickerExif(bytes, packname, author) {
  if (!packname && !author) return bytes;
  try {
    return injectExif(Buffer.from(bytes), buildStrictExif(packname ?? '', author ?? ''));
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
async function uploadMediaDescriptor(sock, media, { type, mimetype, includeThumbnail = false, fallbackUpload }) {
  const uploaded = await (sock.waUploadToServer
    ? sock.waUploadToServer(media, { type, mimetype })
    : fallbackUpload?.());
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
  return sock.zapo.message.send(chat, own, { quoted: message, ...options });
}

/** Kirim reaksi. */
export function sendReact(sock, chat, emoji, key) {
  return sock.zapo.message.send(chat, { react: { text: emoji, key } });
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
     * Photo live = motion photo: video dikirim sebagai PTV pasangan gambar
     * parent (pairedMediaType 5) dan child (pairedMediaType 6), terkait via
     * messageAssociation MOTION_PHOTO (12). Jalur raw proto — zapo tidak punya
     * typed builder. `options.thumbnail` opsional: JPEG kecil untuk preview.
     */
    const parentKey = { remoteJid: chat, id: generateMessageID(sock.identity), fromMe: true };
    const videoDescriptor = await uploadMediaDescriptor(sock, media, { type: 'video', mimetype: 'video/mp4' });

    return sock.zapo.message.send(
      chat,
      {
        videoMessage: {
          ...videoDescriptor,
          mimetype: 'video/mp4',
          caption: captionText,
          jpegThumbnail: options.thumbnail ? await thumbnailBytes(options.thumbnail) : undefined,
        },
        messageContextInfo: {
          messageAssociation: { associationType: 12, parentMessageKey: parentKey },
        },
      },
      {
        contextInfoRaw: { pairedMediaType: 6, statusSourceType: 0 },
        messageId: parentKey.id,
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

  return sock.zapo.message.send(
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
  const sticker = await addStickerExif(bytes, options.packname, options.author);

  const content = { type: 'sticker', media: sticker, mimetype: 'image/webp' };
  if (options.lock) {
    content.isAvatar = true;
    content.isAiSticker = true;
  } else if (options.meta) {
    content.isAiSticker = true;
  }
  if (options.premium) content.premium = 1;

  const sendOptions = stripOptions(options, ['packname', 'author', 'meta', 'lock', 'premium']);
  sendOptions.id = generateMessageID(sock.identity);
  return sock.zapo.message.send(chat, content, sendOptions);
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

    return sock.zapo.message.send(
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

  return sock.zapo.message.send(
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

  return sock.zapo.message.send(
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

  return sock.zapo.message.send(
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

  const parent = await sock.zapo.message.send(
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

    await sock.zapo.message.send(
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
 * Sumber status: typed content zapo -> media descriptor + proto. Media
 * diunggah manual karena zapo tidak mengekspos builder konten status.
 *
 * @param {object} sock
 * @param {object} content
 * @returns {Promise<object>} proto `Proto.IMessage` untuk status
 */
async function buildStatusInnerContent(sock, content) {
  if (content?.text && !content.media) {
    return { extendedTextMessage: { text: content.text } };
  }
  if (!content?.media) {
    throw new Error('Group status requires "media" or "text" in the content.');
  }

  const { bytes } = await resolveMediaInput(content.media);
  const { mime } = await detectExtAndMime(bytes);

  if (mime?.startsWith('audio/')) {
    throw new Error(`Unsupported group status media type: audio`);
  }

  const mediaType = mime?.startsWith('video/') ? 'video' : 'image';
  const descriptor = await uploadMediaDescriptor(sock, bytes, {
    type: mediaType,
    mimetype: mime,
    fallbackUpload: () => sock.zapo?.message?.upload(bytes, { type: mediaType, mimetype: mime }),
  });

  const media = {
    ...descriptor,
    mimetype: mime ?? (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
    caption: content.caption,
  };

  return mediaType === 'image' ? { imageMessage: media } : { videoMessage: media };
}

/** Group mention pada contextInfo: grup tampil sebagai mention resmi. */
function withGroupMention(contextInfo, chat) {
  return {
    ...(contextInfo ?? {}),
    groupMentions: [{ groupJid: chat, groupSubject: 'Group' }],
    mentionedJid: [chat],
  };
}

/**
 * Post a status to every member of a group, or to close friends when
 * `options.private` is set. Accepts image/video media with a caption, plain
 * text, or an existing message object for an instant reshare.
 *
 * @remarks
 * The content is wrapped in `groupStatusMessageV2` — the wrapper real clients
 * send. Group mentions ride on `contextInfo.groupMentions` without altering
 * the caption. Text backgrounds and `private.name`/`emoji` are not supported:
 * colored status text lives in `ConsumerApplication.StatusTextMesage`, which
 * `Proto.Message` does not expose through zapo.
 * @param {object} sock
 * @param {string} chat
 * @param {object} data Media with `media`/`caption`, text with `text`, or an existing message.
 * @param {object} [options] `{ private }` to post to the close-friends audience.
 * @returns {Promise<object>}
 */
export async function groupStatus(sock, chat, data, options = {}) {
  let inside;

  if (data?.message || data?.key) {
    inside = data.message ?? data.key?.message ?? {};
  } else {
    inside = await buildStatusInnerContent(sock, data);
  }

  const mention = withGroupMention(null, chat);
  if (inside.imageMessage) {
    inside.imageMessage.contextInfo = withGroupMention(inside.imageMessage.contextInfo, chat);
  }
  if (inside.videoMessage) {
    inside.videoMessage.contextInfo = withGroupMention(inside.videoMessage.contextInfo, chat);
  }
  if (inside.extendedTextMessage) {
    inside.extendedTextMessage.contextInfo = withGroupMention(inside.extendedTextMessage.contextInfo, chat);
  }

  const statusOptions = {
    ...(options.private ? { statusSetting: 'close_friends' } : {}),
  };
  const sendOptions = Object.keys(statusOptions).length ? statusOptions : undefined;

  return sock.zapo.message.send(
    chat,
    { groupStatusMessageV2: { message: inside } },
    sendOptions,
  );
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

/**
 * Node `biz` untuk pesan interactive di grup, pola yang dikirim WA Web:
 * `<biz><interactive type="native_flow" v="1"><native_flow v="9" name="mixed"/></interactive></biz>`.
 * Tanpa node ini server menolak pesan interactive grup dengan SMAX_INVALID
 * (479). Lemparkan hasilnya ke `options.customNodes`.
 *
 * @param {string} jid
 * @returns {Array<object>}
 */
function buildInteractiveBizNodes(jid) {
  return [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' }, content: [] }],
        },
      ],
    },
  ];
}

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
      return sock.zapo.message.send(
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

    return sock.zapo.message.send(
      chat,
      {
        interactiveMessage: {
          ...base,
          messageVersion: options.v2 ? 2 : 1,
          nativeFlowMessage: nativeFlow,
        },
      },
      {
        quoted: message,
        customNodes: buildInteractiveBizNodes(chat),
      },
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

  return sock.zapo.message.send(chat, { buttonsMessage: inner }, { quoted: message });
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
 * `options.deep: true` mengirim submessages lewat proto
 * `botForwardedMessage` -> `richResponseMessage` dengan atribut forward bot;
 * tanpa `deep` memakai `aiRichResponseMessage` biasa. `options.botJid`
 * mengganti JID bot pada atribut forward.
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
    const upload = sock.waUploadToServer?.bind(sock)
      ?? sock.zapo?.message?.upload?.bind(sock.zapo);
    if (!upload) throw new Error('No media upload method available on the socket.');
    const uploaded = await upload(media, { type: uploadType });
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

  const sendOptions = {
    quoted: message,
    ...(options.mentions?.length ? { mentions: options.mentions } : {}),
  };

  /**
   * Mode deep (`deep: true`): submessages dikirim lewat proto
   * `botForwardedMessage` -> `richResponseMessage` dengan atribut forward bot
   * (docs raw-sends: wrapper ini diklasifikasikan sebagai text, jadi aman
   * terkirim). Tanpa `deep`, memakai `aiRichResponseMessage` biasa.
   */
  if (options.deep) {
    return sock.zapo.message.send(
      chat,
      {
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              messageType: 1,
              submessages,
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedAiBotMessageInfo: { botJid: options.botJid ?? '867051314767696@bot' },
                forwardOrigin: 4,
              },
            },
          },
        },
      },
      sendOptions,
    );
  }

  return sock.zapo.message.send(
    chat,
    { aiRichResponseMessage: { messageType: 1, submessages } },
    sendOptions,
  );
}
