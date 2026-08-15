'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMessageContent = exports.getContentType = exports.normalizeBody = void 0;

/**
 * Get content type key from WAMessage.message
 * @param {object} message
 * @returns {string|undefined}
 */
function getContentType(message) {
    if (!message || typeof message !== 'object')
        return undefined;
    var keys = Object.keys(message);
    var ignore = new Set(['senderKeyDistributionMessage', 'messageContextInfo']);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!ignore.has(k) && k !== 'senderKeyDistributionMessage') {
            return k;
        }
    }
    return keys[0];
}
exports.getContentType = getContentType;

/**
 * Extract inner content object from message
 * @param {object} message
 * @returns {object|null}
 */
function extractMessageContent(message) {
    if (!message)
        return null;
    var type = getContentType(message);
    if (!type)
        return null;
    return message[type] || null;
}
exports.extractMessageContent = extractMessageContent;

/**
 * Normalize text body from various message types
 * @param {object} msg - the content object (e.g. extendedTextMessage / conversation / imageMessage)
 * @param {string} [type]
 * @returns {string}
 */
function normalizeBody(msg, type) {
    if (!msg)
        return '';
    if (typeof msg === 'string')
        return msg;
    if (msg.conversation)
        return msg.conversation;
    if (msg.extendedTextMessage && msg.extendedTextMessage.text)
        return msg.extendedTextMessage.text;
    if (msg.text)
        return msg.text;
    if (msg.caption)
        return msg.caption;
    if (msg.selectedDisplayText)
        return msg.selectedDisplayText;
    if (msg.selectedId)
        return msg.selectedId;
    if (msg.selectedRowId)
        return msg.selectedRowId;
    if (type === 'buttonsResponseMessage' && msg.selectedButtonId)
        return msg.selectedButtonId;
    if (type === 'listResponseMessage' && msg.singleSelectReply)
        return (msg.singleSelectReply.selectedRowId || '');
    if (type === 'templateButtonReplyMessage' && msg.selectedId)
        return msg.selectedId;
    if (type === 'interactiveResponseMessage') {
        try {
            var params = msg.nativeFlowResponseMessage && msg.nativeFlowResponseMessage.paramsJson;
            if (params) {
                var parsed = JSON.parse(params);
                return parsed.id || parsed.selectedId || params;
            }
        }
        catch (_a) { }
    }
    return '';
}
exports.normalizeBody = normalizeBody;
