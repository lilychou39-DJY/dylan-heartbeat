// Kelivo 每次请求都会带上整段历史，历史里的图片会被反复重传并重新计费。
// 图片攒到几张之后，单次请求要重新处理全部图片，延迟持续上升，最终上游
// 超时返回 502，客户端等不到响应就断开（表现为 Broken pipe）。
//
// 这里只保留最近若干张图片，更早的降级成 [图片] 占位符：新发的图仍然看得见，
// 旧图不再拖累后续每一次请求。

const DEFAULT_RECENT_IMAGE_BUDGET = 2;
const PLACEHOLDER = "[图片]";
const UNLIMITED = new Set(["all", "unlimited", "-1", "off"]);

function isImagePart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.image_url) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("image");
}

function readRecentImageBudget(env = process.env) {
  const raw = String(env.MULTIMODAL_RECENT_IMAGES ?? "").trim();
  if (!raw) return DEFAULT_RECENT_IMAGE_BUDGET;
  if (UNLIMITED.has(raw.toLowerCase())) return Infinity;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RECENT_IMAGE_BUDGET;
  return Math.floor(parsed);
}

// 从最后一条消息往前走，预算用完之后遇到的图片全部替换掉。
// 不改动传入的对象，避免影响用同一份消息构建的时间线。
function limitHistoricalImages(messages, budget = readRecentImageBudget()) {
  if (!Array.isArray(messages)) return messages;
  if (!Number.isFinite(budget)) return messages;

  let remaining = budget;
  const result = messages.slice();

  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (!msg || !Array.isArray(msg.content)) continue;

    let changed = false;
    const parts = msg.content.slice();
    for (let j = parts.length - 1; j >= 0; j--) {
      if (!isImagePart(parts[j])) continue;
      if (remaining > 0) {
        remaining -= 1;
        continue;
      }
      parts[j] = { type: "text", text: PLACEHOLDER };
      changed = true;
    }
    if (changed) result[i] = { ...msg, content: parts };
  }

  return result;
}

module.exports = {
  DEFAULT_RECENT_IMAGE_BUDGET,
  isImagePart,
  readRecentImageBudget,
  limitHistoricalImages,
};
