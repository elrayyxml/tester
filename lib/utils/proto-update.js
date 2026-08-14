"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var fs = require("fs");
var path = require("path");

/**
 * @nexray/lib — utils/proto-update.js
 *
 * Best-effort updater that refreshes Baileys' bundled WAProto files from a
 * public upstream source. Only runs when `updateProtoOnStartup: true` is
 * passed to Client()/Extend(). Failures are always non-fatal — logged, never
 * thrown to the caller — since this is a "nice to have" freshness check,
 * not a required step for the socket to function.
 *
 * @param {object} [logger]
 * @returns {Promise<boolean>} true if files were written
 */
async function updateProtoOnStartup(logger) {
  var baseUrl = "https://raw.githubusercontent.com/wppconnect-team/wa-proto/refs/heads/main";

  var baileysRoot;
  try {
    baileysRoot = path.dirname(require.resolve("baileys/package.json"));
  } catch (e1) {
    try {
      baileysRoot = path.dirname(require.resolve("@whiskeysockets/baileys/package.json"));
    } catch (e2) {
      if (logger && logger.warn) logger.warn("updateProtoOnStartup: baileys package not found, skip");
      return false;
    }
  }

  var outputPath = path.join(baileysRoot, "WAProto");

  async function fetchText(url) {
    var res = await fetch(url, { headers: { "user-agent": "nexray-lib-proto-updater" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    return res.text();
  }

  try {
    var results = await Promise.all([
      fetchText(baseUrl + "/dist/index.js"),
      fetchText(baseUrl + "/dist/index.d.ts"),
      fetchText(baseUrl + "/WAProto.proto")
    ]);
    var rawIndexJs = results[0];
    var rawIndexDts = results[1];
    var rawWaProto = results[2];

    function replaceProto(c) {
      return c.split("waproto").join("proto");
    }

    var indexJs = replaceProto(rawIndexJs)
      .replace(/var (\$protobuf) = require\((["']protobufjs\/minimal["'])\)/, "import $1 from $2")
      .replace(/(protobufjs\/minimal)/, "$1.js")
      .replace(/(Message\.HistorySyncType) = /, "$1 = Message.HistorySyncNotification.HistorySyncType = ")
      .replace(/(\$root\.proto = )/, "export const proto = $1")
      .replace(/module\.exports = (\$root)/, "export default $1");

    var indexDts = replaceProto(rawIndexDts);
    var waProto = replaceProto(rawWaProto);

    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, "index.js"), indexJs);
    fs.writeFileSync(path.join(outputPath, "index.d.ts"), indexDts);
    fs.writeFileSync(path.join(outputPath, "WAProto.proto"), waProto);

    if (logger && logger.info) logger.info("WAProto files updated successfully");
    return true;
  } catch (err) {
    if (logger && logger.warn) {
      logger.warn({ err: (err && err.message) || err }, "updateProtoOnStartup failed (non-fatal)");
    }
    return false;
  }
}

exports.updateProtoOnStartup = updateProtoOnStartup;
