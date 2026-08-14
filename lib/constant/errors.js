'use strict'

class ElrayyxmlError extends Error {
  constructor(message, code = 'ERR_WB', statusCode) {
    super(message)
    this.name = 'ElrayyxmlError'
    this.code = code
    if (statusCode !== undefined) this.statusCode = statusCode
  }
}

const ERROR_MESSAGES = Object.freeze({
  INVALID_SOCKET: 'Socket Baileys tidak valid atau relayMessage tidak tersedia.',
  INVALID_JID: 'JID tujuan tidak valid.',
  INVALID_MEDIA: 'Media harus berupa Buffer, URL, path lokal, atau readable stream.',
  NEWSLETTER_ONLY: 'Operasi ini hanya mendukung JID newsletter.',
  PRIVATE_ONLY: 'Legacy list hanya boleh dikirim ke private chat.',
  QUIZ_ANSWER_REQUIRED: 'Quiz memerlukan correctAnswer yang valid.',
  BAILEYS_API: 'API Baileys yang diperlukan tidak tersedia pada socket atau package yang digunakan.'
})

function wbError(key, detail) {
  const base = ERROR_MESSAGES[key] || key
  return new ElrayyxmlError(detail ? `${base} ${detail}` : base, key)
}

module.exports = { ElrayyxmlError, NexrayError: ElrayyxmlError, ERROR_MESSAGES, wbError }
