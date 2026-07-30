const test = require("node:test");
const assert = require("node:assert/strict");
const { stampLastUserMessage, formatStamp } = require("../timeline_stamp");

const TZ = "Asia/Shanghai";
const NOW = new Date("2026-07-30T01:05:00Z"); // 上海时间 09:05

test("formats the stamp in the configured time zone", () => {
  assert.equal(formatStamp(NOW, TZ), "2026-07-30 09:05");
  assert.equal(formatStamp(NOW, "UTC"), "2026-07-30 01:05");
});

test("uses a 24-hour clock at midnight", () => {
  const midnight = new Date("2026-07-29T16:00:00Z"); // 上海时间次日 00:00
  assert.equal(formatStamp(midnight, TZ), "2026-07-30 00:00");
});

test("stamps only the last user message", () => {
  const messages = [
    { role: "system", content: "角色设定" },
    { role: "user", content: "早" },
    { role: "assistant", content: "早呀" },
    { role: "user", content: "我到工位啦" },
  ];
  const out = stampLastUserMessage(messages, TZ, NOW);
  assert.equal(out[3].content, "（2026-07-30 09:05）我到工位啦");
  assert.equal(out[1].content, "早");
  assert.equal(out[0].content, "角色设定");
});

test("does not mutate the input messages", () => {
  const messages = [{ role: "user", content: "原文" }];
  const out = stampLastUserMessage(messages, TZ, NOW);
  assert.equal(messages[0].content, "原文");
  assert.notEqual(out[0].content, "原文");
  assert.notEqual(out, messages);
});

test("does not stamp twice when a timestamp is already present", () => {
  const messages = [{ role: "user", content: "（2026-07-30 08:00）我到工位啦" }];
  const out = stampLastUserMessage(messages, TZ, NOW);
  assert.equal(out, messages, "已带时间戳时应原样返回");
});

test("prepends a text part for multimodal content", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        { type: "text", text: "看这个" },
      ],
    },
  ];
  const out = stampLastUserMessage(messages, TZ, NOW);
  assert.deepEqual(out[0].content[0], { type: "text", text: "（2026-07-30 09:05）" });
  assert.equal(out[0].content.length, 3);
});

test("leaves message lists without a user message untouched", () => {
  const messages = [{ role: "system", content: "角色设定" }];
  assert.equal(stampLastUserMessage(messages, TZ, NOW), messages);
});

test("tolerates empty and non-array input", () => {
  assert.deepEqual(stampLastUserMessage([], TZ, NOW), []);
  assert.equal(stampLastUserMessage(null, TZ, NOW), null);
});

test("falls back to UTC when the time zone is invalid", () => {
  const messages = [{ role: "user", content: "hi" }];
  const out = stampLastUserMessage(messages, "Not/AZone", NOW);
  assert.equal(out[0].content, "（2026-07-30 01:05）hi");
});

test("the stamp is parseable by the gateway timestamp regex", () => {
  const re = /（?\s*(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T]?)(\d{1,2})[:：](\d{2})/;
  const out = stampLastUserMessage([{ role: "user", content: "早" }], TZ, NOW);
  const match = out[0].content.match(re);
  assert.ok(match, "时间戳必须能被 wake_up 的正则匹配");
  assert.equal(match[1], "2026");
});
