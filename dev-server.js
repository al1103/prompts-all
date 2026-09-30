"use strict";
// Chạy thử cục bộ giống Vercel:  node dev-server.js   (mở http://localhost:3000)
const http = require("http"), fs = require("fs"), path = require("path");
const routes = { "/api/status": require("./api/status.js"), "/api/llm": require("./api/llm.js") };
const port = parseInt(process.env.PORT || "3000", 10);
http.createServer(async (req, res) => {
  const p = req.url.split("?")[0];
  if (routes[p]) { try { await routes[p](req, res); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: "lỗi máy chủ" })); } return; }
  if (p === "/" || p === "/index.html") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html"))); }
  res.statusCode = 404; res.end("not found");
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/`));
