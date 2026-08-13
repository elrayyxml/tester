/**
 * @nexray/lib – ESM entry point
 * Re-exports the same public API as the CJS index.
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const cjs = require('./index.js')

export const {
  Client,
  Extend,
  serialize,
  Utils,
  getGlobalConfig,
  setGlobalConfig,
  NexrayError,
  ErrorMessages
} = cjs

export default cjs
