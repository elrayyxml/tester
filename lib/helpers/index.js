'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachAIRich = exports.buildRichPayload = exports.attachSendHelpers = exports.buildMediaAnnotations = exports.DEFAULT_POLYGON_VERTICES = exports.buildQuoted = exports.buildContextInfo = exports.applyNewsletterAnnotation = void 0;

var context_1 = require("./context");
Object.defineProperty(exports, "applyNewsletterAnnotation", { enumerable: true, get: function () { return context_1.applyNewsletterAnnotation; } });
Object.defineProperty(exports, "buildContextInfo", { enumerable: true, get: function () { return context_1.buildContextInfo; } });
Object.defineProperty(exports, "buildQuoted", { enumerable: true, get: function () { return context_1.buildQuoted; } });
Object.defineProperty(exports, "buildMediaAnnotations", { enumerable: true, get: function () { return context_1.buildMediaAnnotations; } });
Object.defineProperty(exports, "DEFAULT_POLYGON_VERTICES", { enumerable: true, get: function () { return context_1.DEFAULT_POLYGON_VERTICES; } });

var send_1 = require("./send");
Object.defineProperty(exports, "attachSendHelpers", { enumerable: true, get: function () { return send_1.attachSendHelpers; } });

var airich_1 = require("./airich");
Object.defineProperty(exports, "buildRichPayload", { enumerable: true, get: function () { return airich_1.buildRichPayload; } });
Object.defineProperty(exports, "attachAIRich", { enumerable: true, get: function () { return airich_1.attachAIRich; } });
