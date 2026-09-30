"use strict";
// POST /api/llm  {messages:[{role,content}], model?, fallback?}  ->  {content, model}
// Chuyển tiếp MỘT lượt hội thoại tới dịch vụ AI cố định (LLM_BASE_URL). Không phải proxy mở.
const {
  cfg,
  json,
  readBody,
  gate,
  rateOk,
  chat,
  secure,
  sanitize,
  MODEL_RE,
  KEY_RE,
} = require("../lib/common");

module.exports = async (req, res) => {
  const c = cfg();
  if (req.method !== "POST")
    return json(res, 405, { error: "method not allowed" }, { Allow: "POST" });
  if (!(await gate(req, res, c))) return;
  if (!c.base)
    return json(res, 409, { error: "máy chủ chưa đặt LLM_BASE_URL" });

  // --- chọn khóa ---
  const userKey = String(req.headers["x-llm-key"] || "").trim();
  let key;
  if (userKey) {
    if (!c.allowUserKeys)
      return json(res, 403, { error: "máy chủ không cho nhập khóa riêng" });
    if (!KEY_RE.test(userKey))
      return json(res, 400, { error: "khóa API không hợp lệ" });
    key = userKey;
  } else {
    key = c.key;
    if (!key)
      return json(res, 409, {
        error: "chưa có khóa: hãy nhập khóa API của bạn trong trang",
      });
  }

  // --- kiểm tra nội dung ---
  let body;
  try {
    body = await readBody(req, c.maxBody);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message });
  }
  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > 8)
    return json(res, 400, { error: "messages không hợp lệ" });
  for (const m of msgs) {
    if (
      !m ||
      !["user", "assistant"].includes(m.role) ||
      typeof m.content !== "string" ||
      m.content.length > 80000
    )
      return json(res, 400, { error: "messages không hợp lệ" });
  }
  if (msgs[0].role !== "user")
    return json(res, 400, { error: "messages không hợp lệ" });
  const nScenes = (msgs[0].content.match(/^CẢNH \d+ \(/gm) || []).length;
  if (nScenes > c.maxScenesPerCall)
    return json(res, 400, {
      error: `mỗi lượt gọi tối đa ${c.maxScenesPerCall} cảnh`,
    });
  const model = "gpt-oss:20b";
  if (!rateOk(req, c))
    return json(
      res,
      429,
      { error: "quá nhiều lượt gọi, thử lại sau ít phút" },
      { "Retry-After": "60" },
    );

  // --- gọi AI ---
  const r = await chat(c, key, model, msgs);
  if (r.ok) return json(res, 200, { content: r.content, model });
  if (r.fatal)
    return json(res, 502, {
      error:
        "khóa API bị từ chối (" +
        r.error +
        "). Kiểm tra khóa, và xem dịch vụ có giới hạn khóa chỉ dùng cho một số ứng dụng không.",
      upstream: r.status,
    });
  return json(res, 502, {
    error: sanitize(`model '${model}': ${r.error}`, [key]),
  });
};
