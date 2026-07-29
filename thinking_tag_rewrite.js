// 模型有时会把思考内容以 <thinking>...</thinking> 当作普通文字写进正文。
// Kelivo 的解析器只认 <think> 和 <thought>（见
// lib/features/chat/utils/thinking_tag_parser.dart），标签对不上就会原样显示。
// 这里在转发时改写成它认识的标签，让它折叠成“思考过程”。
//
// 注意必须作用在 JSON 解码后的 content 上：上游会把 < 转义成 <，
// 直接在 SSE 字节流上做字面替换是匹配不到的。

const REPLACEMENTS = [
  ["</thinking>", "</think>"],
  ["<thinking>", "<think>"],
];

// 标签可能被切断在两个 delta 之间，结尾要扣住可能是半个标签的部分。
const MAX_HOLD = Math.max(...REPLACEMENTS.map(([from]) => from.length)) - 1;

function rewrite(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
  return out;
}

// 只有最后一个完整标签之后的内容才可能是被截断的半个标签；改写产生的 <think>
// 又正好是 <thinking> 的前缀，所以必须先划出这个边界，否则会把已完成的标签扣住。
function holdLength(buffer) {
  let boundary = 0;
  for (const [from] of REPLACEMENTS) {
    const last = buffer.lastIndexOf(from);
    if (last >= 0) boundary = Math.max(boundary, last + from.length);
  }
  const tail = buffer.slice(boundary);
  for (let n = Math.min(MAX_HOLD, tail.length); n > 0; n--) {
    const candidate = tail.slice(-n);
    if (REPLACEMENTS.some(([from]) => n < from.length && from.startsWith(candidate))) return n;
  }
  return 0;
}

function createThinkingTagRewriter() {
  let pending = "";
  return {
    push(text) {
      if (!text) return "";
      pending += text;
      const hold = holdLength(pending);
      const cut = pending.length - hold;
      const out = rewrite(pending.slice(0, cut));
      pending = pending.slice(cut);
      return out;
    },
    flush() {
      const out = rewrite(pending);
      pending = "";
      return out;
    },
    get held() {
      return pending;
    },
  };
}

// 对 SSE 流做逐事件改写：解析 data: 行，改写 delta.content 再重新序列化。
function createSseThinkingRewriter() {
  const tags = createThinkingTagRewriter();
  let lineBuffer = "";
  let template = null;

  function extraEvent(text) {
    const base = template
      ? JSON.parse(JSON.stringify(template))
      : { object: "chat.completion.chunk", choices: [] };
    base.choices = [{ index: 0, delta: { content: text }, finish_reason: null }];
    return "data: " + JSON.stringify(base) + "\n\n";
  }

  function transformLine(line) {
    const body = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!body.startsWith("data:")) return line;
    const payload = body.slice(5).trim();

    if (payload === "[DONE]") {
      const rest = tags.flush();
      return (rest ? extraEvent(rest) : "") + line;
    }

    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      return line;
    }
    if (!Array.isArray(obj.choices)) return line;

    // 结束事件之前必须把扣住的内容吐出来，否则会排在 finish 之后被丢弃。
    const finishing = obj.choices.some((c) => c && c.finish_reason);
    let prefix = "";
    let changed = false;

    for (const choice of obj.choices) {
      const delta = choice && (choice.delta || choice.message);
      if (delta && typeof delta.content === "string" && delta.content) {
        delta.content = tags.push(delta.content);
        changed = true;
      }
    }
    if (finishing && tags.held) prefix = extraEvent(tags.flush());

    template = obj;
    return prefix + (changed ? "data: " + JSON.stringify(obj) : line);
  }

  return {
    push(text) {
      if (!text) return "";
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();
      return lines.map((line) => transformLine(line) + "\n").join("");
    },
    flush() {
      let out = "";
      if (lineBuffer) {
        out += transformLine(lineBuffer);
        lineBuffer = "";
      }
      const rest = tags.flush();
      if (rest) out += extraEvent(rest);
      return out;
    },
  };
}

// 非流式响应：整包 JSON 里改写 message.content。解析失败就原样返回。
function rewriteJsonBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!Array.isArray(parsed?.choices)) return text;

  let changed = false;
  for (const choice of parsed.choices) {
    const message = choice && (choice.message || choice.delta);
    if (message && typeof message.content === "string" && message.content) {
      const next = rewrite(message.content);
      if (next !== message.content) {
        message.content = next;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(parsed) : text;
}

module.exports = {
  createThinkingTagRewriter,
  createSseThinkingRewriter,
  rewriteJsonBody,
  rewriteThinkingTags: rewrite,
};
