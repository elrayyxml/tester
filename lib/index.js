/**
 * @nexray/lib - ESM entry point.
 *
 * import { Client, Utils, NODES } from '@nexray/lib'
 */

export { Client } from './core/index.js'
export {
    getContext,
    generateStealthId,
    makeMessageId,
    detectBotId,
    buildNewsletterAnnotation,
    resolveNewsletterAnnotation,
    assertNewsletterJid,
    buildContextInfo,
    resolveMentions,
    prepareMedia,
    generateMessage,
    relayMessage,
    normalizeColor,
    normalizeDate,
    buildStickerMetadata,
    buildVCard,
    buildGroupStatus,
    buildOrderMessage,
    buildInteractiveMessage,
    sendText,
    reply,
    sendReact,
    sendImage,
    sendVideo,
    sendAudio,
    sendFile,
    sendSticker,
    sendStickerPack,
    sendAlbum,
    sendInteractive,
    sendContact,
    sendProduct,
    sendLivePhoto,
    sendThumbnailPreview,
    sendCard,
    sendPoll,
    sendQuiz,
    sendPollResult,
    sendGroupStatus,
    sendStatusMentions,
    sendEvent,
    sendOrder,
    sendInVoice,
    sendLocation,
    attachMessageHelpers,
    dimension
} from './core/index.js'
export {
    getContentType,
    normalizeMessageContent,
    extractMessageContent,
    getMessageType,
    isBotMessage,
    serializeMessage,
    extractText,
    buildQuoted
} from './core/index.js'
export {
    NODES,
    normalizeAdditionalNodes,
    mergeNodes,
    assertAdditionalNodes
} from './core/index.js'
export { Utils } from './utils/index.js'
export {
    ErrorCodes,
    NexrayError,
    createError,
    toNexrayError
} from './constant/index.js'

import { Client as DefaultClient } from './core/index.js'
import { Utils } from './utils/index.js'
import { ErrorCodes, NexrayError } from './constant/index.js'

const Nexray = {
    Client: DefaultClient,
    Utils,
    ErrorCodes,
    NexrayError
}

export default Nexray