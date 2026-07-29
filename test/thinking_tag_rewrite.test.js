const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createThinkingTagRewriter,
  createSseThinkingRewriter,
  rewriteJsonBody,
} = require("../thinking_tag_rewrite");

function run(chunks) {
  const rewriter = createThinkingTagRewriter();
  let out = "";
  for (const chunk of chunks) out += rewriter.push(chunk);
  return out + rewriter.flush();
}

test("rewrites inline thinking tags to the tags Kelivo parses", () => {
  assert.equal(run(["<thinking>hi</thinking>done"]), "<think>hi</think>done");
});

test("rewrites tags split across chunks", () => {
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

test("does not hold back text that only looks like a tag start", () => {
  assert.equal(run(["a < b"]), "a < b");
});

// --- SSE layer -------------------------------------------------------------
// 上游把 < 转义成 <，所以改写必须发生在 JSON 解码之后。

function sse(content, extra = {}) {
  const chunk = {
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: null, ...extra }],
  };
  return "data: " + JSON.stringify(chunk) + "\n\n";
}

function collectContent(streamText) {
  let out = "";
  for (const line of streamText.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    for (const choice of JSON.parse(payload).choices || []) {
      if (choice.delta && typeof choice.delta.content === "string") out += choice.delta.content;
    }
  }
  return out;
}

function runSse(events) {
  const rewriter = createSseThinkingRewriter();
  let out = "";
  for (const event of events) out += rewriter.push(event);
  return out + rewriter.flush();
}

test("rewrites content inside SSE events", () => {
  const out = runSse([sse("<thinking>why</thinking>hi")]);
  assert.equal(collectContent(out), "<think>why</think>hi");
});

test("rewrites a tag split across two SSE events", () => {
  const out = runSse([sse("<thin"), sse("king>why</thinking>hi")]);
  assert.equal(collectContent(out), "<think>why</think>hi");
});

test("flushes held text before [DONE]", () => {
  const out = runSse([sse("hi<thin"), "data: [DONE]\n\n"]);
  assert.equal(collectContent(out), "hi<thin");
  assert.ok(out.trimEnd().endsWith("[DONE]"), "[DONE] must stay last");
});

test("flushes held text before a finish_reason event", () => {
  const out = runSse([sse("hi<thin"), sse("", { finish_reason: "stop" })]);
  assert.equal(collectContent(out), "hi<thin");
});

test("survives a data line split across chunks", () => {
  const event = sse("<thinking>x</thinking>y");
  const out = runSse([event.slice(0, 30), event.slice(30)]);
  assert.equal(collectContent(out), "<think>x</think>y");
});

test("leaves non-data lines and unparsable payloads untouched", () => {
  const out = runSse([": keep-alive\n\n", "data: not-json\n\n"]);
  assert.ok(out.includes(": keep-alive"));
  assert.ok(out.includes("data: not-json"));
});

test("does not touch reasoning_content", () => {
  const chunk = {
    choices: [{ index: 0, delta: { reasoning_content: "<thinking>raw" }, finish_reason: null }],
  };
  const out = runSse(["data: " + JSON.stringify(chunk) + "\n\n"]);
  assert.ok(out.includes("<thinking>raw"));
});

test("rewrites non-streaming JSON bodies", () => {
  const body = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "<thinking>a</thinking>b" } }],
  });
  assert.equal(JSON.parse(rewriteJsonBody(body)).choices[0].message.content, "<think>a</think>b");
});

test("returns unparsable bodies unchanged", () => {
  assert.equal(rewriteJsonBody("not json"), "not json");
});
