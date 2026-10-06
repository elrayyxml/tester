/** @module core/connection */

import './polyfill.js';
import { WaClient } from 'zapo-js';
import { EventEmitter } from 'events';

import { createSessionStore } from './storage.js';
import { createInstance, getMediaProcessor } from './instance.js';
import { bindHelpers } from './binding.js';
import { wireListeners } from '../listeners/index.js';
import {
  getSessionState,
  MAX_RECONNECT,
  startPresenceKeepAlive,
  stopPresenceKeepAlive,
  statusConnected,
} from './private.js';
import { Logger } from '../utils/logger.js';
import { formatPairingCode } from '../utils/converter.js';
import { Config, Utils } from '../utils/functions.js';
import { loadModules } from '../utils/loader.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Identitas device per mode stealth untuk mengurangi deteksi bot: zapo
 * mengiklankan browser dan OS ini saat pairing.
 */
const STEALTH_DEVICES = {
  ios: { deviceBrowser: 'safari', deviceOsDisplayName: 'iOS' },
  android: { deviceBrowser: 'chrome', deviceOsDisplayName: 'Android' },
  web: { deviceBrowser: 'chrome', deviceOsDisplayName: 'Windows' },
  desktop: { deviceBrowser: 'desktop_app', deviceOsDisplayName: 'macOS' },
};

/** Alasan disconnect yang setara "restart required" Baileys. */
const RESTART_REASONS = new Set([
  'stream_error_replaced',
  'stream_error_ack',
  'stream_error_other',
  'comms_stopped',
]);

/** Alasan disconnect yang setara "forbidden" Baileys. */
const FORBIDDEN_REASONS = new Set([
  'failure_not_authorized',
  'failure_banned',
  'failure_locked',
  'stream_error_force_login',
]);

/** Helper pengiriman yang dipermukaan pada instance `sock` secara sinkron. */
const SOCK_SURFACE_METHODS = [
  'reply',
  'sendReact',
  'sendFile',
  'sendSticker',
  'sendMessageModify',
  'pollResult',
  'sendContact',
  'sendAlbumMessage',
  'groupStatus',
  'replyButton',
  'sendMetaMsg',
  'sendMessage',
  'relayMessage',
  'readMessages',
  'sendPresenceUpdate',
  'downloadMediaMessage',
  'waUploadToServer',
  'groupMetadata',
  'groupCreate',
  'groupLeave',
  'groupParticipantsUpdate',
  'groupSettingUpdate',
  'profilePictureUrl',
  'updateProfilePicture',
  'requestPairingCode',
];

/**
 * Koneksi WhatsApp utama. `new Client(opts)` langsung membuka koneksi dan
 * mengembalikan objek ini sebagai `sock`: permukaan socket (`sock.ev`,
 * `sock.reply`, `sock.sendMessage`, helper lain) dilekatkan pada instance,
 * sehingga `sock.on(...)` bekerja untuk event bawaan tanpa `await`.
 *
 * Event bawaan: connect, error, ready, qr, pairing_code, stories, message,
 * message.send, message.delete, group.add/remove/promote/demote/request,
 * presence. Event zapo mentah tersedia lewat `sock.ev.on(...)`.
 */
export class Client extends EventEmitter {
  /**
   * @param {import('../types/index.js').ConnectionOpts} opts
   */
  constructor(opts) {
    super();
    if (!opts?.custom_id) throw new Error('The "custom_id" option is required to initialize a client.');

    this.opts = opts;
    this.logger = new Logger(opts.custom_id, opts.debug ? 'debug' : 'info');
    /** @type {object|null} sock bergaya Baileys + helper */
    this.sock = null;
    /** @type {WaClient|null} */
    this.client = null;
    /** @type {object|null} session store zapo */
    this.store = null;
    /** @type {object} emitter event mentah zapo, sejajar `sock.ev` di Baileys */
    this.ev = new EventEmitter();
    this.ev.setMaxListeners(0);
    /** @type {Promise<object>|null} promise connect pertama untuk `ready()` */
    this.connecting = null;
    /** @type {Set<string>} perintah dari plugin plugsdir (`Commands`) */
    this.pluginCommands = new Set();
    /** @type {Array<object>} plugin berbentuk `{ handle, Commands }` */
    this.plugins = [];
    /** @type {Config} state antar-restart (opts.setting), tersedia di sock.config */
    this.config = new Config(opts.custom_id, opts.setting ?? {});

    this.sessionType = opts.create_session?.type ?? 'sqlite';
    this.sessionName = opts.create_session?.session ?? 'session';
    this.sessionConfig = opts.create_session?.config ?? {};

    this.#bindSocketSurface();
    this.connecting = this.connect();
  }

  /**
   * Pasang helper pengiriman secara sinkron pada instance, masing-masing
   * mendelegasikan ke socket asli saat dipanggil. Socket asli baru ada setelah
   * `connect()` selesai, sedangkan pemakai memanggil `sock.reply(...)` dari
   * dalam handler yang sudah pasti berjalan setelah koneksi terbuka.
   *
   * @private
   */
  #bindSocketSurface() {
    for (const name of SOCK_SURFACE_METHODS) {
      this[name] = (...args) => this.#requireSocket()[name](...args);
    }
  }

  /**
   * Socket asli, atau galat jelas bila dipanggil sebelum koneksi siap.
   *
   * @private
   * @returns {object}
   */
  #requireSocket() {
    if (!this.sock) {
      throw new Error('Socket is not ready yet: wait for the "ready" event before sending.');
    }
    return this.sock;
  }

  /**
   * Definisi plugin valid dari opts.engines; factory dipanggil tanpa argumen.
   *
   * @private
   * @param {Array} engines
   * @returns {Array<object>}
   */
  #resolveEngines(engines) {
    if (!Array.isArray(engines)) return [];
    return engines
      .map((engine) => (typeof engine === 'function' ? engine() : engine))
      .filter((e) => e && typeof e.id === 'string' && typeof e.setup === 'function');
  }

  /**
   * Muat plugin dari folder plugsdir. Setiap berkas `.js` dipindai; modul
   * boleh mengekspor definisi plugin zapo (atau factory-nya), `run(ctx)` gaya
   * sederhana, atau bentuk bot `{ handle, Commands }` yang perintahnya
   * didaftarkan ke `this.pluginCommands` agar presence hanya menyala untuk
   * perintah yang dikenal.
   *
   * @private
   * @param {string} dir
   * @returns {Promise<Array<object>>}
   */
  async #loadPlugDir(dir) {
    if (!dir) return [];
    const plugins = [];

    for (const { name, mod } of await loadModules(dir, { recursive: true })) {
      for (const command of mod?.default?.Commands ?? mod?.Commands ?? []) {
        if (typeof command === 'string') this.pluginCommands.add(command.toLowerCase());
      }

      const def = mod.default ?? mod.plugin;
      const resolved = typeof def === 'function' ? def(this) : def;

      if (!resolved && typeof mod.run === 'function') {
        plugins.push({ id: name, setup: (ctx) => mod.run(ctx) });
      } else if (resolved && typeof resolved.id === 'string' && typeof resolved.setup === 'function') {
        plugins.push(resolved);
      } else if (resolved?.handle) {
        this.plugins.push({ name, module: resolved });
      } else {
        this.logger.warn(`Plugin "${name}" is not a valid zapo plugin definition, skipped`);
      }
    }
    return plugins;
  }

  /**
   * Buka koneksi. Dipanggil otomatis oleh konstruktor; pemanggilan berikutnya
   * mengembalikan socket yang sama. Kegagalan connect dilaporkan lewat event
   * `error`.
   *
   * @returns {Promise<Client>} instance ini, siap dipakai sebagai sock
   */
  async connect() {
    const engines = [
      ...this.#resolveEngines(this.opts.engines),
      ...(await this.#loadPlugDir(this.opts.plugsdir)),
    ];

    this.store = await createSessionStore(this.sessionType, {
      ...this.sessionConfig,
      sessionDir: this.sessionName,
    });

    const stealthDevice = String(this.opts.stealth ?? '').toLowerCase();
    const stealth = STEALTH_DEVICES[stealthDevice];
    this.stealthDevice = stealth ? stealthDevice : undefined;

    const client = new WaClient(
      {
        store: this.store,
        sessionId: 'default',
        connectTimeoutMs: 30000,
        iqTimeoutMs: 30000,
        nodeQueryTimeoutMs: 30000,
        signalFetchKeyBundlesTimeoutMs: 30000,
        history: { enabled: false },
        keepAliveIntervalMs: 20000,
        markOnlineOnConnect: this.opts.online !== false,
        media: {
          processor: getMediaProcessor(),
          /**
           * Transcode non-Ogg voice notes to Ogg/Opus and build waveforms, so
           * `ptt` media renders as a real push-to-talk bubble.
           */
          normalizeVoiceNote: true,
          generateWaveform: true,
        },
        ...(stealth ? { auth: stealth } : {}),
        ...(engines.length ? { plugins: engines } : {}),
      },
      this.#zapoLogger(),
    );
    this.client = client;

    const sock = await createInstance(client, {
      ev: this.ev,
      device: this.stealthDevice,
      custom_id: this.opts.custom_id,
      storeSession: this.store.session?.('default'),
    });
    sock.config = this.config;
    sock.utils = Utils;

    this.sock = sock;
    this.#attachSocket(sock);

    wireListeners(client, sock, this, {
      ...this.opts,
      /** Perintah yang dikenal dan aturan prefix untuk gate presence. */
      commands: this.pluginCommands,
      prefixes: this.opts.prefix ?? this.opts.setting?.prefix ?? ['.', '/', '!', '#'],
      requirePrefix: this.opts.requirePrefix === true,
    });

    if (this.opts.pairing?.state) this.#setupPairing();
    else client.on('auth_qr', ({ qr }) => this.#showQr(qr));

    this.#wireConnection();

    client.connect().catch((error) => {
      this.logger.error(`Connection failed: ${error?.message || error}`);
      this.emit('error', error);
    });

    return this;
  }

  /**
   * Salin permukaan socket ke instance sehingga `sock.<method>` bekerja
   * langsung pada objek yang dikembalikan konstruktor. `ev` sengaja tidak
   * disalin karena sudah ada sebagai properti instance.
   *
   * @private
   * @param {object} sock
   */
  #attachSocket(sock) {
    for (const [name, value] of Object.entries(sock)) {
      if (name === 'ev' || name in this) continue;
      this[name] = value;
    }
  }

  /**
   * Logger pino-compatible untuk zapo: debug memforward seluruh aktivitas
   * internal (realtime), selain itu hanya warn/error.
   *
   * @private
   * @returns {object}
   */
  #zapoLogger() {
    const forward = (level) => (msg, ctx) => {
      if (level === 'trace') return;
      const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
      const extra = ctx ? ` ${JSON.stringify(ctx)}` : '';
      const out = `[zapo] ${text}${extra}`;
      if (level === 'error' || level === 'fatal') this.logger.error(out);
      else if (level === 'warn') this.logger.warn(out);
      else this.logger.debug(out);
    };

    const base = {
      level: 'silent',
      trace: forward('trace'),
      debug: forward('debug'),
      info: forward('info'),
      warn: forward('warn'),
      error: forward('error'),
      fatal: forward('fatal'),
      child: () => ({ ...base, child: base.child }),
    };
    return base;
  }

  /**
   * Pairing code diminta saat `auth_qr` PERTAMA — bukan `auth_pairing_required`,
   * event itu baru muncul setelah requestPairingCode dipanggil (deadlock).
   *
   * @private
   */
  #setupPairing() {
    let requested = false;

    const requestPairing = async () => {
      if (requested) return;
      requested = true;

      const { number, code } = this.opts.pairing;
      try {
        const raw = await this.client.auth.requestPairingCode(String(number).trim(), undefined, code || undefined);
        const formatted = formatPairingCode(raw);
        this.logger.info(`PHONE NUMBER: ${number}`);
        this.logger.info(`CODE PAIRING: ${formatted}`);
        this.emit('pairing_code', formatted);
      } catch (error) {
        requested = false;
        this.logger.error(`Failed to request pairing code: ${error?.message || error}`);
        this.emit('error', error);
      }
    };

    this.client.on('auth_qr', () => requestPairing());
    this.client.on('auth_pairing_required', ({ forceManual } = {}) => {
      if (forceManual) {
        requested = false;
        requestPairing();
      }
    });
  }

  /** @private @param {string} qr */
  #showQr(qr) {
    if (!qr) return;
    import('qrcode-terminal')
      .then((m) => (m.default?.generate ?? m.generate)(qr, { small: true }))
      .catch(() => this.logger.info(`QR: ${qr}`));
    this.emit('qr', qr);
  }

  /**
   * Reconnect per sesi dengan jeda per alasan dan exponential backoff.
   *
   * @private
   */
  #wireConnection() {
    const state = getSessionState(this.sessionName);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (!this.opts.pairing?.state) this.#showQr(qr);
        return;
      }

      if (connection === 'open') {
        Object.assign(state, { attempts: 0, reconnecting: false, qrCount: 0 });
        statusConnected.set(this.opts.custom_id, true);
        this.emit('connect');
        this.emit('ready', this.sock);
        if (this.opts.online !== false) startPresenceKeepAlive(this.sock, state);
        else stopPresenceKeepAlive(state);
        return;
      }

      if (connection !== 'close' || state.reconnecting) return;
      state.reconnecting = true;
      state.attempts++;

      const reason = lastDisconnect?.error?.output?.statusCode ?? 'unknown';
      this.logger.warn(`Reconnect ${state.attempts}/${MAX_RECONNECT} | Reason: ${reason}`);
      statusConnected.set(this.opts.custom_id, false);
      stopPresenceKeepAlive(state);

      try {
        this.sock.ev.removeAllListeners();
        this.client.removeAllListeners();
        await this.client.disconnect().catch(() => {});
      } catch (error) {
        this.logger.warn(`Cleanup error: ${error?.message || error}`);
      }

      if (update.isLogout) {
        state.reconnecting = false;
        this.logger.error('Session logged out. Reconnecting stopped.');
        return this.emit('error', new Error('logged_out'));
      }

      if (state.attempts >= MAX_RECONNECT) {
        state.reconnecting = false;
        this.logger.error('Maximum reconnect attempts reached. Reconnecting stopped.');
        return this.emit('error', new Error('max_reconnect'));
      }

      const wait = RESTART_REASONS.has(String(reason))
        ? 15000
        : FORBIDDEN_REASONS.has(String(reason))
          ? 30000
          : 5000 * state.attempts;
      await delay(wait);

      state.reconnecting = false;
      try {
        await this.connect();
      } catch (error) {
        this.logger.error(`Reconnect failed: ${error?.message || error}`);
        this.emit('error', error);
      }
    });
  }

  /**
   * Tunggu sampai sesi benar-benar online.
   *
   * @returns {Promise<Client>} instance ini setelah event `ready` terpancar
   */
  ready() {
    if (this.sock?.sessionReady?.()) return Promise.resolve(this);
    return new Promise((resolve) => this.once('ready', () => resolve(this)));
  }

  /** Tutup koneksi (disconnect, bukan logout). @returns {Promise<void>} */
  async close() {
    stopPresenceKeepAlive(getSessionState(this.sessionName));
    this.sock?.ev.removeAllListeners();
    this.client?.removeAllListeners();
    await this.client?.disconnect().catch(() => {});
    statusConnected.set(this.opts.custom_id, false);
  }

  /** Logout: unlink device, sesi harus pairing ulang. @returns {Promise<void>} */
  async logout() {
    await this.client?.logout();
    statusConnected.set(this.opts.custom_id, false);
  }
}

export default Client;
