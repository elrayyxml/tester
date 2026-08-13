'use strict'

const configure = require('./configure')
const errors = require('./errors')

module.exports = {
  ...configure,
  ...errors
}
