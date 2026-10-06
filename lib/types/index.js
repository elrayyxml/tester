/**
 * @typedef {'mongo'|'postgres'|'local'|'mysql'|'sqlite'|'redis'} SessionType
 */

/**
 * @typedef {object} PairingOpts
 * @property {boolean} state `true` memakai pairing code, `false` QR scan
 * @property {string} number Nomor bot
 * @property {string} [code] Kode pairing custom, 8 karakter dari
 *   `123456789ABCDEFGHJKLMNPQRSTVWXYZ` (server menolak 0, I, O, U)
 */

/**
 * @typedef {object} CreateSessionOpts
 * @property {SessionType} type
 * @property {string} session Nama atau folder sesi
 * @property {any} [config] Konfigurasi backend (uri mongo, pool mysql, dst.)
 * @property {string|number} [number]
 * @property {string|number} [owner]
 */

/**
 * @typedef {object} ConnectionOpts
 * @property {boolean} [online] Selalu tampil online (keepalive presence available)
 * @property {boolean} [presence] Autoread + chatstate composing pada pesan masuk
 * @property {'ios'|'android'|'web'|'desktop'} [stealth] Meniru device resmi:
 *   identitas browser/os ditukar dan ID pesan keluar mengikuti format device
 *   (android 32 heksadesimal, ios `3A*`, web/desktop `3EB0*`)
 * @property {string} custom_id ID pesan custom; di-inject ke ID pesan keluar
 *   sehingga pesan dari bot ini dapat dikenali, juga dipakai sebagai scope
 *   logger dan nama berkas config
 * @property {PairingOpts} [pairing]
 * @property {boolean} [multiple] Izinkan banyak sesi
 * @property {CreateSessionOpts} [create_session]
 * @property {any} [setting] State bebas (owner, cover, footer, dll.), dipersist
 *   ke `<custom_id>.config.json` dan tersedia di `sock.config`
 * @property {any[]} [engines] Plugin zapo (hasil defineWaClientPlugin, mis. voipPlugin())
 * @property {boolean} [debug] `true` memforward aktivitas internal zapo
 *   (trace/debug) ke logger realtime; warn/error selalu tampil
 * @property {string} [plugsdir] Folder plugin: setiap berkas `.js` dipindai,
 *   `Commands` dari tiap modul dipakai sebagai daftar perintah
 * @property {string[]} [prefix] Daftar prefix perintah, mis. `['.', '!', '#']`.
 *   Dipakai gate presence bersama `Commands` plugin
 * @property {boolean} [requirePrefix] `true` bila perintah wajib berprefix
 */

/**
 * Tipe engine: definisi plugin zapo atau factory `(ctx) => definition`.
 *
 * @typedef {object|function} Engine
 */

export {};
