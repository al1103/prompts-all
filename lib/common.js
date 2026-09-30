"use strict";
// Dùng chung cho các hàm serverless của Vercel (chỉ dùng thư viện chuẩn của Node >= 18).
const crypto = require("crypto");

const env = process.env;
const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const flag = (v, d) =>
  v === undefined || v === ""
    ? d
    : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

function cfg() {
  const model = "deepseek-v4-flash";
  return {
    base: (env.LLM_BASE_URL || "").trim(),
    key: env.LLM_API_KEY || "",
    model,
    fallback: "none",
    allowUserKeys: flag(env.ALLOW_USER_KEYS, true),
    allowedHosts: (env.ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    maxBody: num(env.MAX_BODY_KB, 200) * 1024,
    maxScenesPerCall: num(env.MAX_SCENES_PER_CALL, 8),
    maxScenes: num(env.MAX_SCENES, 400),
    ratePerMin: num(env.RATE_CALLS_PER_MIN, 40),
    timeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 45000),
  };
}

const MODEL_RE = /^[A-Za-z0-9._:/\-]{1,80}$/;
const KEY_RE = /^[\x21-\x7e]{8,400}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const eq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function json(res, code, obj, headers = {}) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit) {
  const len = parseInt(req.headers["content-length"] || "0", 10);
  if (len > limit)
    throw Object.assign(
      new Error(`yêu cầu quá lớn (tối đa ${Math.floor(limit / 1024)} KB)`),
      { status: 413 },
    );
  let raw = req.body;
  if (raw === undefined) {
    const chunks = [];
    let n = 0;
    for await (const ch of req) {
      n += ch.length;
      if (n > limit)
        throw Object.assign(new Error("yêu cầu quá lớn"), { status: 413 });
      chunks.push(ch);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw Object.assign(new Error("JSON không hợp lệ"), { status: 400 });
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

const hostOf = (req) => String(req.headers.host || "").toLowerCase();
const isLocal = (host) =>
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
const clientIp = (req) =>
  String(
    req.headers["x-real-ip"] ||
      String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim() ||
      (req.socket && req.socket.remoteAddress) ||
      "?",
  );
const secure = (req) =>
  isLocal(hostOf(req)) ||
  String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase() === "https";

// Bộ đếm theo từng instance (serverless không chia sẻ bộ nhớ): chỉ là lớp phòng thủ phụ, xem DEPLOY-VERCEL.md
const FAILS = new Map(),
  CALLS = new Map();
function prune(map, ip, windowMs, now) {
  const a = (map.get(ip) || []).filter((t) => now - t < windowMs);
  map.set(ip, a);
  return a;
}

async function gate(req, res, c) {
  const host = hostOf(req);
  if (
    !host ||
    (c.allowedHosts.length &&
      !c.allowedHosts.includes(host.replace(/:\d+$/, "")))
  ) {
    json(res, 403, { error: "forbidden" });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let oh = "";
    try {
      oh = new URL(origin).host.toLowerCase();
    } catch (e) {
      /* bỏ qua */
    }
    if (oh !== host) {
      json(res, 403, { error: "forbidden" });
      return false;
    }
  }
  if (req.headers["x-requested-with"] !== "srtwb") {
    json(res, 403, { error: "forbidden" });
    return false;
  }
  return true;
}

function rateOk(req, c) {
  const ip = clientIp(req),
    now = Date.now(),
    a = prune(CALLS, ip, 60000, now);
  if (a.length >= c.ratePerMin) return false;
  a.push(now);
  return true;
}

const endpoint = (base) => {
  base = base.replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
};
const sanitize = (s, keys) =>
  keys.filter(Boolean).reduce((t, k) => t.split(k).join("***"), String(s));

function contentOf(payload) {
  try {
    let m = payload.choices[0].message.content;
    if (Array.isArray(m)) m = m.map((p) => (p && p.text) || "").join("");
    return typeof m === "string" ? m : "";
  } catch (e) {
    return null;
  }
}

// Một lần gọi tới dịch vụ AI (thử lại 1 lần khi 429/5xx/lỗi mạng). Trả {ok, content} hoặc {ok:false, status, error}.
async function chat(c, key, model, messages) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(endpoint(c.base), {
        method: "POST",
        signal: AbortSignal.timeout(c.timeoutMs),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": "srt-whiteboard/1.0",
        },
        body: JSON.stringify({ model, messages }),
      });
      const text = await r.text();
      if (r.ok) {
        let payload;
        try {
          payload = JSON.parse(text);
        } catch (e) {
          const snippet = text.replace(/\n/g, " ").slice(0, 200);
          return { ok: false, status: 502, error: `phản hồi không phải JSON: ${snippet}` };
        }
        const content = contentOf(payload);
        return content === null
          ? {
              ok: false,
              status: 502,
              error: "phản hồi không đúng định dạng OpenAI",
            }
          : { ok: true, content };
      }
      last = sanitize(`HTTP ${r.status}: ${text.slice(0, 200)}`, [key]);
      if (r.status === 401 || r.status === 403)
        return { ok: false, status: r.status, error: last, fatal: true };
      if (r.status === 404 || r.status === 400)
        return { ok: false, status: r.status, error: last };
      await sleep(1000); // 429 / 5xx: thử lại một lần
    } catch (e) {
      last = sanitize(String((e && e.message) || e), [key]);
      await sleep(500);
    }
  }
  return { ok: false, status: 502, error: last || "không gọi được dịch vụ AI" };
}

module.exports = {
  cfg,
  json,
  readBody,
  gate,
  rateOk,
  chat,
  hostOf,
  secure,
  clientIp,
  sanitize,
  MODEL_RE,
  KEY_RE,
  eq,
};
