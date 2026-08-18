'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStickerPackPaths = ensureStickerPackPaths;
exports.prepareStickerBuffer = prepareStickerBuffer;
exports.applyStickerFlags = applyStickerFlags;
exports.limitSharingCtx = limitSharingCtx;
exports.buildNativeStickerPack = buildNativeStickerPack;

var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var functions_1 = require('../utils/functions');
var errors_1 = require('../constant/errors');

function ensureStickerPackPaths(b) {
    try {
        var defs = b.MEDIA_PATH_MAP || (b.Defaults && b.Defaults.MEDIA_PATH_MAP);
        if (defs && !defs['sticker-pack']) {
            defs['sticker-pack'] = '/mms/sticker-pack';
            defs['thumbnail-sticker-pack'] = '/mms/thumbnail-sticker-pack';
        }
        var hk = b.MEDIA_HKDF_KEY_MAPPING || (b.Defaults && b.Defaults.MEDIA_HKDF_KEY_MAPPING);
        if (hk && !hk['sticker-pack']) {
            hk['sticker-pack'] = 'Sticker Pack';
            hk['thumbnail-sticker-pack'] = 'Sticker Pack Thumbnail';
        }
    } catch (_a) { }
}

function buildExif(opts) {
    opts = opts || {};
    var packname = String(opts.packname || opts.name || 'Sticker').trim() || 'Sticker';
    var author = String(opts.author || opts.publisher || 'Nexray').trim() || 'Nexray';
    var json = {
        'sticker-pack-id': opts.packId || (0, functions_1.generateMessageIDV2)(),
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        emojis: Array.isArray(opts.emojis) ? opts.emojis : (opts.emojis ? [opts.emojis] : [''])
    };
    if (opts.isAvatar) json['is-avatar-sticker'] = 1;
    if (opts.isAi) json['is-ai-sticker'] = 1;
    if (opts.isPremium) json.premium = 1;
    var body = Buffer.from(JSON.stringify(json), 'utf8');
    var head = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
        0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    head.writeUIntLE(body.length, 14, 4);
    return Buffer.concat([head, body]);
}

/** Prefer node-webpmux (reliable EXIF); fallback manual RIFF splice. */
function writeExifWebp(buffer, opts) {
    var exif = buildExif(opts);
    try {
        var webp = require('node-webpmux');
        var img = new webp.Image();
        var tmpIn = path.join(os.tmpdir(), 'nx_' + crypto.randomBytes(6).toString('hex') + '.webp');
        var tmpOut = path.join(os.tmpdir(), 'nx_' + crypto.randomBytes(6).toString('hex') + '.webp');
        fs.writeFileSync(tmpIn, buffer);
        return img.load(tmpIn).then(function () {
            img.exif = exif;
            return img.save(tmpOut);
        }).then(function () {
            var out = fs.readFileSync(tmpOut);
            try { fs.unlinkSync(tmpIn); } catch (_a) { }
            try { fs.unlinkSync(tmpOut); } catch (_b) { }
            return out;
        }).catch(function () {
            try { fs.unlinkSync(tmpIn); } catch (_c) { }
            return spliceExif(buffer, exif);
        });
    } catch (_d) {
        return Promise.resolve(spliceExif(buffer, exif));
    }
}

function spliceExif(buffer, exif) {
    if (!(buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')) {
        return buffer;
    }
    var chunks = [];
    var off = 12;
    while (off + 8 <= buffer.length) {
        var id = buffer.toString('ascii', off, off + 4);
        var size = buffer.readUInt32LE(off + 4);
        var pad = size + (size % 2);
        if (id !== 'EXIF') chunks.push(buffer.slice(off, off + 8 + pad));
        off += 8 + pad;
    }
    var len = Buffer.alloc(4);
    len.writeUInt32LE(exif.length, 0);
    chunks.push(Buffer.concat([
        Buffer.from('EXIF'), len, exif,
        exif.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
    ]));
    var body = Buffer.concat(chunks);
    var riff = Buffer.alloc(4);
    riff.writeUInt32LE(4 + body.length, 0);
    return Buffer.concat([Buffer.from('RIFF'), riff, Buffer.from('WEBP'), body]);
}

function toWebp(buffer) {
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return Promise.resolve(buffer);
    }
    try {
        var sharp = require('sharp');
        return sharp(buffer, { animated: true })
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 90 })
            .toBuffer();
    } catch (_a) {
        return Promise.resolve(buffer);
    }
}

function prepareStickerBuffer(input, opts, resolveToBuffer) {
    return resolveToBuffer(input, 'sendSticker').then(function (buf) {
        if (!buf) throw new errors_1.NexrayError('Invalid sticker media');
        return toWebp(buf).then(function (webp) { return writeExifWebp(webp, opts || {}); });
    });
}

function applyStickerFlags(sm, options) {
    if (!sm || !options) return sm;
    if (options.isAnimated != null) sm.isAnimated = !!options.isAnimated;
    if (options.isAvatar || options.avatar) sm.isAvatar = true;
    if (options.isAiSticker || options.isAi || options.ai) sm.isAiSticker = true;
    if (options.isLottie || options.lottie) sm.isLottie = true;
    if (options.isPremium || options.premium) sm.premium = typeof options.premium === 'number' ? options.premium : 1;
    if (options.emojis != null) {
        sm.emojis = Array.isArray(options.emojis) ? options.emojis.join('') : String(options.emojis);
    }
    return sm;
}

function limitSharingCtx() {
    return {
        limitSharingV2: {
            sharingLimited: true,
            trigger: 1,
            limitSharingSettingTimestamp: String(Date.now()),
            initiatedByMe: true
        }
    };
}

function buildNativeStickerPack(sock, baileys, pack) {
    return Promise.resolve().then(function () {
        var JSZip;
        try { JSZip = require('jszip'); }
        catch (_a) {
            throw new errors_1.NexrayError('jszip is required for sticker packs (npm i jszip)');
        }
        ensureStickerPackPaths(baileys);
        var name = String(pack.name || pack.packname).trim() || '';
        var publisher = String(pack.publisher || pack.author).trim() || '';
        var items = pack.stickers || [];

        function resolveBuf(input) {
            if (Buffer.isBuffer(input)) return Promise.resolve(input);
            if (input && input.url) input = input.url;
            if (typeof input === 'string') {
                if (/^https?:\/\//i.test(input)) {
                    return fetch(input).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return Buffer.from(ab); });
                }
                return fs.promises.readFile(input);
            }
            return Promise.reject(new Error('invalid sticker data'));
        }

        return Promise.all(items.map(function (s) {
            return resolveBuf(s.data || s.url || s.buffer || s).then(function (buf) {
                return { buffer: buf, emojis: s.emojis || [''], mimetype: 'image/webp' };
            });
        })).then(function (hydrated) {
            var zip = new JSZip();
            var meta = [];
            hydrated.forEach(function (item) {
                var hash = crypto.createHash('sha256').update(item.buffer).digest('base64')
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
                var fileName = hash + '.webp';
                zip.file(fileName, item.buffer);
                meta.push({ fileName: fileName, isAnimated: false, emojis: item.emojis, accessibilityLabel: '', mimetype: 'image/webp' });
            });
            var tray = hydrated[0] && hydrated[0].buffer;
            return Promise.resolve(tray).then(function (trayBuffer) {
                zip.file('tray_icon.webp', trayBuffer || Buffer.alloc(0));
                return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }).then(function (archive) {
                    if (typeof baileys.encryptedStream !== 'function') {
                        throw new errors_1.NexrayError('baileys.encryptedStream is required for sticker packs');
                    }
                    return baileys.encryptedStream(archive, 'sticker-pack', {}).then(function (packUp) {
                        return sock.waUploadToServer(packUp.encFilePath, {
                            fileEncSha256B64: packUp.fileEncSha256.toString('base64'),
                            mediaType: 'sticker-pack'
                        }).then(function (packResult) {
                            try { fs.unlinkSync(packUp.encFilePath); } catch (_b) { }
                            return {
                                stickerPackId: 'Pack_' + crypto.randomBytes(8).toString('hex'),
                                name: name,
                                publisher: publisher,
                                packDescription: pack.description || '',
                                stickers: meta,
                                fileLength: packUp.fileLength,
                                fileSha256: packUp.fileSha256,
                                fileEncSha256: packUp.fileEncSha256,
                                mediaKey: packUp.mediaKey,
                                directPath: packResult.directPath,
                                mediaKeyTimestamp: Math.floor(Date.now() / 1000),
                                stickerPackSize: packUp.fileLength,
                                stickerPackOrigin: 2,
                                trayIconFileName: 'tray_icon.webp'
                            };
                        });
                    });
                });
            });
        });
    });
}
