import assert from "node:assert/strict";
import test from "node:test";
import { buildExplainMessages, createAiProvider, normalizeBaseUrl } from "../src/lib/aiProvider.js";

test("builds deep explain prompt with selection, context, and grounded answer rules", () => {
  const messages = buildExplainMessages({
    mode: "deep",
    selectedText: "alienated labor",
    context: "The article connects alienated labor with modern technical organizations.",
    question: "",
    documentTitle: "Philosophy notes"
  });

  const promptText = messages.map((message) => message.content).join("\n");
  assert.match(promptText, /alienated labor/);
  assert.match(promptText, /modern technical organizations/);
  assert.match(promptText, /深入解析/);
  assert.match(promptText, /引用原文/);
  assert.match(promptText, /\[第 N 页\]/);
});

test("direct and deep prompts ask for clearly different answer shapes", () => {
  const baseInput = {
    selectedText: "key concept",
    context: "The context defines the key concept.",
    question: "",
    documentTitle: "Test article"
  };

  const directPrompt = buildExplainMessages({ ...baseInput, mode: "direct" })
    .map((message) => message.content)
    .join("\n");
  const deepPrompt = buildExplainMessages({ ...baseInput, mode: "deep" })
    .map((message) => message.content)
    .join("\n");

  assert.match(directPrompt, /简明解释/);
  assert.match(directPrompt, /不要扩展到原文未支持的背景/);
  assert.doesNotMatch(directPrompt, /概念背景/);

  assert.match(deepPrompt, /概念背景/);
  assert.match(deepPrompt, /论证作用/);
  assert.match(deepPrompt, /可追问问题/);
});

test("mock provider returns mode-specific direct and deep answers", async () => {
  const provider = createAiProvider({ provider: "mock" });
  const input = {
    selectedText: "key concept",
    context: "The context defines the key concept.",
    question: "",
    documentTitle: "Test article"
  };

  const direct = await provider.explain({ ...input, mode: "direct" });
  const deep = await provider.explain({ ...input, mode: "deep" });

  assert.equal(direct.provider, "mock");
  assert.match(direct.answer, /简明解释/);
  assert.doesNotMatch(direct.answer, /论证作用/);

  assert.equal(deep.provider, "mock");
  assert.match(deep.answer, /概念背景/);
  assert.match(deep.answer, /论证作用/);
});

test("normalizes protocol-relative and bare api base urls", () => {
  assert.equal(normalizeBaseUrl("//api.deepseek.com"), "https://api.deepseek.com");
  assert.equal(normalizeBaseUrl("api.deepseek.com"), "https://api.deepseek.com");
  assert.equal(normalizeBaseUrl("https://api.deepseek.com/"), "https://api.deepseek.com");
});

test("calls an OpenAI-compatible provider with bounded output", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.headers.authorization, "Bearer test-key");
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Provider answer" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const provider = createAiProvider({
    provider: "openai-compatible",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  });
  const result = await provider.explain({
    mode: "direct",
    selectedText: "Selected text",
    context: "Context",
    question: "",
    documentTitle: "Article"
  });

  assert.equal(result.answer, "Provider answer");
  assert.equal(requestBody.model, "deepseek-v4-flash");
  assert.equal(requestBody.max_tokens, 2000);
  assert.equal(requestBody.temperature, 0.2);
  assert.equal(requestBody.stream, false);
});

test("streams an OpenAI-compatible answer delta by delta", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestBody;
  globalThis.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response([
      'data: {"choices":[{"delta":{"content":"流式"}}]}',
      'data: {"choices":[{"delta":{"content":"回答"}}]}',
      'data: [DONE]',
      ""
    ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
  };

  const provider = createAiProvider({
    provider: "openai-compatible",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-test"
  });
  const deltas = [];
  const result = await provider.streamExplain({
    mode: "direct",
    selectedText: "原文",
    context: "[第 1 段] 原文",
    question: "",
    documentTitle: "文章"
  }, (delta) => deltas.push(delta));

  assert.equal(requestBody.stream, true);
  assert.deepEqual(deltas, ["流式", "回答"]);
  assert.equal(result.answer, "流式回答");
});
