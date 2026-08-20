/**
 * Utility-level contracts.
 *
 * These typedefs describe the shapes consumed and produced by the utility
 * modules. They are documentation-only and have no runtime footprint.
 *
 * @module types/utils
 */

/**
 * A debug logger created by the Client. Honors the `debug` configuration.
 *
 * @typedef {object} Logger
 * @property {function(string, ...any): void} debug - Print a debug message.
 * @property {function(string, ...any): void} info - Print an info message.
 * @property {function(string, ...any): void} warn - Print a warning message.
 * @property {function(string, ...any): void} error - Print an error message.
 */

/**
 * Resolved media result produced by the converter module.
 *
 * @typedef {object} ResolvedMedia
 * @property {Buffer} buffer - The media buffer.
 * @property {string} [mimetype] - Detected mime type.
 * @property {string} [extension] - Detected file extension without the dot.
 * @property {boolean} isUrl - Whether the input was a URL.
 * @property {boolean} isPath - Whether the input was a local path.
 * @property {boolean} isBuffer - Whether the input was a raw buffer.
 */

/**
 * Sticker EXIF metadata.
 *
 * @typedef {object} StickerMetadata
 * @property {string} 'sticker-pack-id' - Pack id.
 * @property {string} 'sticker-pack-name' - Pack name.
 * @property {string} 'sticker-pack-publisher' - Pack publisher.
 * @property {string[]} [emojis] - Suggested emojis.
 * @property {string} [accessibility-text] - Accessibility text.
 * @property {boolean|number} [is-avatar-sticker] - Avatar sticker flag.
 * @property {boolean|number} [is-ai-sticker] - AI sticker flag.
 * @property {boolean|number} [is-from-sticker-maker] - Sticker maker flag.
 */

/**
 * Sticker pack payload accepted by the sticker pack helper.
 *
 * The legacy object form; the modern form passes `stickers` as the second
 * positional argument with pack fields in options.
 *
 * @typedef {object} StickerPackPayload
 * @property {Array<MediaInput|{media: MediaInput, name?: string, emojis?: string[], accessibilityLabel?: string}>} stickers - List of sticker media (or media objects).
 * @property {MediaInput} [cover] - Cover/tray icon media.
 * @property {string} [name] - Pack name.
 * @property {string} [publisher] - Pack publisher.
 * @property {string} [description] - Pack description.
 * @property {string} [caption] - Alias for description.
 * @property {string[]} [emojis] - Default sticker emojis.
 */

/**
 * A single card inside a card / carousel message.
 *
 * @typedef {object} CardPayload
 * @property {string} [text] - Carousel body text.
 * @property {string} [footer] - Carousel footer text.
 * @property {Array<object>} cards - Card entries.
 * @property {MediaInput} cards[].image - Card media (image or video required).
 * @property {MediaInput} cards[].video - Card media (image or video required).
 * @property {string} [cards[].caption] - Card body text.
 * @property {string} [cards[].title] - Card header title.
 * @property {string} [cards[].subtitle] - Card header subtitle.
 * @property {string} [cards[].footer] - Card footer text.
 * @property {Array<object>} [cards[].buttons] - Native flow buttons (`{ name, buttonParamsJson }`).
 * @property {Array<object>} [cards[].interactiveButtons] - Alias for buttons.
 * @property {Array<object>} [cards[].nativeFlow] - Alias for buttons.
 * @property {object} [cards[].messageParamsJson] - Native flow message params (JSON-stringified).
 * @property {object} [contextInfo] - Extra context info for the interactive message.
 */

/**
 * The public `Utils` namespace exported by the library.
 *
 * Users can inject project-local helpers into it with `Utils.extend({ ... })`,
 * or import the individual helpers (`Utils.xxx`) to compose their own
 * utilities.
 *
 * @typedef {object} Utils
 * @property {function(unknown, number|null=): (string|boolean)} size - Formats a byte count, or compares it against a threshold in MB.
 * @property {function(Buffer|string): Promise<Buffer>} sharp - Resizes an image to a 300x300 cover thumbnail.
 * @property {function(Array): unknown} random - Returns a random element from an array.
 * @property {function(string, string): string} texted - Wraps text with WhatsApp formatting (`bold`, `italic`, `strike`, `mono`).
 * @property {function(string, string, string=): string} example - Builds a `• *Example* :` help string.
 * @property {function(string): boolean} isURL - True when the value parses as a URL.
 * @property {function(string): boolean} isUrlValid - True when the string matches `https?://...`.
 * @property {function(string): boolean} isUrlInText - True when the text contains a URL.
 * @property {function(string): (string|null)} extractLink - Extracts the first URL from a text.
 * @property {function(unknown): string} jsonFormat - Pretty prints JSON, safe against circular references.
 * @property {function(object, object=): object} extend - Injects project-local utilities into the namespace.
 */

export {}