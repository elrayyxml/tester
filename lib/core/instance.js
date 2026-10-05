/** @module core/instance */

import './polyfill.js';
import { WaClient } from 'zapo-js';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
<<<<<<< HEAD
// file-type v16 ekspor default { fromBuffer, fromFile }; v22 named exports.
=======
>>>>>>> 556940e (yapsjsj)
import * as ftModule from 'file-type';
const ftFromBuffer = ftModule.fileTypeFromBuffer ?? ftModule.default?.fromBuffer;
const ftFromFile = ftModule.fileTypeFromFile ?? ftModule.default?.fromFile;
import mimeTypes from 'mime-types';
import { createMediaProcessor } from '@zapo-js/media-utils';
import { createLidMappingCache } from '../utils/resolver.js';
import { toBytes, stripDevice, isJidValid } from '../utils/converter.js';
import { bindHelpers } from './binding.js';
import { sharpResize } from '../utils/functions.js';

let mediaProcessorSingleton;

/**
 * Media processor @zapo-js/media-utils. Tanpa ini zapo mengirim media tanpa
 * jpegThumbnail (preview kosong). Stateless, boleh dipakai lintas sesi.
 *
 * @returns {object} WaMediaProcessor
 */
export function getMediaProcessor() {
  if (!mediaProcessorSingleton) mediaProcessorSingleton = createMediaProcessor();
  return mediaProcessorSingleton;
}

/** Ukuran foto profil WhatsApp Web. */
const PROFILE_PICTURE_SIZE = 640;

/** Aksi peserta Baileys -> method coordinator zapo. */
const PARTICIPANT_ACTIONS = {
  add: 'addParticipants',
  remove: 'removeParticipants',
  promote: 'promoteParticipants',
  demote: 'demoteParticipants',
};

/** Setting grup Baileys -> pasangan (setting, enabled) zapo. */
const GROUP_SETTINGS = {
  announcement: ['announcement', true],
  not_announcement: ['announcement', false],
  locked: ['restrict', true],
  unlocked: ['restrict', false],
};

/** Field media Baileys -> `type` zapo. */
const MEDIA_KEYS = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
  ptv: 'ptv',
};

/** Field konten yang punya tempat sendiri di `options`, bukan di konten zapo. */
const OPTION_ONLY_KEYS = new Set([
  'mentions',
  'contextInfo',
  'quoted',
  'ephemeralExpiration',
  'viewOnce',
  'linkPreview',
]);

/** Mimetype cadangan per jenis media bila semua deteksi gagal. */
const FALLBACK_MIMETYPES = {
  image: 'image/jpeg',
  video: 'video/mp4',
  ptv: 'video/mp4',
  audio: 'audio/mpeg',
  sticker: 'image/webp',
  document: 'application/octet-stream',
};

const isBuffer = (value) => typeof Buffer !== 'undefined' && Buffer.isBuffer(value);
const isStream = (value) => value instanceof Readable;

/**
 * Sumber media Baileys -> sumber zapo. String URL diunduh dulu karena zapo
 * membaca string sebagai path file.
 *
 * @param {*} value
 * @returns {Promise<*>}
 */
async function resolveMedia(value) {
  if (value == null) return value;
  if (isBuffer(value) || value instanceof Uint8Array || isStream(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return fromUrlOrPath(value);
  if (typeof value === 'object') {
    if (value.url) return fromUrlOrPath(value.url);
    if (value.stream) return value.stream;
    if (value.buffer) return value.buffer;
  }
  return value;
}

/** @param {string} str */
async function fromUrlOrPath(str) {
  if (!/^https?:\/\//i.test(str)) return str;
  const res = await fetch(str);
  if (!res.ok) throw new Error(`Failed to download media (HTTP ${res.status}): ${str}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Deteksi mimetype: content.mimetype, lalu file-type, lalu mime-types dari
 * nama file, lalu fallback per jenis. zapo mewajibkan mimetype eksplisit.
 *
 * @param {*} media
 * @param {string} type
 * @param {object} content
 * @returns {Promise<string>}
 */
async function resolveMimetype(media, type, content) {
  if (content.mimetype) return content.mimetype;
  if (type === 'audio' && content.ptt) return 'audio/ogg; codecs=opus';

  try {
    if (isBuffer(media) || media instanceof Uint8Array) {
      const detected = await ftFromBuffer(media);
      if (detected?.mime) return detected.mime;
    } else if (typeof media === 'string' && !/^https?:\/\//i.test(media)) {
      const detected = await ftFromFile(media);
      if (detected?.mime) return detected.mime;
    }
    const looked = typeof content.fileName === 'string' && mimeTypes.lookup(content.fileName);
    if (looked) return looked;
  } catch {
    /* fallback mimetype */
  }
  return FALLBACK_MIMETYPES[type] ?? 'application/octet-stream';
}

/**
 * Salin field media Baileys yang namanya sama di proto zapo.
 *
 * @param {object} source
 * @param {object} target
 */
function copyMediaExtras(source, target) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !OPTION_ONLY_KEYS.has(key) && !(key in MEDIA_KEYS)) {
      target[key] = value;
    }
  }
}

/**
 * Konten bentuk `Proto.IMessage` mentah diteruskan zapo apa adanya. Pemeriksaan
 * sengaja longgar: fungsi ini dipanggil paling akhir sehingga apa pun yang
 * sampai sini memang bukan bentuk Baileys.
 *
 * @param {object} content
 * @returns {boolean}
 */
export function isRawProtoMessage(content) {
  return !!content && typeof content === 'object' && Object.keys(content).length > 0;
}

/**
 * Bangun `options` zapo dari argumen ketiga `sendMessage` dan field yang di
 * Baileys menempel pada konten (`mentions`, `contextInfo`).
 *
 * @param {object} content
 * @param {object} [baileysOptions]
 * @param {object} [sock] bila punya `generateMessageId`, ID bawaan adapter
 *   dipakai untuk setiap kirim tanpa `messageId` eksplisit
 * @returns {object}
 */
export function buildSendOptions(content, baileysOptions = {}, sock) {
  const options = {};

  const mentions = content?.mentions ?? content?.contextInfo?.mentionedJid;
  const mentionsValid = Array.isArray(mentions) ? mentions.filter(isJidValid) : [];
  if (mentionsValid.length) options.mentions = mentionsValid;

  const quoted = baileysOptions.quoted;
  if (quoted?.key?.id) {
    options.quote = {
      id: quoted.key.id,
      participant: quoted.key.participant ?? undefined,
      remoteJid: quoted.key.remoteJid ?? undefined,
      message: quoted.message ?? undefined,
    };
  } else if (quoted?.id) {
    options.quote = quoted;
  }

  const rawContext = content?.contextInfo ?? baileysOptions?.contextInfoRaw;
  if (rawContext && typeof rawContext === 'object') {
    const raw = Array.isArray(rawContext.mentionedJid)
      ? { ...rawContext, mentionedJid: rawContext.mentionedJid.filter(isJidValid) }
      : rawContext;
    options.contextInfo = { raw };
  }

  const expiration = baileysOptions.ephemeralExpiration ?? content?.ephemeralExpiration;
  if (expiration) options.expirationSeconds = Number(expiration);

  if (baileysOptions.messageId) options.id = baileysOptions.messageId;
  else if (sock?.generateMessageId) options.id = sock.generateMessageId();

  return options;
}

/**
 * Terjemahkan konten Baileys (shape-by-key) ke konten zapo
 * (discriminated union `{ type, ... }`), siap dipakai `client.message.send`.
 *
 * @param {string|object} content
 * @returns {Promise<object>}
 */
export async function toZapoContent(content) {
  if (typeof content === 'string') return { type: 'text', text: content };
  if (!content || typeof content !== 'object') {
    throw new Error('Invalid message content: expected a string or an object.');
  }

  if (content.react) return { type: 'reaction', emoji: content.react.text ?? '', target: content.react.key };
  if (content.delete) return { type: 'revoke', target: content.delete };

  if (content.poll) {
    return {
      type: 'poll',
      name: content.poll.name,
      options: content.poll.values ?? content.poll.options ?? [],
      selectableCount: content.poll.selectableCount ?? 1,
    };
  }

  if (content.pin) {
    return {
      type: content.pin.type === 2 || content.pin.unpin ? 'unpin' : 'pin',
      target: content.pin.key ?? content.pin,
      durationSecs: content.pin.time ?? undefined,
    };
  }

  if (content.location) return { locationMessage: content.location };
  if (content.contacts) {
    const list = content.contacts.contacts ?? [];
    if (list.length === 1) return { contactMessage: list[0] };
    return {
      contactsArrayMessage: {
        displayName: content.contacts.displayName ?? `${list.length} contacts`,
        contacts: list,
      },
    };
  }

  for (const [key, type] of Object.entries(MEDIA_KEYS)) {
    if (content[key] === undefined) continue;

    const out = { type, media: await resolveMedia(content[key]) };
    copyMediaExtras(content, out);
    delete out[key];
    out.mimetype = await resolveMimetype(out.media, type, content);
    return out;
  }

  if (typeof content.text === 'string') {
    const out = { type: 'text', text: content.text };
    if (content.linkPreview === false) out.linkPreview = false;
    return out;
  }
  if (typeof content.caption === 'string') return { type: 'text', text: content.caption };

  if (isRawProtoMessage(content)) return content;

  throw new Error(
    `Unrecognized message content shape. Supported keys: ${Object.keys(content).join(', ')}.`,
  );
}

/**
 * Samakan bentuk metadata grup zapo dengan Baileys: `id` dari `jid`,
 * `admin` dari `isAdmin`/`isSuperAdmin`, `phoneNumber` dari cache LID.
 * Tanpa `admin`/`id`, pola pemeriksaan admin Baileys
 * (`p.phoneNumber === sender && p.admin`) selalu gagal.
 *
 * @param {object} metadata
 * @param {object} lidCache
 * @returns {object}
 */
function normalizeGroupMetadata(metadata, lidCache) {
  if (!metadata || typeof metadata !== 'object') return metadata;

  const participants = (metadata.participants ?? []).map((p) => {
    lidCache.remember(p.lid ?? p.jid, p.phoneNumber);
    return {
      ...p,
      id: p.jid,
      admin: p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : null,
      phoneNumber: p.phoneNumber ?? lidCache.getPn(p.lid ?? p.jid) ?? undefined,
    };
  });

  return { ...metadata, id: metadata.jid, isCommunity: !!metadata.isParentGroup, participants };
}

/**
 * Buang `@` awal dari `to` node IQ gaya Baileys. zapo memakai `"g.us"`;
 * dengan `"@g.us"` server tidak membalas dan query timeout tanpa penjelasan.
 *
 * @param {object} node
 * @returns {object}
 */
function normalizeQueryNode(node) {
  const to = node?.attrs?.to;
  if (typeof to !== 'string' || !to.startsWith('@')) return node;
  return { ...node, attrs: { ...node.attrs, to: to.slice(1) } };
}

/**
 * Target atribut untuk operasi foto profil. zapo memakai `target` untuk
 * operasi admin grup; mengirim JID akun sendiri membuat server tidak membalas.
 *
 * @param {string} jid
 * @returns {string|undefined}
 */
function profilePictureTarget(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us') ? jid : undefined;
}

/** Transcode foto profil jadi JPEG persegi; zapo mengunggah byte apa adanya. */
async function toProfilePictureJpeg(bytes) {
  return new Uint8Array(await sharpResize(bytes, PROFILE_PICTURE_SIZE));
}

/**
 * Sambungkan event zapo ke nama event bergaya Baileys pada sock.ev.
 *
 * @param {object} client WaClient
 * @param {object} sock
 * @param {object} lidCache
 */
function wireEvents(client, sock, lidCache) {
  const { ev } = sock;

  client.on('connection', (event) => {
    if (event.status === 'open') {
      sock.ws.readyState = 1;
      sock.authState.creds.registered = true;
      const creds = client.auth?.getCurrentCredentials?.() ?? null;
      if (creds?.meJid) sock.user = { id: creds.meJid, name: creds.pushName };
      sock.refreshChats().catch(() => {});
      ev.emit('connection.update', { connection: 'open' });
      return;
    }

    sock.ws.readyState = 3;
    ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: Object.assign(new Error(event.reason), {
          output: { statusCode: event.code ?? event.reason },
        }),
        date: new Date(),
      },
      isLogout: event.isLogout,
    });
  });

  client.on('auth_qr', ({ qr }) => ev.emit('connection.update', { connection: 'connecting', qr }));

  client.on('auth_paired', ({ credentials }) => {
    sock.authState.creds.registered = true;
    if (credentials?.meJid) sock.user = { id: credentials.meJid };
  });

  client.on('message', (event) => {
    const key = event.key ?? {};

    lidCache.remember(key.remoteJid, key.remoteJidAlt);
    lidCache.remember(key.remoteJidAlt, key.remoteJid);
    lidCache.remember(key.participant, key.participantAlt);
    lidCache.remember(key.participantAlt, key.participant);

    const jid = key.remoteJid;
    if (jid && !sock.chats[jid]) sock.chats[jid] = { jid, name: event.pushName };

    ev.emit('messages.upsert', {
      messages: [{ ...event, messageTimestamp: event.timestampSeconds }],
      type: 'notify',
    });
  });

  const baileysParticipantActions = new Set(['add', 'remove', 'promote', 'demote']);

  client.on('group', (event) => {
    if (!event.groupJid || !event.participants?.length) return;

    for (const p of event.participants) lidCache.remember(p.lidJid, p.phoneJid);
    if (!baileysParticipantActions.has(event.action)) return;

    const participants = event.participants
      .map((p) => p.phoneJid ?? p.jid ?? p.lidJid)
      .filter(Boolean);
    if (!participants.length) return;

    ev.emit('group-participants.update', {
      id: event.groupJid,
      author: event.authorJid,
      participants,
      action: event.action,
    });
  });

  client.on('call', (event) => {
    ev.emit('call', [
      {
        id: event.callId,
            from: event.callerPnJid ?? event.callCreatorJid ?? event.senderLidJid,
        status: event.type,
        isVideo: !!event.isVideo,
        isGroup: !!event.groupJid,
      },
    ]);
  });

  client.on('picture', (event) => {
    if (!event?.jid) return;
    sock.contacts[event.jid] = { ...(sock.contacts[event.jid] ?? {}), id: event.jid };
    ev.emit('contacts.update', [sock.contacts[event.jid]]);
  });
}

/**
 * Buat sock bergaya Baileys di atas WaClient zapo, lengkap dengan
 * helper pengiriman adapter (via bindHelpers).
 *
 * @param {object} client WaClient zapo
 * @param {object} [options]
 * @param {object} [options.storeSession] store session zapo untuk memuat chats
 * @returns {Promise<object>} sock
 */
export async function createInstance(client, options = {}) {
  const ev = new EventEmitter();
  ev.setMaxListeners(0);

  const lidCache = createLidMappingCache();
  const chats = {};

  const sock = {
    /** Akses langsung ke client zapo untuk API asli. */
    zapo: client,
    ev,
    /** @type {object} */
    contacts: options.contacts ?? {},
    /** Cerminan thread store, dibaca sinkron oleh kode pemakai. */
    chats,
    user: null,
    authState: { creds: { registered: false } },
    /**
     * Sesi siap mengirim: kredensial kosong membuat zapo melempar
     * "sendMessage requires registered meJid".
     *
     * @returns {boolean}
     */
    sessionReady: () => !!client.auth?.getCurrentCredentials?.()?.meJid,
    /** Menutup socket saja, bukan logout (logout me-unlink device). */
    ws: { readyState: 0, close: () => client.disconnect().catch(() => {}) },
  };

  /* ------------------------------ PESAN ------------------------------ */

  sock.sendMessage = async (jid, content, options = {}) => {
    let zapoContent = await toZapoContent(content);
    const sendOptions = buildSendOptions(content, options, sock);

    /**
     * exclusive: true — hanya terlihat pengirim asli di grup. Wrapper
     * deviceSentMessage diterapkan pada proto mentah; butuh quoted agar
     * destinationJid diketahui.
     */
    if (options.exclusive && zapoContent?.conversation !== undefined) {
      const destination = options.quoted?.key?.participant ?? options.quoted?.participant;
      if (destination) {
        zapoContent = {
          deviceSentMessage: { destinationJid: destination, message: zapoContent },
        };
      }
    }

    let result;
    if (jid === 'status@broadcast') {
      /**
       * Status wajib lewat client.status.send; client.message.send
       * memperlakukannya seperti chat pribadi dan gagal "direct fanout
       * missing signal sessions".
       */
      const recipients = [...new Set(options.statusJidList ?? [])].filter(
        (target) => typeof target === 'string' && /^[^@\s]+@(s\.whatsapp\.net|lid)$/.test(target),
      );
      if (!recipients.length) {
        throw new Error(
          'Status update requires at least one recipient: provide a non-empty "statusJidList".',
        );
      }
      result = await client.status.send({ content: zapoContent, recipients, options: sendOptions });
    } else {
      result = await client.message.send(jid, zapoContent, sendOptions);
    }

    /**
     * Bentuk minimal pesan Baileys: `.key.id` dipakai plugin untuk
     * menghapus/mengedit pesan itu lagi.
     */
    return {
      key: { remoteJid: jid, fromMe: true, id: result?.id },
      message: zapoContent,
      status: 1,
      zapoResult: result,
    };
  };

  sock.relayMessage = async (jid, message, options = {}) =>
    client.message.send(jid, message, buildSendOptions({}, options, sock));

  /**
   * Tandai pesan dibaca. Key diteruskan sebagai event agar zapo menurunkan
   * `participant` — receipt grup/broadcast wajib menyebutnya, tanpa itu
   * receipt diabaikan server.
   *
   * @param {Array<object>} keys
   * @returns {Promise<void>}
   */
  sock.readMessages = async (keys) => {
    if (!Array.isArray(keys) || !keys.length) return;

    const events = [];
    for (const key of keys) {
      if (!key?.remoteJid || !key?.id) continue;
      const remoteJid = key.remoteJid;
      events.push({
        key: {
          ...key,
          remoteJid,
          isGroup: key.isGroup ?? remoteJid.endsWith('@g.us'),
          isBroadcast: key.isBroadcast ?? remoteJid.endsWith('@broadcast'),
          participant: key.participant ?? key.participantAlt,
        },
      });
    }

    if (events.length) await client.message.sendReceipt(events, { type: 'read' });
  };

  /**
   * @param {'available'|'unavailable'|'composing'|'recording'|'paused'} type
   * @param {string} [jid] wajib untuk chatstate
   * @returns {Promise<void>}
   */
  sock.sendPresenceUpdate = async (type, jid) => {
    if (type === 'available' || type === 'unavailable') return client.presence.send(type);
    /**
     * Chatstate hanya untuk jid user/group; zapo melempar error untuk
     * broadcast/newsletter/jid rusak, jadi dilewati diam-diam.
     */
    if (jid && jid.includes('@') && !jid.endsWith('@broadcast') && !jid.endsWith('@newsletter')) {
      return client.presence.sendChatstate(jid, { state: type });
    }
  };

  sock.waUploadToServer = (stream, opts = {}) =>
    client.message.upload(stream, { type: opts.mediaType ?? opts.type ?? 'image', ...opts });

  sock.downloadMediaMessage = (source, options) => client.message.downloadBytes(source, options);

  /* ------------------------------- GRUP ------------------------------ */

  sock.groupMetadata = async (jid) =>
    normalizeGroupMetadata(await client.group.queryGroupMetadata(jid), lidCache);

  sock.groupCreate = async (subject, participants) =>
    normalizeGroupMetadata(await client.group.createGroup(subject, participants), lidCache);

  sock.groupLeave = (jid) => client.group.leaveGroup([jid]);
  sock.groupInviteCode = (jid) => client.group.queryInviteCode(jid);
  sock.groupRevokeInvite = (jid) => client.group.revokeInvite(jid);
  sock.groupAcceptInvite = async (code) => (await client.group.joinGroupViaInvite(code))?.jid;
  sock.groupGetInviteInfo = async (code) =>
    normalizeGroupMetadata(await client.group.queryGroupInviteInfo(code), lidCache);
  sock.groupUpdateSubject = (jid, subject) => client.group.setSubject(jid, subject);
  sock.groupUpdateDescription = (jid, description) => client.group.setDescription(jid, description);
  sock.groupToggleEphemeral = (jid, seconds) => client.group.setEphemeralDuration(jid, seconds);

  /**
   * @param {string} jid
   * @param {Array<string>} participants
   * @param {'add'|'remove'|'promote'|'demote'} action
   * @returns {Promise<object>}
   */
  sock.groupParticipantsUpdate = async (jid, participants, action) => {
    const method = PARTICIPANT_ACTIONS[action];
    if (!method) throw new Error(`Unknown participant action: "${action}".`);
    return client.group[method](jid, participants);
  };

  /**
   * @param {string} jid
   * @param {'announcement'|'not_announcement'|'locked'|'unlocked'} setting
   * @returns {Promise<object>}
   */
  sock.groupSettingUpdate = async (jid, setting) => {
    const mapped = GROUP_SETTINGS[setting];
    if (!mapped) throw new Error(`Unknown group setting: "${setting}".`);
    return client.group.setSetting(jid, mapped[0], mapped[1]);
  };

  /** Baileys mengembalikan objek ber-key jid, bukan array. */
  sock.groupFetchAllParticipating = async () => {
    const all = await client.group.queryAllGroups();
    return Object.fromEntries(all.map((g) => [g.jid, normalizeGroupMetadata(g, lidCache)]));
  };

  sock.groupRequestParticipantsList = (jid) => client.group.queryMembershipApprovalRequests(jid);

  sock.groupRequestParticipantsUpdate = async (jid, participants, action) =>
    action === 'approve'
      ? client.group.approveMembershipRequests(jid, participants)
      : client.group.rejectMembershipRequests(jid, participants);

  /* ------------------------------ PROFIL ----------------------------- */

  sock.profilePictureUrl = async (jid, type = 'preview') => {
    const res = await client.profile.getProfilePicture(jid, type);
    return res?.url ?? null;
  };

  sock.updateProfilePicture = async (jid, image) => {
    const jpeg = await toProfilePictureJpeg(await toBytes(image));
    return client.profile.setProfilePicture(jpeg, profilePictureTarget(jid));
  };

  sock.removeProfilePicture = (jid) => client.profile.deleteProfilePicture(profilePictureTarget(jid));
  sock.updateProfileStatus = (status) => client.profile.setStatus(status);
  sock.updateProfileName = (name) => client.profile.setPushName(name);
  sock.fetchStatus = (jid) => client.profile.getStatus(jid);

  sock.onWhatsApp = async (...jids) => {
    const results = await client.profile.getLidsByPhoneNumbers(jids.flat().filter(Boolean));
    return results.map((r) => ({ jid: r.phoneJid, lid: r.lidJid, exists: r.exists }));
  };

  sock.updateBlockStatus = (jid, action) =>
    action === 'block' ? client.privacy.blockUser(jid) : client.privacy.unblockUser(jid);

  sock.fetchBlocklist = async () => (await client.privacy.getBlocklist())?.jids ?? [];

  /* ------------------------------- CHAT ------------------------------ */

  /**
   * Modifikasi chat: clear, delete, archive, pin, markRead, mute, star.
   *
   * @param {object} mod
   * @param {string} jid
   * @returns {Promise<object|void>}
   */
  sock.chatModify = async (mod, jid) => {
    if (mod.clear) {
      if (Array.isArray(mod.clear.messages)) {
        for (const msg of mod.clear.messages) {
          await client.chat.deleteMessageForMe({ ...msg, remoteJid: jid });
        }
        return;
      }
      return client.chat.clearChat(jid);
    }
    if (mod.delete) return client.chat.deleteChat(jid);
    if ('archive' in mod) return client.chat.setChatArchive(jid, !!mod.archive);
    if ('pin' in mod) return client.chat.setChatPin(jid, !!mod.pin);
    if ('markRead' in mod) return client.chat.setChatRead(jid, !!mod.markRead);
    if ('mute' in mod) return client.chat.setChatMute(jid, mod.mute != null, mod.mute ?? undefined);
    if (mod.star) return client.chat.setMessageStar(mod.star.messages?.[0], !!mod.star.star);
    throw new Error(
      `Unrecognized chatModify operation. Supported keys: ${Object.keys(mod).join(', ')}.`,
    );
  };

  /* --------------------------- LEVEL RENDAH -------------------------- */

  sock.query = (node, timeoutMs) => client.lowlevel.query(normalizeQueryNode(node), timeoutMs);
  sock.sendNode = (node) => client.lowlevel.sendNode(node);
  sock.logout = () => client.logout();

  sock.requestPairingCode = (phoneNumber, customCode) =>
    client.auth.requestPairingCode(phoneNumber, undefined, customCode);

  /**
   * Arah nomor -> LID ditanyakan ke server; arah LID -> nomor tidak punya API
   * di zapo, dilayani dari cache yang diisi pesan masuk dan metadata grup.
   */
  sock.signalRepository = {
    lidMapping: {
      getPNForLID: async (lid) => lidCache.getPn(lid),
      getLIDForPN: async (pn) => {
        const cached = lidCache.getLid(pn);
        if (cached) return cached;

        const [hit] = await client.profile.getLidsByPhoneNumbers([pn]);
        if (hit?.lidJid) lidCache.remember(hit.lidJid, hit.phoneJid ?? pn);
        return hit?.lidJid ?? null;
      },
    },
  };

  /** Jumlah entri cache LID, untuk debugging dari plugin. @returns {number} */
  sock.lidMappingSize = () => lidCache.size;

  /**
   * Muat ulang `sock.chats` dari thread store zapo; store bisa dimatikan
   * lewat konfigurasi, kegagalan tidak boleh memutus koneksi.
   *
   * @returns {Promise<object>}
   */
  sock.refreshChats = async () => {
    if (!options.storeSession?.threads) return chats;
    try {
      for (const record of await options.storeSession.threads.list()) chats[record.jid] = record;
    } catch (error) {
      console.warn('[CHATS] Gagal memuat daftar chat:', error?.message || error);
    }
    return chats;
  };

  wireEvents(client, sock, lidCache);

  return bindHelpers(sock);
}

export { stripDevice };
