const test = require("node:test");
const assert = require("node:assert/strict");
const { createThinkingTagRewriter } = require("../thinking_tag_rewrite");

function run(chunks) {
  const rewriter = createThinkingTagRewriter();
  let out = "";
  for (const chunk of chunks) out += rewriter.push(chunk);
  return out + rewriter.flush();
}

test("rewrites inline thinking tags to the tags Kelivo parses", () => {
  assert.equal(run(["<thinking>hi</thinking>done"]), "<think>hi</think>done");
});

test("rewrites tags split across stream chunks", () => {
  assert.equal(run(["<thin", "king>hi</think", "ing>done"]), "<think>hi</think>done");
});

test("holds back a trailing partial tag until it resolves", () => {
  const rewriter = createThinkingTagRewriter();
  assert.equal(rewriter.push("text<thin"), "text");
  assert.equal(rewriter.push("king>"), "<think>");
  assert.equal(rewriter.flush(), "");
});

test("emits a trailing partial tag that never completes", () => {
  assert.equal(run(["done<thin"]), "done<thin");
});

test("leaves unrelated content untouched", () => {
  const payload = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
  assert.equal(run([payload]), payload);
});

test("does not hold back text that only looks like a tag start", () => {
  assert.equal(run(["a < b"]), "a < b");
});
