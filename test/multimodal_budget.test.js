const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_RECENT_IMAGE_BUDGET,
  readRecentImageBudget,
  limitHistoricalImages,
} = require("../multimodal_budget");

function img(id) {
  return { type: "image_url", image_url: { url: `data:image/png;base64,${id}` } };
}
function text(t) {
  return { type: "text", text: t };
}
function user(...parts) {
  return { role: "user", content: parts };
}

function imageUrls(messages) {
  const urls = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.image_url) urls.push(part.image_url.url.split(",")[1]);
    }
  }
  return urls;
}

test("keeps only the newest images within budget", () => {
  const messages = [user(img("a")), user(img("b")), user(img("c"))];
  const out = limitHistoricalImages(messages, 2);
  assert.deepEqual(imageUrls(out), ["b", "c"]);
});

test("replaces dropped images with a text placeholder", () => {
  const out = limitHistoricalImages([user(text("看这个"), img("a")), user(img("b"))], 1);
  assert.deepEqual(out[0].content, [text("看这个"), text("[图片]")]);
  assert.ok(out[1].content[0].image_url, "newest image must survive");
});

test("counts newest-first inside a single message", () => {
  const out = limitHistoricalImages([user(img("a"), img("b"), img("c"))], 1);
  assert.deepEqual(imageUrls(out), ["c"]);
});

test("budget 0 drops every image", () => {
  const out = limitHistoricalImages([user(img("a")), user(img("b"))], 0);
  assert.deepEqual(imageUrls(out), []);
});

test("infinite budget keeps everything untouched", () => {
  const messages = [user(img("a")), user(img("b"))];
  assert.equal(limitHistoricalImages(messages, Infinity), messages);
});

test("does not mutate the input messages", () => {
  const original = user(img("a"));
  const messages = [original, user(img("b"))];
  limitHistoricalImages(messages, 1);
  assert.ok(original.content[0].image_url, "caller's message must be left intact");
});

test("leaves string content and non-image parts alone", () => {
  const messages = [
    { role: "system", content: "你是赵梓程" },
    { role: "assistant", content: "好哦" },
    user(text("在干嘛")),
  ];
  assert.deepEqual(limitHistoricalImages(messages, 0), messages);
});

test("reads the budget from the environment", () => {
  assert.equal(readRecentImageBudget({}), DEFAULT_RECENT_IMAGE_BUDGET);
  assert.equal(readRecentImageBudget({ MULTIMODAL_RECENT_IMAGES: "4" }), 4);
  assert.equal(readRecentImageBudget({ MULTIMODAL_RECENT_IMAGES: "0" }), 0);
  assert.equal(readRecentImageBudget({ MULTIMODAL_RECENT_IMAGES: "all" }), Infinity);
  assert.equal(
    readRecentImageBudget({ MULTIMODAL_RECENT_IMAGES: "nonsense" }),
    DEFAULT_RECENT_IMAGE_BUDGET
  );
});
