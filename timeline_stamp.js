// wake_up.js 依靠时间线里用户消息的时间前缀来判断“用户多久没说话”。
// Kelivo 的聊天内容模板默认是 {{ message }}，不含时间，于是自动唤醒永远停在
// “未找到用户时间”并直接返回。
//
// 这里在写入时间线之前给最后一条用户消息补上时间戳。只影响时间线那一路；
// 转发给模型的消息由 prepareMessageForLLM 单独构建，不受影响，模型看不到
// 这个前缀，也就不会去模仿它。

// 与 server.js / wake_up.js 的解析规则保持一致，用于避免重复盖章。
const TIMESTAMP_RE = /（?\s*(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T]?)(\d{1,2})[:：](\d{2})/;

function formatStamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function firstTextOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const part of content) {
    if (typeof part === "string") return part;
    if (part && typeof part.text === "string") return part.text;
  }
  return "";
}

// 返回新数组，不修改传入的消息对象。
function stampLastUserMessage(messages, timeZone, now = new Date()) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let index = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "user") {
      index = i;
      break;
    }
  }
  if (index === -1) return messages;

  const target = messages[index];
  // 用户如果自己配了带时间的模板，就不要再叠一层。
  if (TIMESTAMP_RE.test(firstTextOf(target.content))) return messages;

  let stamp;
  try {
    stamp = formatStamp(now, timeZone || "UTC");
  } catch {
    stamp = formatStamp(now, "UTC");
  }
  const prefix = `（${stamp}）`;

  let content;
  if (typeof target.content === "string") {
    content = prefix + target.content;
  } else if (Array.isArray(target.content)) {
    content = [{ type: "text", text: prefix }, ...target.content];
  } else {
    content = prefix;
  }

  const next = messages.slice();
  next[index] = { ...target, content };
  return next;
}

module.exports = { stampLastUserMessage, formatStamp };
