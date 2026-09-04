export {
    isPlainObject,
    delay,
    asString,
    mergeObjects,
    toBuffer,
    generateMessageId,
    generateNexrayId,
    generateStealthId,
    isBotMessageId,
    extractMessageId,
    normalizeMediaInput
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

import {
    delay,
    isPlainObject,
    asString,
    mergeObjects,
    toBuffer,
    generateMessageId,
    generateNexrayId
} from './function.js';
import { applyStickerMeta, isWebP, createStickerExif } from './exif.js';
import { prepareStickerBuffer, normalizeStickerPackOptions } from './sticker-pack.js';
import { logs } from './logs.js';

/** Public Utils — minimal surface */
export const Utils = {
    delay,
    isPlainObject,
    asString,
    mergeObjects,
    toBuffer,
    generateMessageId,
    generateNexrayId,
    applyStickerMeta,
    isWebP,
    createStickerExif,
    prepareStickerBuffer,
    normalizeStickerPackOptions,
    logs
};
