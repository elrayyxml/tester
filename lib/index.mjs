/**
 * @nexray/lib – ESM entry
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const cjs = require('./index.js')

export const Client = cjs.Client
export const Extend = cjs.Extend
export const serialize = cjs.serialize
export const Utils = cjs.Utils
export const getGlobalConfig = cjs.getGlobalConfig
export const setGlobalConfig = cjs.setGlobalConfig
export const NexrayError = cjs.NexrayError
export const ErrorMessages = cjs.ErrorMessages

export default cjs
