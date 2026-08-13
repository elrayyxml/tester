"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var configure = require("./configure");
var errors = require("./errors");

exports.getGlobalConfig = configure.getGlobalConfig;
exports.setGlobalConfig = configure.setGlobalConfig;
exports.defaults = configure.defaults;
exports.NexrayError = errors.NexrayError;
exports.ErrorMessages = errors.ErrorMessages;
exports.default = exports;
