'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStickerPackPaths = ensureStickerPackPaths;
exports.buildStickerExif = buildStickerExif;
exports.tagStickerWebp = tagStickerWebp;
exports.prepareStickerBuffer = prepareStickerBuffer;
exports.applyStickerFlags = applyStickerFlags;

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

function buildStickerExif(opts) {
    if (opts === void 0) opts = {};
    var json = {
        'sticker-pack-id': opts.packId || (0, functions_1.generateMessageIDV2)(),
        'sticker-pack-name': opts.packname || opts.name || '',
        'sticker-pack-publisher': opts.author || opts.publisher || '',
        emojis: Array.isArray(opts.emojis) ? opts.emojis : (opts.emojis ? [opts.emojis] : ['']),
        'is-avatar-sticker': opts.isAvatar ? 1 : 0,
        'is-ai-sticker': opts.isAi ? 1 : 0,
        'is-from-sticker-maker': 1,
        premium: opts.isPremium ? 1 : 0
    };
    if (opts.androidAppStoreLink) json['android-app-store-link'] = opts.androidAppStoreLink;
    if (opts.iosAppStoreLink) json['ios-app-store-link'] = opts.iosAppStoreLink;
    var jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    var attr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
        0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    attr.writeUIntLE(jsonBuffer.length, 14, 4);
    return Buffer.concat([attr, jsonBuffer]);
}

function tagStickerWebp(buffer, opts) {
    return Promise.resolve().then(function () {
        var isRiff = buffer.length > 12
            && buffer.toString('ascii', 0, 4) === 'RIFF'
            && buffer.toString('ascii', 8, 12) === 'WEBP';
        if (!isRiff) {
            try {
                var sharp = require('sharp');
                return sharp(buffer, { animated: true })
                    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp({ quality: 90 })
                    .toBuffer()
                    .then(function (c) { return tagStickerWebp(c, opts); });
            } catch (_a) {
                return buffer;
            }
        }
        var exif = buildStickerExif(opts || {});
        var chunks = [];
        var off = 12;
        while (off + 8 <= buffer.length) {
            var id = buffer.toString('ascii', off, off + 4);
            var size = buffer.readUInt32LE(off + 4);
            var padded = size + (size % 2);
            if (id !== 'EXIF') chunks.push(buffer.slice(off, off + 8 + padded));
            off += 8 + padded;
        }
        var exifChunk = Buffer.concat([
            Buffer.from('EXIF'),
            (function () { var b = Buffer.alloc(4); b.writeUInt32LE(exif.length, 0); return b; })(),
            exif,
            exif.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
        ]);
        chunks.push(exifChunk);
        var out = Buffer.concat(chunks);
        var riffSize = Buffer.alloc(4);
        riffSize.writeUInt32LE(4 + out.length, 0);
        return Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBP'), out]);
    });
}

function prepareStickerBuffer(input, opts, resolveToBuffer) {
    return resolveToBuffer(input, 'sendSticker').then(function (buf) {
        if (!buf) {
            throw new errors_1.NexrayError('sendSticker: invalid media', errors_1.ErrorCodes.INVALID_MEDIA);
        }
        return tagStickerWebp(buf, opts || {});
    });
}

/** Apply sticker option flags onto stickerMessage (and re-apply after proto). */
function applyStickerFlags(sm, options) {
    if (!sm || !options) return sm;
    var isPremium = !!(options.isPremium || options.premium);
    var isAi = !!(options.isAiSticker || options.isAi || options.ai);
    var isAvatar = !!(options.isAvatar || options.avatar);
    var isLottie = !!(options.isLottie || options.lottie);
    if (options.isAnimated != null) sm.isAnimated = !!options.isAnimated;
    if (isAvatar) sm.isAvatar = true;
    if (isAi) sm.isAiSticker = true;
    if (isLottie) sm.isLottie = true;
    if (isPremium) sm.premium = typeof options.premium === 'number' ? options.premium : 1;
    if (options.emojis != null) {
        sm.emojis = Array.isArray(options.emojis) ? options.emojis.join('') : String(options.emojis);
    }
    if (options.accessibilityLabel) sm.accessibilityLabel = String(options.accessibilityLabel);
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
exports.limitSharingCtx = limitSharingCtx;
