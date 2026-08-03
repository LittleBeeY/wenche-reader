import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROMPT_VERSION,
  buildExplainMessages,
  createAiProvider,
  getGenerationConfig,
  normalizeBaseUrl
} from "../src/lib/aiProvider.js";

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
  assert.match(promptText, /引用某项来源/);
  assert.match(promptText, /\[cite:Bn\]/);
  assert.match(promptText, /不可信资料/);
});

test("direct and deep prompts only explain meaning at different depths", () => {
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

  assert.match(directPrompt, /小标题“解析”/);
  assert.match(directPrompt, /2-4 句话/);
  assert.match(directPrompt, /不做无依据扩展/);
  assert.match(directPrompt, /不要添加其他栏目/);

  assert.match(deepPrompt, /小标题“深入解析”/);
  assert.match(deepPrompt, /省略的逻辑、关键措辞和上下文限定/);
  assert.match(deepPrompt, /不要添加其他栏目/);
  assert.doesNotMatch(deepPrompt, /概念背景|论证作用|可能争议|可追问问题/);
  assert.deepEqual(getGenerationConfig("direct"), { temperature: 0.1, maxTokens: 700 });
  assert.deepEqual(getGenerationConfig("deep"), { temperature: 0.2, maxTokens: 3200 });
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
  assert.match(direct.answer, /^## 解析/);
  assert.doesNotMatch(direct.answer, /原文依据/);

  assert.equal(deep.provider, "mock");
  assert.match(deep.answer, /^## 深入解析/);
  assert.doesNotMatch(deep.answer, /原文依据|上下文关系|概念背景|论证作用|可能争议|可追问问题/);
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
  assert.equal(requestBody.max_tokens, 700);
  assert.equal(requestBody.temperature, 0.1);
  assert.equal(requestBody.stream, false);
  assert.equal(result.model, "deepseek-v4-flash");
  assert.equal(result.promptVersion, AI_PROMPT_VERSION);
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
      'data: {"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}',
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
  assert.equal(result.finishReason, "stop");
});

test("reports a streaming length limit to the caller", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"content":"未完成"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
    'data: [DONE]',
    ""
  ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });

  const provider = createAiProvider({
    provider: "openai-compatible",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-test"
  });
  const result = await provider.streamExplain({
    mode: "deep",
    selectedText: "原文",
    context: "上下文",
    question: "",
    documentTitle: "文章"
  }, () => {});

  assert.equal(result.answer, "未完成");
  assert.equal(result.finishReason, "length");
});
