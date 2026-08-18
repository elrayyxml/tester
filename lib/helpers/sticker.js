'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStickerPackPaths = ensureStickerPackPaths;
exports.buildStickerExif = buildStickerExif;
exports.tagStickerWebp = tagStickerWebp;
exports.prepareStickerBuffer = prepareStickerBuffer;
exports.applyStickerFlags = applyStickerFlags;
exports.limitSharingCtx = limitSharingCtx;

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
    opts = opts || {};
    var name = String(opts.packname || opts.name || 'Sticker').trim() || 'Sticker';
    var publisher = String(opts.author || opts.publisher || name).trim() || name;
    var json = {
        'sticker-pack-id': opts.packId || (0, functions_1.generateMessageIDV2)(),
        'sticker-pack-name': name,
        'sticker-pack-publisher': publisher,
        emojis: Array.isArray(opts.emojis) ? opts.emojis : (opts.emojis ? [opts.emojis] : ['✨']),
        'is-avatar-sticker': opts.isAvatar ? 1 : 0,
        'is-ai-sticker': opts.isAi ? 1 : 0,
        'is-from-sticker-maker': 1,
        premium: opts.isPremium ? 1 : 0
    };
    var body = Buffer.from(JSON.stringify(json), 'utf8');
    var head = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
        0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    head.writeUIntLE(body.length, 14, 4);
    return Buffer.concat([head, body]);
}

function tagStickerWebp(buffer, opts) {
    var isRiff = buffer.length > 12
        && buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 12) === 'WEBP';
    var run = function (buf) {
        var exif = buildStickerExif(opts);
        var chunks = [];
        var off = 12;
        while (off + 8 <= buf.length) {
            var id = buf.toString('ascii', off, off + 4);
            var size = buf.readUInt32LE(off + 4);
            var pad = size + (size % 2);
            if (id !== 'EXIF') chunks.push(buf.slice(off, off + 8 + pad));
            off += 8 + pad;
        }
        var len = Buffer.alloc(4);
        len.writeUInt32LE(exif.length, 0);
        chunks.push(Buffer.concat([
            Buffer.from('EXIF'), len, exif,
            exif.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
        ]));
        var out = Buffer.concat(chunks);
        var riff = Buffer.alloc(4);
        riff.writeUInt32LE(4 + out.length, 0);
        return Buffer.concat([Buffer.from('RIFF'), riff, Buffer.from('WEBP'), out]);
    };
    if (isRiff) return Promise.resolve(run(buffer));
    try {
        var sharp = require('sharp');
        return sharp(buffer, { animated: true })
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 90 })
            .toBuffer()
            .then(run);
    } catch (_a) {
        return Promise.resolve(buffer);
    }
}

function prepareStickerBuffer(input, opts, resolveToBuffer) {
    return resolveToBuffer(input, 'sendSticker').then(function (buf) {
        if (!buf) throw new errors_1.NexrayError('Invalid sticker media', errors_1.ErrorCodes.INVALID_MEDIA);
        return tagStickerWebp(buf, opts || {});
    });
}

function applyStickerFlags(sm, options) {
    if (!sm || !options) return sm;
    var isPremium = !!(options.isPremium || options.premium);
    if (options.isAnimated != null) sm.isAnimated = !!options.isAnimated;
    if (options.isAvatar || options.avatar) sm.isAvatar = true;
    if (options.isAiSticker || options.isAi || options.ai) sm.isAiSticker = true;
    if (options.isLottie || options.lottie) sm.isLottie = true;
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
