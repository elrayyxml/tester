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
import { formatPairingCode, buildMessageId, generateMessageID } from '../utils/converter.js';
import { Config, Utils } from '../utils/functions.js';
import { loadModules } from '../utils/loader.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Identitas device per mode stealth untuk mengurangi deteksi bot.
 * Format ID pesan mengikuti device: ios `3A`+18, web `3E`+20,
 * android 32 tanpa awalan, desktop `3F`+18 (lihat getDevice).
 */
const STEALTH_DEVICES = {
  ios: { deviceBrowser: 'safari', deviceOsDisplayName: 'iOS', idPrefix: '3A', idLength: 20 },
  android: { deviceBrowser: 'chrome', deviceOsDisplayName: 'Android', idPrefix: '', idLength: 32 },
  web: { deviceBrowser: 'chrome', deviceOsDisplayName: 'Windows', idPrefix: '3E', idLength: 22 },
  desktop: { deviceBrowser: 'desktop_app', deviceOsDisplayName: 'macOS', idPrefix: '3F', idLength: 20 },
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

/**
 * Koneksi WhatsApp utama. Event bawaan: connect, error, ready, qr,
 * pairing_code, stories, message, message.send, message.delete,
 * group.add/remove/promote/demote/request, presence.
 *
 * Event zapo mentah tersedia lewat `sock.ev.on(...)` setelah connect.
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
    /** @type {Config} state antar-restart (opts.setting), tersedia di sock.config */
    this.config = new Config(opts.custom_id, opts.setting ?? {});

    this.sessionType = opts.create_session?.type ?? 'sqlite';
    this.sessionName = opts.create_session?.session ?? 'session';
    this.sessionConfig = opts.create_session?.config ?? {};
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
   * Muat plugin dari folder plugsdir. Modul mengekspor `default`/`plugin`
   * berupa definisi plugin zapo atau factory, atau `run(ctx)` gaya sederhana
   * yang dibungkus otomatis.
   *
   * @private
   * @param {string} dir
   * @returns {Promise<Array<object>>}
   */
  async #loadPlugDir(dir) {
    if (!dir) return [];
    const plugins = [];

    for (const { name, mod } of await loadModules(dir, { recursive: true })) {
      const def = mod.default ?? mod.plugin;
      const resolved = typeof def === 'function' ? def(this) : def;

      if (!resolved && typeof mod.run === 'function') {
        plugins.push({ id: name, setup: (ctx) => mod.run(ctx) });
      } else if (resolved && typeof resolved.id === 'string' && typeof resolved.setup === 'function') {
        plugins.push(resolved);
      } else {
        this.logger.warn(`Plugin "${name}" is not a valid zapo plugin definition, skipped`);
      }
    }
    return plugins;
  }

  /**
   * Buka koneksi. Kegagalan connect dilaporkan lewat event `error`.
   *
   * @returns {Promise<object>} sock
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

    const stealth = STEALTH_DEVICES[String(this.opts.stealth ?? '').toLowerCase()];

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
        media: { processor: getMediaProcessor() },
        ...(stealth ? { auth: stealth } : {}),
        ...(engines.length ? { plugins: engines } : {}),
      },
      this.#zapoLogger(),
    );
    this.client = client;

    const sock = await createInstance(client, {
      storeSession: this.store.session?.('default'),
    });
    bindHelpers(sock);
    sock.config = this.config;
    sock.utils = Utils;

    // ID pesan keluar: stealth memakai format per device dengan custom_id
    // ter-inject, selain itu format ELRAYY- bawaan.
    sock.generateMessageId = () =>
      stealth ? buildMessageId(stealth, this.opts.custom_id) : generateMessageID();

    this.sock = sock;

    wireListeners(client, sock, this, this.opts);

    if (this.opts.pairing?.state) this.#setupPairing();
    else client.on('auth_qr', ({ qr }) => this.#showQr(qr));

    this.#wireConnection();

    client.connect().catch((error) => {
      this.logger.error(`Connection failed: ${error?.message || error}`);
      this.emit('error', error);
    });

    return sock;
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

    const mintaKode = async () => {
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

    this.client.on('auth_qr', () => mintaKode());
    // Server minta kode baru ketika kuota refresh habis.
    this.client.on('auth_pairing_required', ({ forceManual } = {}) => {
      if (forceManual) {
        requested = false;
        mintaKode();
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

      // Bersihkan socket mati sebelum jeda agar listener lama tidak
      // memproses pesan ulang.
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
