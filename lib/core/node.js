import { randomBytes } from 'crypto';
/**
 * Additional binary-node helpers.
 * Catalog of nodes used by relayMessage `additionalNodes`.
 * Shapes from reference analysis (eU5Esi7s) + messages-send.md meta patterns.
 */


/**
 * Normalize a node to { tag, attrs, content }.
 * @param {object} node
 * @returns {{ tag: string, attrs: object, content?: * }}
 */
export function normalizeNode(node) {
    if (!(node && typeof node === 'object' && !Array.isArray(node)) || typeof node.tag !== 'string') {
        throw new TypeError('Node must be an object with a string tag');
    }
    return {
        tag: node.tag,
        attrs: (node.attrs && typeof node.attrs === 'object') ? { ...node.attrs } : {},
        content: node.content
    };
}

/**
 * @param {object[]} nodes
 * @returns {object[]}
 */
export function normalizeNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    return nodes.map(normalizeNode);
}

/**
 * Generic meta node.
 * @param {object} attrs
 * @param {*} [content]
 */
export function metaNode(attrs = {}, content = undefined) {
    return normalizeNode({ tag: 'meta', attrs, content });
}

/**
 * content_type=add_on — pin / keep / reaction style meta (messages-send.md).
 */
export function addOnMetaNode() {
    return metaNode({ content_type: 'add_on' });
}

/**
 * Group status meta.
 */
export function groupStatusMetaNode() {
    return metaNode({ is_group_status: 'true' });
}

/**
 * Poll meta.
 * @param {'creation'|'vote'|'quiz_creation'} polltype
 * @param {object} [extra]
 */
export function pollMetaNode(polltype = 'creation', extra = {}) {
    const attrs = { polltype: polltype || 'creation' };
    // messages-send.md: contenttype only for newsletter polls
    if (extra.contenttype) attrs.contenttype = extra.contenttype;
    return { tag: 'meta', attrs, content: undefined };
}

/** @deprecated use pollMetaNode */
export function pollCreationNode(polltype = 'creation') {
    return pollMetaNode(polltype);
}

/**
 * Event creation meta.
 */
export function eventCreationNode() {
    return metaNode({ event_type: 'creation' });
}

/**
 * Status mention meta (1:1).
 */
export function statusMentionMetaNode() {
    return metaNode({ is_status_mention: 'true' });
}

/**
 * Group status mention meta.
 */
export function groupStatusMentionMetaNode() {
    return metaNode({ is_group_status_mention: 'true' });
}

/**
 * Bot AI label nodes (Reply AI pattern).
 * @returns {object[]}
 */
export function aiBotNodes() {
    return [
        normalizeNode({ tag: 'bot', attrs: { biz_bot: '1' } }),
        normalizeNode({ tag: 'biz', attrs: {} })
    ];
}

/**
 * Interactive native_flow biz node (manual name).
 */
export function interactiveBizNode(name, extra = {}) {
    if (name === 'catalog_message' || name === 'order_details') {
        return normalizeNode({
            tag: 'biz',
            attrs: { native_flow_name: name, ...(extra.attrs || {}) }
        });
    }
    const nativeAttrs = { name: name || 'mixed' };
    if (extra.v != null) nativeAttrs.v = String(extra.v);
    else if (name === 'mixed' || !name) nativeAttrs.v = '9';
    else nativeAttrs.v = '2';

    return normalizeNode({
        tag: 'biz',
        attrs: {},
        content: [
            {
                tag: 'interactive',
                attrs: { type: 'native_flow', v: '1' },
                content: [{ tag: 'native_flow', attrs: nativeAttrs }]
            }
        ]
    });
}

const FLOWS_MAP = {
    mpm: true,
    cta_catalog: true,
    send_location: true,
    call_permission_request: true,
    wa_payment_transaction_details: true,
    automated_greeting_message_view_catalog: true
};

/**
 * Auto biz node from message content (Baileys getBizBinaryNode).
 * Picks native_flow name from first button when needed.
 *
 * @param {object} message - inner message (interactiveMessage / buttonsMessage / listMessage)
 * @returns {object} biz binary node
 */
export function getBizBinaryNode(message = {}) {
    const flowMsg = message.interactiveMessage?.nativeFlowMessage;
    const firstButtonName = flowMsg?.buttons?.[0]?.name;

    const qualityContent = {
        tag: 'quality_control',
        attrs: {
            decision_id: randomBytes(20).toString('hex'),
            source_type: 'third_party'
        },
        content: [{ tag: 'decision_source', attrs: { value: 'df' } }]
    };

    const bizAttributes = {
        actual_actors: '2',
        host_storage: '2',
        privacy_mode_ts: String((Date.now() / 1000) | 0)
    };

    if (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info') {
        bizAttributes.native_flow_name =
            firstButtonName === 'review_and_pay' ? 'order_details' : firstButtonName;
        return normalizeNode({
            tag: 'biz',
            attrs: bizAttributes,
            content: [qualityContent]
        });
    }

    if (firstButtonName && FLOWS_MAP[firstButtonName]) {
        return normalizeNode({
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                {
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [
                        {
                            tag: 'native_flow',
                            attrs: { v: '2', name: firstButtonName }
                        }
                    ]
                },
                qualityContent
            ]
        });
    }

    if (flowMsg || message.buttonsMessage || message.templateMessage || message.interactiveMessage?.carouselMessage) {
        return normalizeNode({
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                {
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                },
                qualityContent
            ]
        });
    }

    if (message.listMessage) {
        return normalizeNode({
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                { tag: 'list', attrs: { v: '2', type: 'product_list' } },
                qualityContent
            ]
        });
    }

    // carousel / generic interactive
    if (message.interactiveMessage) {
        return normalizeNode({
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                {
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [
                        {
                            tag: 'native_flow',
                            attrs: { v: '9', name: 'mixed' }
                        }
                    ]
                },
                qualityContent
            ]
        });
    }

    return normalizeNode({ tag: 'biz', attrs: bizAttributes, content: [qualityContent] });
}

/**
 * Empty biz node (often paired with bot).
 */
export function bizNode(attrs = {}, content = undefined) {
    return normalizeNode({ tag: 'biz', attrs, content });
}

/**
 * Bot node only.
 * @param {object} [attrs]
 */
export function botNode(attrs = { biz_bot: '1' }) {
    return normalizeNode({ tag: 'bot', attrs });
}

/**
 * Member label meta (group member tag).
 */
export function memberTagMetaNode() {
    return metaNode({
        tag_reason: 'user_update',
        appdata: 'member_tag'
    });
}

/**
 * Peer message meta (app state / peer category).
 */
export function peerMetaNode() {
    return metaNode({ appdata: 'default' });
}

/**
 * Mentioned users wrapper used by status mentions (messages-send.md).
 * @param {string[]} jids
 */
export function mentionedUsersNode(jids = []) {
    return metaNode(
        {},
        [
            {
                tag: 'mentioned_users',
                attrs: {},
                content: jids.map((id) => ({
                    tag: 'to',
                    attrs: { jid: id },
                    content: undefined
                }))
            }
        ]
    );
}

/**
 * Build additionalNodes from high-level message flags.
 *
 * @param {object} opts
 * @returns {object[]}
 */
export function buildAdditionalNodes(opts = {}) {
    const nodes = [];

    if (Array.isArray(opts.additionalNodes)) {
        nodes.push(...normalizeNodes(opts.additionalNodes));
    }

    if (opts.ai === true) {
        nodes.push(...aiBotNodes());
    }

    if (opts.polltype) {
        nodes.push(pollMetaNode(opts.polltype, { contenttype: opts.contenttype }));
    }

    if (opts.event === true || opts.event_type === 'creation') {
        nodes.push(eventCreationNode());
    }

    if (opts.addOn === true || opts.content_type === 'add_on') {
        nodes.push(addOnMetaNode());
    }

    if (opts.isGroupStatus === true || opts.groupStatus === true) {
        nodes.push(groupStatusMetaNode());
    }

    // Biz node: interactive always; ALL types when addBizAttributes / forceBiz (metaLabel)
    const hasBiz = nodes.some((n) => n.tag === 'biz');
    if (!hasBiz) {
        const msg = opts.message;
        const forceBiz = opts.addBizAttributes === true || opts.forceBiz === true || opts.metaLabel === true;
        const needsBiz =
            forceBiz ||
            (msg &&
                (msg.buttonsMessage ||
                    msg.listMessage ||
                    msg.templateMessage ||
                    msg.productMessage ||
                    msg.interactiveMessage));
        if (needsBiz && msg) {
            nodes.push(getBizBinaryNode(msg));
        } else if (forceBiz) {
            nodes.push(getBizBinaryNode(msg || {}));
        } else if (opts.interactive) {
            if (typeof opts.interactive === 'object' && opts.interactive.interactiveMessage) {
                nodes.push(getBizBinaryNode(opts.interactive));
            } else {
                const name = typeof opts.interactive === 'string' ? opts.interactive : opts.interactive?.name;
                if (name) nodes.push(interactiveBizNode(name, opts.interactive));
            }
        }
    }

    return nodes;
}

export const Nodes = {
    metaNode,
    addOnMetaNode,
    groupStatusMetaNode,
    pollMetaNode,
    pollCreationNode,
    eventCreationNode,
    statusMentionMetaNode,
    groupStatusMentionMetaNode,
    aiBotNodes,
    interactiveBizNode,
    getBizBinaryNode,
    bizNode,
    botNode,
    memberTagMetaNode,
    peerMetaNode,
    mentionedUsersNode,
    buildAdditionalNodes,
    normalizeNode,
    normalizeNodes
};
