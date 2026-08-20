/**
 * @nexray/lib - dual entry point (import & require).
 *
 * Loads the ESM entry through node:module so a single file serves both
 * module systems. Requires Node.js >= 20.19 / >= 22.12 (require(esm)).
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const esm = require('./index.js')

export const Client = esm.Client
export const Utils = esm.Utils
export const NODES = esm.NODES
export const ErrorCodes = esm.ErrorCodes
export const NexrayError = esm.NexrayError
export const createError = esm.createError
export const toNexrayError = esm.toNexrayError
export const getContext = esm.getContext
export const generateStealthId = esm.generateStealthId
export const makeMessageId = esm.makeMessageId
export const detectBotId = esm.detectBotId
export const buildNewsletterAnnotation = esm.buildNewsletterAnnotation
export const resolveNewsletterAnnotation = esm.resolveNewsletterAnnotation
export const assertNewsletterJid = esm.assertNewsletterJid
export const buildContextInfo = esm.buildContextInfo
export const resolveMentions = esm.resolveMentions
export const prepareMedia = esm.prepareMedia
export const generateMessage = esm.generateMessage
export const relayMessage = esm.relayMessage
export const normalizeColor = esm.normalizeColor
export const normalizeDate = esm.normalizeDate
export const buildStickerMetadata = esm.buildStickerMetadata
export const buildVCard = esm.buildVCard
export const buildGroupStatus = esm.buildGroupStatus
export const buildOrderMessage = esm.buildOrderMessage
export const buildInteractiveMessage = esm.buildInteractiveMessage
export const sendText = esm.sendText
export const reply = esm.reply
export const sendReact = esm.sendReact
export const sendImage = esm.sendImage
export const sendVideo = esm.sendVideo
export const sendAudio = esm.sendAudio
export const sendFile = esm.sendFile
export const sendSticker = esm.sendSticker
export const sendStickerPack = esm.sendStickerPack
export const sendAlbum = esm.sendAlbum
export const sendInteractive = esm.sendInteractive
export const sendContact = esm.sendContact
export const sendProduct = esm.sendProduct
export const sendLivePhoto = esm.sendLivePhoto
export const sendThumbnailPreview = esm.sendThumbnailPreview
export const sendCard = esm.sendCard
export const sendPoll = esm.sendPoll
export const sendQuiz = esm.sendQuiz
export const sendPollResult = esm.sendPollResult
export const sendGroupStatus = esm.sendGroupStatus
export const sendStatusMentions = esm.sendStatusMentions
export const sendEvent = esm.sendEvent
export const sendOrder = esm.sendOrder
export const sendInVoice = esm.sendInVoice
export const sendLocation = esm.sendLocation
export const attachMessageHelpers = esm.attachMessageHelpers
export const dimension = esm.dimension
export const getContentType = esm.getContentType
export const normalizeMessageContent = esm.normalizeMessageContent
export const extractMessageContent = esm.extractMessageContent
export const getMessageType = esm.getMessageType
export const isBotMessage = esm.isBotMessage
export const serializeMessage = esm.serializeMessage
export const extractText = esm.extractText
export const buildQuoted = esm.buildQuoted
export const normalizeAdditionalNodes = esm.normalizeAdditionalNodes
export const mergeNodes = esm.mergeNodes
export const assertAdditionalNodes = esm.assertAdditionalNodes

export default esm.default