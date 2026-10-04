/** @module core/polyfill */

import { WebSocket } from 'ws';

/**
 * Polyfill globalThis.WebSocket untuk Node < 22.
 *
 * zapo-js membuka koneksi lewat globalThis.WebSocket dan melempar
 * "global WebSocket is not available" bila tidak ada. `ws` menerima argumen
 * ketiga `{ headers, agent }` yang dipakai zapo saat proxy aktif.
 *
 * Wajib di-import sebelum `new WaClient(...)`: konstruktor WebSocket
 * di-resolve sekali di awal, bukan saat koneksi dibuka.
 */
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

export default globalThis.WebSocket;
