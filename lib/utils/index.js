export {
    asString,
    toMediaSource,
    asMedia,
    generateMessageId,
    generateNexrayId,
    generateStealthId,
    isBotMessageId,
    extractMessageId
} from './function.js';
export {
    createStickerExif,
    buildStickerExif,
    setWebpExif,
    applyStickerMeta,
    isWebP,
    isAnimatedWebP
} from './exif.js';
export { normalizeStickerPackOptions, prepareStickerBuffer } from './sticker-pack.js';
export { logs, setDebug, isDebugEnabled, debug, info, success, warning, error } from './logs.js';

import { asString, toMediaSource, generateMessageId, generateNexrayId } from './function.js';
import { applyStickerMeta, isWebP, createStickerExif } from './exif.js';
import { prepareStickerBuffer, normalizeStickerPackOptions } from './sticker-pack.js';
import { logs } from './logs.js';

export const Utils = {
    asString,
    toMediaSource,
    generateMessageId,
    generateNexrayId,
    applyStickerMeta,
    isWebP,
    createStickerExif,
    prepareStickerBuffer,
    normalizeStickerPackOptions,
    logs
};
