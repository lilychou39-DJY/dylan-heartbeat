// 部分 Claude 中转站不使用 OpenAI 的 reasoning_content 字段，而是把思考块
// 以 <thinking>...</thinking> 内联进正文。Kelivo 的解析器只认 <think> 和
// <thought>（见 lib/features/chat/utils/thinking_tag_parser.dart），标签对不上
// 就会把思考内容当普通文字显示出来。这里在转发时改写成它认识的标签。

const REPLACEMENTS = [
  ["</thinking>", "</think>"],
  ["<thinking>", "<think>"],
];

// 标签可能被 SSE 分片切断，结尾要扣住可能是半个标签的部分。
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
  };
}

module.exports = { createThinkingTagRewriter };
