/**
 * Binary node builders used by the relay pipeline.
 *
 * The NODES map mirrors the engine's node shapes so helpers can attach
 * the exact nodes the protocol expects (polls, events, interactive
 * native flows, and bot/AI labels).
 *
 * @module core/node
 */

import { createError, ErrorCodes } from '../constant/index.js'

/**
 * Shared protocol node shapes.
 *
 * @type {Object<string, object[]|object>}
 */
export const NODES = {
    mixed: [
        {
            tag: 'biz',
            attrs: {},
            content: [
                {
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                }
            ]
        }
    ],
    payment_key_info: [
        {
            tag: 'biz',
            attrs: {},
            content: [
                {
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { name: 'payment_key_info' } }]
                }
            ]
        }
    ],
    catalog_message: [
        {
            tag: 'biz',
            attrs: { native_flow_name: 'catalog_message' }
        }
    ],
    order_details: [
        {
            tag: 'biz',
            attrs: { native_flow_name: 'order_details' }
        }
    ],
    poll_creation: [
        {
            tag: 'meta',
            attrs: { polltype: 'creation' }
        }
    ],
    quiz_creation: [
        {
            tag: 'meta',
            attrs: { polltype: 'quiz_creation' }
        }
    ],
    event_creation: [
        {
            tag: 'meta',
            attrs: { event_type: 'creation' }
        }
    ],
    bot_ai: [
        { tag: 'bot', attrs: { biz_bot: '1' } },
        { tag: 'biz', attrs: {} }
    ]
}

/**
 * Normalizes additional nodes into a flat array.
 *
 * Accepts a single node object, an array of nodes, a function
 * `(opts) => nodes`, or null.
 *
 * @param {object|object[]|function|null} nodes - Raw additional nodes.
 * @param {object} [opts] - Context passed to function nodes.
 * @returns {object[]} Normalized node array.
 */
export function normalizeAdditionalNodes(nodes, opts = {}) {
    if (nodes == null) {
        return []
    }
    let resolved = nodes
    if (typeof nodes === 'function') {
        resolved = nodes(opts)
    }
    if (Array.isArray(resolved)) {
        return resolved
    }
    if (resolved && typeof resolved === 'object') {
        return [resolved]
    }
    return []
}

/**
 * Merges additional node arrays into one.
 *
 * @param {...(object|object[]|function|null)} nodeLists - Node lists to merge.
 * @returns {object[]} Merged node array.
 */
export function mergeNodes(...nodeLists) {
    return nodeLists.flatMap((nodes) => normalizeAdditionalNodes(nodes))
}

/**
 * Validates that additional nodes are well-formed binary nodes.
 *
 * @param {object|object[]|function|null} nodes - Raw additional nodes.
 * @param {object} [opts] - Context passed to function nodes.
 * @returns {object[]} Validated node array.
 * @throws {NexrayError} INVALID_OPTIONS when a node is malformed.
 */
export function assertAdditionalNodes(nodes, opts = {}) {
    const normalized = normalizeAdditionalNodes(nodes, opts)
    for (const node of normalized) {
        if (!node || typeof node !== 'object' || typeof node.tag !== 'string' || node.tag.length === 0) {
            throw createError(
                'Additional nodes must be binary nodes with a valid tag.',
                ErrorCodes.INVALID_OPTIONS
            )
        }
    }
    return normalized
}

export default NODES