'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.bizNodes = exports.NODES = void 0;

/** additionalNodes from WA native payloads (pastebin eU5Esi7s) */
exports.NODES = {
    mixed: [{
            tag: 'biz', attrs: {},
            content: [{
                    tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                }]
        }],
    payment_key_info: [{
            tag: 'biz', attrs: {},
            content: [{
                    tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { name: 'payment_key_info' } }]
                }]
        }],
    catalog_message: [{
            tag: 'biz', attrs: { native_flow_name: 'catalog_message' }
        }],
    order_details: [{
            tag: 'biz', attrs: { native_flow_name: 'order_details' }
        }],
    poll_creation: [{
            tag: 'meta', attrs: { polltype: 'creation' }
        }],
    quiz_creation: [{
            tag: 'meta', attrs: { polltype: 'quiz_creation' }
        }],
    event_creation: [{
            tag: 'meta', attrs: { event_type: 'creation' }
        }],
    bot_ai: [
        { tag: 'bot', attrs: { biz_bot: '1' } },
        { tag: 'biz', attrs: {} }
    ]
};

function bizNodes(name) {
    if (name && exports.NODES[name]) return exports.NODES[name];
    return exports.NODES.mixed;
}
exports.bizNodes = bizNodes;
