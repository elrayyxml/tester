/**
 * Centralized constants used across the library.
 *
 * Re-exports the error system and shared default values so consumers and
 * internal modules import from a single place.
 *
 * @module constant
 */

export {
    ErrorCodes,
    NexrayError,
    createError,
    toNexrayError
} from './error.js'

/** Default message ID prefix used when no custom_id is configured. */
export const DEFAULT_MESSAGE_ID_PREFIX = ''

/** Devices supported by the stealth message ID configuration. */
export const STEALTH_DEVICES = Object.freeze(['ios', 'android', 'web', 'desktop'])

/** Newsletter JID suffix. */
export const NEWSLETTER_SUFFIX = '@newsletter'

/** Group JID suffix. */
export const GROUP_SUFFIX = '@g.us'

/** Status broadcast JID. */
export const STATUS_BROADCAST = 'status@broadcast'