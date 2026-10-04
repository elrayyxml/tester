/** @module utils/logger */

import chalk from 'chalk';

const LEVEL_COLOR = { error: 'red', warn: 'yellow', info: 'blue', debug: 'magenta' };
const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

/**
 * Logger berbasis chalk dengan sinkronisasi timestamp; `child` menumpuk scope.
 */
export class Logger {
  /**
   * @param {string} [scope]
   * @param {'silent'|'error'|'warn'|'info'|'debug'} [level]
   */
  constructor(scope = 'zapo', level = 'info') {
    this.scope = scope;
    this.level = level;
  }

  /** @param {string} name */
  child(name) {
    return new Logger(`${this.scope}:${name}`, this.level);
  }

  /**
   * @private
   * @param {'error'|'warn'|'info'|'debug'} level
   * @param {string|object} msg
   */
  #write(level, msg) {
    if (LEVELS.indexOf(level) > LEVELS.indexOf(this.level)) return;
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(chalk[LEVEL_COLOR[level]](`[${stamp}] ${this.scope}`), line);
  }

  /** @param {string|object} msg */
  error(msg) { this.#write('error', msg); }

  /** @param {string|object} msg */
  warn(msg) { this.#write('warn', msg); }

  /** @param {string|object} msg */
  info(msg) { this.#write('info', msg); }

  /** @param {string|object} msg */
  debug(msg) { this.#write('debug', msg); }
}

/** @param {string} tag @param {string|object} msg */
export const logWithTime = (tag, msg) => new Logger(tag).info(msg);

/** @param {string} tag @param {string|object} msg */
export const success = (tag, msg) => new Logger(tag).info(msg);

/** @param {string} tag @param {string|object} msg */
export const danger = (tag, msg) => new Logger(tag).error(msg);
