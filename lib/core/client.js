'use strict'

const { Extend } = require('./extend')
const { bindMessageListener } = require('../listener/message')

function Client(sock, options = {}) {
  const task = Extend(sock, options)
  if (task?.catch) task.catch(error => options.logger?.error?.(error))
  bindMessageListener(sock, options)
  return sock
}

module.exports = { Client }
