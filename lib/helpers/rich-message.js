'use strict';

const crypto = require('crypto');
const { buildQuoted } = require('./context');
const { makeMsgId } = require('./generic');
const { getEngine } = require('../core/engine');
const { NODES } = require('./nodes');
const { NexrayError, ErrorCodes } = require('../constant/errors');

const RICH_TYPES = Object.freeze({
    GRID_IMAGE: 1,
    TEXT: 2,
    INLINE_IMAGE: 3,
    TABLE: 4,
    CODE: 5,
    DYNAMIC: 6,
});

const CODE_HIGHLIGHT = Object.freeze({
    DEFAULT: 0,
    KEYWORD: 1,
    METHOD: 2,
    STRING: 3,
    NUMBER: 4,
    COMMENT: 5,
});

function randomBytes(length) {
    const value = new Uint8Array(length);
    crypto.randomFillSync(value);
    return value;
}

function createBotMetadata() {
    return {
        verificationMetadata: {
            proofs: [{
                certificateChain: [
                    randomCertificate(685),
                    randomCertificate(892),
                ],
                version: 1,
                useCase: 1,
                signature: randomBytes(64),
            }],
        },
    };
}

function randomCertificate(length) {
    const value = randomBytes(length);
    value[0] = 0x30;
    value[1] = 0x82;
    return value;
}

function normalizeImageUrl(input) {
    if (typeof input === 'string') {
        if (/^https?:\/\//i.test(input)) {
            return {
                imagePreviewURL: input,
                imageHighResURL: input,
                sourceURL: input,
            };
        }
        return null;
    }

    if (!input || typeof input !== 'object') {
        return null;
    }

    const preview = input.imagePreviewURL || input.previewUrl || input.preview;
    const highRes = input.imageHighResURL || input.highResUrl || input.url || input.imageUrl;
    const source = input.sourceURL || input.sourceUrl || highRes || preview;

    if (!preview && !highRes && !source) {
        return null;
    }

    return {
        imagePreviewURL: preview || highRes || source,
        imageHighResURL: highRes || preview || source,
        sourceURL: source || highRes || preview,
    };
}

function normalizeCode(code, language) {
    return {
        messageType: RICH_TYPES.CODE,
        codeMetadata: {
            codeLanguage: language || 'javascript',
            codeBlocks: [{
                highlightType: CODE_HIGHLIGHT.DEFAULT,
                codeContent: String(code || ''),
            }],
        },
    };
}

function normalizeTable(table, title, noHeading) {
    const source = Array.isArray(table) ? table : table?.rows || [];
    const headers = !Array.isArray(table) ? table?.headers : null;
    const rows = headers ? [headers, ...source] : source;

    return {
        messageType: RICH_TYPES.TABLE,
        tableMetadata: {
            title: title || (!Array.isArray(table) && table?.title) || '',
            rows: rows.map((items, index) => ({
                isHeading: headers ? index === 0 : !noHeading && index === 0,
                items: Array.isArray(items) ? items.map(String) : [String(items)],
            })),
        },
    };
}

function normalizeImage(image, options = {}) {
    const imageURL = normalizeImageUrl(image);
    if (!imageURL) {
        return null;
    }

    return {
        messageType: RICH_TYPES.INLINE_IMAGE,
        imageMetadata: {
            imageURL,
            imageText: String(options.imageText || options.alt || ''),
            tapLinkUrl: options.tapLinkUrl || options.tapLinkURL || '',
        },
    };
}

function normalizeSubmessage(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    if (typeof item.text === 'string') {
        return {
            messageType: RICH_TYPES.TEXT,
            messageText: item.text,
            inlineEntities: item.inlineEntities || [],
        };
    }

    if (item.code != null) {
        const code = typeof item.code === 'string' ? item.code : item.code.code;
        const language = item.language || item.code.language;
        return normalizeCode(code, language);
    }

    if (item.table != null) {
        return normalizeTable(item.table, item.title, item.noHeading);
    }

    if (item.image != null) {
        return normalizeImage(item.image, item);
    }

    if (item.dynamic != null) {
        const dynamic = typeof item.dynamic === 'object' ? item.dynamic : { url: item.dynamic };
        if (!dynamic.url) return null;

        return {
            messageType: RICH_TYPES.DYNAMIC,
            dynamicMetadata: {
                type: dynamic.type ?? 1,
                version: dynamic.version ?? 1,
                url: dynamic.url,
                loopCount: dynamic.loopCount ?? 0,
            },
        };
    }

    return null;
}

function normalizeContent(content) {
    if (Array.isArray(content)) {
        return content.map(normalizeSubmessage).filter(Boolean);
    }

    if (!content || typeof content !== 'object') {
        return [];
    }

    const parts = [];

    if (content.headerText) {
        parts.push({ text: content.headerText });
    }

    if (content.contentText || content.text) {
        parts.push({ text: content.contentText || content.text });
    }

    if (content.image || content.media) {
        parts.push({
            image: content.image || content.media,
            imageText: content.imageText,
            tapLinkUrl: content.tapLinkUrl,
        });
    }

    if (content.code != null) {
        parts.push({
            code: content.code,
            language: content.language,
        });
    }

    if (content.table != null) {
        parts.push({
            table: content.table,
            title: content.title,
            noHeading: content.noHeading,
        });
    }

    if (content.dynamic != null) {
        parts.push({ dynamic: content.dynamic });
    }

    if (content.footerText) {
        parts.push({ text: content.footerText });
    }

    return parts.map(normalizeSubmessage).filter(Boolean);
}

function toUnified(submessages, options = {}) {
    const sections = submessages.map((submessage) => {
        switch (submessage.messageType) {
            case RICH_TYPES.CODE: {
                const metadata = submessage.codeMetadata || {};
                return {
                    view_model: {
                        primitive: {
                            language: metadata.codeLanguage || 'javascript',
                            code_blocks: (metadata.codeBlocks || []).map((block) => ({
                                content: block.codeContent,
                                type: Object.keys(CODE_HIGHLIGHT)
                                    .find((key) => CODE_HIGHLIGHT[key] === block.highlightType) || 'DEFAULT',
                            })),
                            __typename: 'GenAICodeUXPrimitive',
                        },
                        __typename: 'GenAISingleLayoutViewModel',
                    },
                };
            }

            case RICH_TYPES.TABLE: {
                const metadata = submessage.tableMetadata || {};
                return {
                    view_model: {
                        primitive: {
                            title: metadata.title || '',
                            rows: (metadata.rows || []).map((row) => ({
                                is_header: Boolean(row.isHeading),
                                cells: row.items || [],
                                markdown_cells: (row.items || []).map((text) => ({ text })),
                            })),
                            __typename: 'GenATableUXPrimitive',
                        },
                        __typename: 'GenAISingleLayoutViewModel',
                    },
                };
            }

            case RICH_TYPES.INLINE_IMAGE: {
                const metadata = submessage.imageMetadata || {};
                return {
                    view_model: {
                        primitive: {
                            image_url: metadata.imageURL?.imageHighResURL || metadata.imageURL?.imagePreviewURL || '',
                            image_text: metadata.imageText || '',
                            tap_link_url: metadata.tapLinkUrl || '',
                            __typename: 'GenAIInlineImageUXPrimitive',
                        },
                        __typename: 'GenAISingleLayoutViewModel',
                    },
                };
            }

            default:
                return {
                    view_model: {
                        primitive: {
                            text: submessage.messageText || '',
                            inline_entities: submessage.inlineEntities || [],
                            __typename: 'GenAIMarkdownTextUXPrimitive',
                        },
                        __typename: 'GenAISingleLayoutViewModel',
                    },
                };
        }
    });

    if (options.footer) {
        sections.push({
            view_model: {
                primitive: {
                    text: String(options.footer),
                    __typename: 'GenAIMetadataTextPrimitive',
                },
                __typename: 'GenAISingleLayoutViewModel',
            },
        });
    }

    return {
        response_id: crypto.randomUUID
            ? crypto.randomUUID()
            : crypto.randomBytes(16).toString('hex'),
        sections,
    };
}

function buildRichPayload(content, options = {}) {
    const submessages = normalizeContent(content);
    const unified = toUnified(submessages, options);

    const richResponseMessage = {
        messageType: 1,
        submessages,
        unifiedResponse: {
            data: Buffer.from(JSON.stringify(unified), 'utf8'),
        },
        contextInfo: {
            isForwarded: true,
            forwardingScore: 1,
            forwardedAiBotMessageInfo: {
                botJid: options.botJid || '867051314767696@bot',
            },
            forwardOrigin: 4,
        },
    };

    const payload = {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: createBotMetadata(),
        },
        botForwardedMessage: {
            message: {
                richResponseMessage,
            },
        },
    };

    const botMetadata = payload.messageContextInfo.botMetadata;

    if (options.disclaimerText) {
        botMetadata.messageDisclaimerText = options.disclaimerText;
    }

    if (Array.isArray(options.sources)) {
        botMetadata.richResponseSourcesMetadata = {
            sources: options.sources,
        };
    }

    botMetadata.botResponseId = unified.response_id;

    return payload;
}

function isMessage(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value.key || value.message)
    );
}

function isOptions(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !isMessage(value)
    );
}

function createQuotedContext(quoted) {
    if (!quoted) return {};

    const built = buildQuoted(quoted);
    if (!built) return {};

    return {
        stanzaId: built.key?.id,
        participant: built.participant || built.key?.participant || built.key?.remoteJid,
        quotedMessage: built.message,
    };
}

function attachAIRich(sock) {
    async function sendMetaMsg(jid, content, quoted, opts) {
        if (!jid) {
            throw new NexrayError(
                'sendMetaMsg requires a destination JID.',
                ErrorCodes.INVALID_JID
            );
        }

        let options = opts || {};

        if (isOptions(quoted)) {
            options = { ...quoted, ...options };
            quoted = options.quoted || null;
        }

        const quoteContext = createQuotedContext(quoted || options.quoted);
        const payload = buildRichPayload(content, options);

        const richResponse = payload.botForwardedMessage.message.richResponseMessage;
        if (Object.keys(quoteContext).length) {
            richResponse.contextInfo = {
                ...richResponse.contextInfo,
                ...quoteContext,
            };
        }

        const messageId = options.messageId || makeMsgId(sock);

        await sock.relayMessage(jid, payload, {
            messageId,
            additionalNodes: options.additionalNodes || NODES.bot_ai,
        });

        return {
            key: {
                remoteJid: jid,
                fromMe: true,
                id: messageId,
            },
            message: payload,
        };
    }

    sock.sendMetaMsg = sendMetaMsg;
    sock.sendAIRich = sendMetaMsg;
    return sock;
}

module.exports = {
    buildRichPayload,
    attachAIRich,
    RICH_TYPES,
    CODE_HIGHLIGHT,
};
