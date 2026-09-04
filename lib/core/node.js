/**
 * Additional binary-node helpers.
 * Catalog of nodes used by relayMessage `additionalNodes`.
 * Shapes from reference analysis (eU5Esi7s) + messages-send.md meta patterns.
 */

import { isPlainObject } from '../utils/function.js';

/**
 * Normalize a node to { tag, attrs, content }.
 * @param {object} node
 * @returns {{ tag: string, attrs: object, content?: * }}
 */
export function normalizeNode(node) {
    if (!isPlainObject(node) || typeof node.tag !== 'string') {
        throw new TypeError('Node must be an object with a string tag');
    }
    return {
        tag: node.tag,
        attrs: isPlainObject(node.attrs) ? { ...node.attrs } : {},
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
    const attrs = { polltype };
    if (extra.contenttype) attrs.contenttype = extra.contenttype;
    return metaNode(attrs);
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
 * Interactive native_flow biz node.
 * @param {string} name - mixed | payment_key_info | catalog_message | order_details | ...
 * @param {object} [extra]
 * @returns {object}
 */
export function interactiveBizNode(name, extra = {}) {
    if (name === 'catalog_message' || name === 'order_details') {
        return normalizeNode({
            tag: 'biz',
            attrs: { native_flow_name: name, ...(extra.attrs || {}) }
        });
    }
    const nativeAttrs = { name };
    if (extra.v != null) nativeAttrs.v = String(extra.v);
    else if (name === 'mixed') nativeAttrs.v = '9';

    return normalizeNode({
        tag: 'biz',
        attrs: {},
        content: [
            {
                tag: 'interactive',
                attrs: { type: 'native_flow', v: '1' },
                content: [
                    {
                        tag: 'native_flow',
                        attrs: nativeAttrs
                    }
                ]
            }
        ]
    });
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
 * Central place so helpers stay thin.
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

    if (opts.interactive) {
        const name = typeof opts.interactive === 'string' ? opts.interactive : opts.interactive.name;
        if (name) nodes.push(interactiveBizNode(name, opts.interactive));
    }

    return nodes;
}

/**
 * Named catalog for documentation / Utils export.
 */
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
    bizNode,
    botNode,
    memberTagMetaNode,
    peerMetaNode,
    mentionedUsersNode,
    buildAdditionalNodes,
    normalizeNode,
    normalizeNodes
};
