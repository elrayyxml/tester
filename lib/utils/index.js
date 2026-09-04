export { logs, setDebug, isDebugEnabled, debug, info, success, warning, error } from './logs.js';
export { isPlainObject, delay, asString, mergeObjects, toBuffer } from './function.js';
export {
    createStickerExif,
    buildStickerExif,
    setWebpExif,
    applyStickerMeta,
    isWebP,
    isAnimatedWebP
} from './exif.js';
export { normalizeStickerPackOptions, prepareStickerBuffer } from './sticker-pack.js';

import { delay, isPlainObject, asString, mergeObjects, toBuffer } from './function.js';
import {
    createStickerExif,
    buildStickerExif,
    setWebpExif,
    applyStickerMeta,
    isWebP,
    isAnimatedWebP
} from './exif.js';
import { normalizeStickerPackOptions, prepareStickerBuffer } from './sticker-pack.js';
import { logs } from './logs.js';
import { Nodes } from '../core/node.js';

export const Utils = {
    delay,
    isPlainObject,
    asString,
    mergeObjects,
    toBuffer,
    createStickerExif,
    buildStickerExif,
    setWebpExif,
    applyStickerMeta,
    isWebP,
    isAnimatedWebP,
    normalizeStickerPackOptions,
    prepareStickerBuffer,
    Nodes,
    ...Nodes,
    logs
};
