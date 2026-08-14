'use strict'

const defaults = {
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  TEMP_DIR: process.env.TEMP_DIR || '/tmp',
  REQUEST_TIMEOUT: Number(process.env.REQUEST_TIMEOUT || 15000)
}

function getGlobalConfig() {
  return { ...defaults }
}

function setGlobalConfig(partial = {}) {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) defaults[key] = value
  }
  return getGlobalConfig()
}

module.exports = { getGlobalConfig, setGlobalConfig }
