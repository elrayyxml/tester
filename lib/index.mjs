import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const api = require('./index.js')

export const {
  ElrayyxmlError,
  NexrayError,
  ERROR_MESSAGES,
  wbError,
  getGlobalConfig,
  setGlobalConfig,
  Utils,
  Client,
  Extend,
  serialize,
  defaultBotDetector,
  makeInteractiveContent,
  decodeAudioMetadata,
  isNewsletterJid,
  bindMessageListener,
  bindChatListeners,
  bindNewsletterListeners,
  newsletterFollow,
  newsletterUnfollow,
  relayHelper,
  buildWAMessage,
  getBaileys,
  mergeContextInfo
} = api

export default api
