"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var configure = require("./configure");
var errors = require("./errors");

exports.defaults = configure.defaults;
exports.getGlobalConfig = configure.getGlobalConfig;
exports.setGlobalConfig = configure.setGlobalConfig;
exports.noopLogger = configure.noopLogger;
exports.resolveLogger = configure.resolveLogger;
exports.NexrayError = errors.NexrayError;
exports.ErrorMessages = errors.ErrorMessages;
