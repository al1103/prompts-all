"use strict";
const { cfg, json, gate, secure } = require("../lib/common");

module.exports = async (req, res) => {
  const c = cfg();
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" }, { Allow: "GET" });
  if (!(await gate(req, res, c))) return;
  let host = ""; try { host = c.base ? new URL(c.base).host : ""; } catch (e) { /* bỏ qua */ }
  json(res, 200, {
    mode: "proxy", serverKey: !!(c.base && c.key), needsPassword: false, allowUserKeys: !!(c.allowUserKeys && c.base),
    model: c.model, fallback: "none", host, secure: secure(req), maxScenes: c.maxScenes, maxScenesPerCall: c.maxScenesPerCall,
  });
};

