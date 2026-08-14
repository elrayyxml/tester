'use strict'

function bindNewsletterListeners(sock, options = {}) {
  if (!sock?.ev?.on) return sock
  if (typeof options.onNewsletterReaction === 'function') sock.ev.on('newsletter.reaction', value => options.onNewsletterReaction(value))
  if (typeof options.onNewsletterView === 'function') sock.ev.on('newsletter.view', value => options.onNewsletterView(value))
  if (typeof options.onNewsletterParticipantsUpdate === 'function') sock.ev.on('newsletter-participants.update', value => options.onNewsletterParticipantsUpdate(value))
  return sock
}

async function newsletterFollow(sock, jid) {
  if (typeof sock?.newsletterFollow !== 'function') throw new Error('newsletterFollow tidak tersedia pada socket Baileys.')
  return sock.newsletterFollow(jid)
}

async function newsletterUnfollow(sock, jid) {
  if (typeof sock?.newsletterUnfollow !== 'function') throw new Error('newsletterUnfollow tidak tersedia pada socket Baileys.')
  return sock.newsletterUnfollow(jid)
}

module.exports = { bindNewsletterListeners, newsletterFollow, newsletterUnfollow }
