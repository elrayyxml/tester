/**
 * Core module barrel.
 *
 * @module core
 */

export { Client, default as defaultClient } from './client.js'
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
} from './message.js'
export {
    getContentType,
    normalizeMessageContent,
    extractMessageContent,
    getMessageType,
    isBotMessage,
    serializeMessage,
    extractText,
    buildQuoted
} from './serialize.js'
export {
    NODES,
    normalizeAdditionalNodes,
    mergeNodes,
    assertAdditionalNodes
} from './node.js'