/**
 * Type contracts for the engine interface.
 *
 * These are documentation-only typedefs (JSDoc). The library consumes the
 * engine through this interface and never reaches into a concrete package
 * implementation directly.
 *
 * @module types/baileys
 */

/**
 * The engine contract every injected engine must satisfy.
 *
 * All fields are accessed by the core layer through the engine adapter.
 * The engine is provided by the application via `Client(sock, { engines })`.
 *
 * @typedef {object} Engine
 * @property {function} generateWAMessage - Generate a WAMessage from content.
 * @property {function} generateWAMessageFromContent - Generate a WAMessage from a pre-built protobuf payload.
 * @property {function} prepareWAMessageMedia - Prepare and upload media into a message payload.
 * @property {function} getDevice - Predict the device type from a message ID.
 * @property {function} getStream - Resolve media input into a readable stream.
 * @property {function} toBuffer - Convert a stream/input into a Buffer.
 * @property {function} getAudioWaveform - Extract waveform data from an audio buffer.
 * @property {object} proto - The protobuf namespace used for message encoding.
 * @property {function} generateThumbnail - Generate a thumbnail from media.
 * @property {function} [generateMessageID] - Legacy message ID generator.
 * @property {function} [generateMessageIDV2] - Message ID generator compatible with current WhatsApp clients.
 */

/**
 * The socket passed into `Client()`. This is normally a Baileys socket
 * augmented with the relay pipeline and message helpers.
 *
 * @typedef {object} Socket
 * @property {function} relayMessage - Relay a protobuf message to a JID.
 * @property {function} sendMessage - Original engine sendMessage (kept intact).
 * @property {object} user - Authenticated user info (`.id` is the own JID).
 * @property {function} [waUploadToServer] - Upload function used by media preparation.
 * @property {function} [upload] - Alias upload function.
 * @property {function} [groupMetadata] - Fetch group metadata (used for mention-all).
 * @property {function} [profilePictureUrl] - Fetch profile pictures.
 * @property {function} [createCallLink] - Create call links for events.
 * @property {object} logger - Logger instance.
 * @property {object} __nexray - Internal engine context injected by the Client.
 */

/**
 * A WhatsApp message key.
 *
 * @typedef {object} MessageKey
 * @property {string} id - Message ID.
 * @property {string} remoteJid - Chat JID the message belongs to.
 * @property {string} [participant] - Sender JID for group messages.
 * @property {boolean} [fromMe] - Whether the message was sent by the current user.
 * @property {string} [server_id] - Server id used by newsletters.
 */

/**
 * A normalized incoming message produced by the serializer.
 *
 * @typedef {object} SerializedMessage
 * @property {MessageKey} key - Message key.
 * @property {object} message - Raw protobuf message payload.
 * @property {string} type - Content type (e.g. `extendedTextMessage`, `imageMessage`).
 * @property {string} jid - Remote JID.
 * @property {string} sender - Sender JID.
 * @property {string} [from] - Participant JID for group messages.
 * @property {boolean} isGroup - Whether the message belongs to a group.
 * @property {boolean} isNewsletter - Whether the message belongs to a newsletter.
 * @property {boolean} isBot - Whether the message is considered bot generated.
 * @property {object|null} quoted - Quoted message payload if any.
 * @property {string} text - Extracted text content.
 */

/**
 * Media input accepted by every media helper.
 *
 * @typedef {Buffer|string|{ url: string }|{ stream: import('stream').Readable }} MediaInput
 */

/**
 * Newsletter annotation payload.
 *
 * @typedef {object} NewsletterAnnotation
 * @property {string} newsletterJid - Newsletter JID.
 * @property {string} newsletterName - Newsletter name.
 * @property {number} [contentType] - Proto content type, defaults to UPDATE.
 * @property {string} [accessibilityText] - Accessibility text.
 * @property {Array<{x: number, y: number}>} [polygonVertices] - Polygon vertices.
 */

/**
 * Poll options passed to poll helpers.
 *
 * @typedef {object} PollOptions
 * @property {string} name - Poll question.
 * @property {string[]} values - List of poll options.
 * @property {number} [selectableCount=0] - Number of selectable options.
 * @property {boolean} [toAnnouncementGroup=false] - Use poll v2 for announcement groups.
 * @property {Date|number} [endDate] - Poll end time.
 * @property {boolean} [hideVoter=false] - Hide participant names.
 * @property {boolean} [canAddOption=false] - Allow participants to add options.
 * @property {number} [pollType] - 1 for quiz (newsletter only).
 * @property {string} [correctAnswer] - Correct answer for quiz polls.
 * @property {Buffer} [messageSecret] - Message encryption secret.
 */

/**
 * Event options passed to the event helper.
 *
 * @typedef {object} EventOptions
 * @property {string} name - Event name.
 * @property {string} [description] - Event description.
 * @property {Date|string|number} startDate - Event start date (required).
 * @property {Date|string|number} [endDate] - Event end date.
 * @property {{ degreesLatitude: number, degreesLongitude: number, name?: string }} [location] - Event location.
 * @property {'audio'|'video'} [call] - Call type.
 * @property {boolean} [isCancelled=false] - Whether the event is cancelled.
 * @property {boolean} [extraGuestsAllowed] - Allow extra guests.
 * @property {boolean} [isScheduleCall=false] - Schedule call flag.
 * @property {Buffer} [messageSecret] - Message encryption secret.
 */

/**
 * Contact payload accepted by contact helpers.
 *
 * @typedef {object} ContactPayload
 * @property {string} name - Contact display name.
 * @property {string|number} number - Phone number (with or without country code).
 * @property {string} [org] - Organization (shorthand for organization).
 * @property {string} [organization] - Organization (classic field).
 * @property {string} [about] - Contact status/about text.
 * @property {boolean} [business] - Whether this is a business contact.
 * @property {string} [bizName] - Business name (X-WA-BIZ-NAME).
 * @property {string} [businessName] - Business name (alias for bizName).
 * @property {string} [bizDescription] - Business description (X-WA-BIZ-DESCRIPTION).
 * @property {string} [businessDescription] - Business description (alias for bizDescription).
 * @property {string} [title] - Contact title/job title.
 * @property {string} [region] - Business region.
 * @property {string} [location] - Business location (shorthand for address).
 * @property {string} [address] - Business address (classic field).
 * @property {string} [other] - Free-form note (shorthand for note).
 * @property {string} [note] - Free-form note (classic field).
 * @property {string} [email] - Business email.
 * @property {string} [website] - Business website (alias for url).
 * @property {string} [url] - Business website (classic field).
 * @property {string} [fullName] - Alternative name field.
 * @property {string} [phone] - Alternative number field.
 * @property {Array<string|{number: string, type?: string}>} [phones] - Multiple phone numbers.
 */

/**
 * Product payload accepted by product helpers.
 *
 * @typedef {object} ProductPayload
 * @property {MediaInput} [image] - Product image.
 * @property {string} title - Product title.
 * @property {string} productId - Product id.
 * @property {string} businessOwnerJid - Business owner JID (required).
 * @property {string} [caption] - Product caption.
 * @property {string} [footer] - Product footer.
 * @property {string} [currencyCode] - ISO currency code.
 * @property {number} [price] - Product price in the smallest currency unit.
 * @property {Array<object>} [interactiveButtons] - Native flow buttons.
 * @property {string} [url] - Product url.
 */

/**
 * Order payload accepted by the order helper.
 *
 * @typedef {object} OrderPayload
 * @property {string} [orderId] - Order id.
 * @property {MediaInput} [thumbnail] - Order thumbnail.
 * @property {number} [itemCount=1] - Number of items.
 * @property {string} [status] - Order status.
 * @property {string} [surface] - Order surface.
 * @property {string} [orderTitle] - Order title.
 * @property {string} [message] - Order message.
 * @property {string} [sellerJid] - Seller JID.
 * @property {string} [token] - Order token.
 * @property {number} [totalAmount1000] - Total amount in thousandths.
 * @property {string} [totalCurrencyCode] - Currency code.
 */

export {}