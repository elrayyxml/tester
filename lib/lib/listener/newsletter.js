'use strict'

/**
 * Bind newsletter-related events and expose optional callbacks.
 *
 * @param {import('baileys').WASocket} sock
 * @param {object} [options]
 */
function bindNewsletterListener(sock, options = {}) {
  if (!sock?.ev) return

  if (typeof options.onNewsletterReaction === 'function') {
    sock.ev.on('newsletter.reaction', (data) => {
      try {
        options.onNewsletterReaction(data, sock)
      } catch (err) {
        options.logger?.error?.({ err }, 'onNewsletterReaction error')
      }
    })
  }

  if (typeof options.onNewsletterView === 'function') {
    sock.ev.on('newsletter.view', (data) => {
      try {
        options.onNewsletterView(data, sock)
      } catch (err) {
        options.logger?.error?.({ err }, 'onNewsletterView error')
      }
    })
  }

  // participants update (if the underlying baileys emits it)
  if (typeof options.onNewsletterParticipantsUpdate === 'function') {
    sock.ev.on('newsletter-participants.update', (data) => {
      try {
        options.onNewsletterParticipantsUpdate(data, sock)
      } catch (err) {
        options.logger?.error?.({ err }, 'onNewsletterParticipantsUpdate error')
      }
    })
  }
}

module.exports = {
  bindNewsletterListener
}
