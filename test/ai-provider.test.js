import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROMPT_VERSION,
  buildExplainMessages,
  createAiProvider,
  getGenerationConfig,
  normalizeBaseUrl,
  resolveAiProviderConfig
} from "../src/lib/aiProvider.js";

function withMockedFetch(t, handler) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = handler;
}

function sseResponse(lines) {
  return new Response(lines.join("\n"), { headers: { "content-type": "text/event-stream" } });
}

function baseInput(mode = "direct") {
  return {
    mode,
    selectedText: "原文选中",
    context: "[source:B1]\n原文上下文",
    question: "",
    documentTitle: "文章"
  };
}

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
  withMockedFetch(t, () => sseResponse([
    'data: {"choices":[{"delta":{"content":"未完成"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
    'data: [DONE]',
    ""
  ]));

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

test("resolves provider presets with vendor defaults and overrides", () => {
  const deepseek = resolveAiProviderConfig({ provider: "deepseek", apiKey: "k" });
  assert.equal(deepseek.type, "openai-compatible");
  assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(deepseek.model, "deepseek-v4-flash");
  assert.equal(deepseek.requiresKey, true);

  const overridden = resolveAiProviderConfig({
    provider: "deepseek",
    model: "deepseek-chat",
    baseUrl: "https://example.com/v1"
  });
  assert.equal(overridden.baseUrl, "https://example.com/v1");
  assert.equal(overridden.model, "deepseek-chat");

  const ollama = resolveAiProviderConfig({ provider: "ollama", model: "llama3.1" });
  assert.equal(ollama.requiresKey, false);
  assert.equal(ollama.baseUrl, "http://127.0.0.1:11434/v1");

  const anthropic = resolveAiProviderConfig({ provider: "anthropic", apiKey: "k" });
  assert.equal(anthropic.type, "anthropic");
  assert.equal(anthropic.baseUrl, "https://api.anthropic.com");

  const gemini = resolveAiProviderConfig({ provider: "gemini", apiKey: "k" });
  assert.equal(gemini.type, "gemini");
  assert.equal(gemini.baseUrl, "https://generativelanguage.googleapis.com");
});

test("matches provider names case-insensitively and keeps mock default", () => {
  const upper = createAiProvider({ provider: "DeepSeek", apiKey: "k" });
  assert.equal(upper.name, "deepseek");
  assert.equal(createAiProvider({ provider: "" }).name, "mock");
  assert.equal(createAiProvider({}).name, "mock");
});

test("treats empty base url and model as preset defaults", () => {
  const resolved = resolveAiProviderConfig({
    provider: "deepseek",
    apiKey: "k",
    baseUrl: "",
    model: ""
  });
  assert.equal(resolved.baseUrl, "https://api.deepseek.com");
  assert.equal(resolved.model, "deepseek-v4-flash");
});

test("rejects unknown providers instead of silently falling back to mock", () => {
  assert.throws(() => createAiProvider({ provider: "not-a-provider" }), /未知 AI provider/);
});

test("status reflects configuration state per provider", () => {
  const withoutKey = createAiProvider({ provider: "deepseek", apiKey: "" });
  assert.equal(withoutKey.getStatus().configured, false);

  const withKey = createAiProvider({ provider: "deepseek", apiKey: "k" });
  assert.deepEqual(withKey.getStatus(), {
    provider: "deepseek",
    type: "openai-compatible",
    configured: true,
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com"
  });

  const ollama = createAiProvider({ provider: "ollama", model: "llama3.1" });
  assert.equal(ollama.getStatus().configured, true);
});

test("keeps openai-compatible defaults when no env or config overrides exist", async (t) => {
  const savedBase = process.env.AI_API_BASE;
  const savedModel = process.env.AI_MODEL;
  delete process.env.AI_API_BASE;
  delete process.env.AI_MODEL;
  t.after(() => {
    if (savedBase === undefined) delete process.env.AI_API_BASE;
    else process.env.AI_API_BASE = savedBase;
    if (savedModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = savedModel;
  });

  withMockedFetch(t, async () => new Response(JSON.stringify({
    choices: [{ message: { content: "ok" } }]
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const provider = createAiProvider({ provider: "openai-compatible", apiKey: "k" });
  const status = provider.getStatus();
  assert.equal(status.baseUrl, "https://api.openai.com/v1");
  assert.equal(status.model, "gpt-4.1-mini");
  await provider.explain(baseInput());
});

test("sends an Anthropic Messages request and parses the response", async (t) => {
  let requestBody;
  let requestHeaders;
  let requestUrl;
  withMockedFetch(t, async (url, options) => {
    requestUrl = String(url);
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "Anthropic 回答" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const provider = createAiProvider({
    provider: "anthropic",
    apiKey: "test-key",
    model: "claude-test"
  });
  const result = await provider.explain(baseInput());

  assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(requestHeaders["x-api-key"], "test-key");
  assert.equal(requestHeaders["anthropic-version"], "2023-06-01");
  assert.equal(requestBody.model, "claude-test");
  assert.match(requestBody.system, /不可信资料/);
  assert.equal(requestBody.messages.length, 1);
  assert.equal(requestBody.messages[0].role, "user");
  assert.equal(requestBody.messages[0].content[0].type, "text");
  assert.match(requestBody.messages[0].content[0].text, /原文选中/);
  assert.equal(requestBody.max_tokens, 700);
  assert.equal(requestBody.temperature, 0.1);
  assert.equal(requestBody.stream, false);

  assert.equal(result.answer, "Anthropic 回答");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-test");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 });
});

test("maps Anthropic max_tokens stop reason to a length limit", async (t) => {
  withMockedFetch(t, async () => new Response(JSON.stringify({
    content: [{ type: "text", text: "截断" }],
    stop_reason: "max_tokens",
    usage: {}
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const provider = createAiProvider({
    provider: "anthropic",
    apiKey: "test-key",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-test"
  });
  const result = await provider.explain(baseInput("deep"));

  assert.equal(result.finishReason, "length");
  assert.equal(result.answer, "截断");
});

test("streams an Anthropic answer with usage from start and delta events", async (t) => {
  let requestUrl;
  let requestBody;
  const deltas = [];
  withMockedFetch(t, async (url, options) => {
    requestUrl = String(url);
    requestBody = JSON.parse(options.body);
    return sseResponse([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"流式"}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"回答"}}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":8}}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      ""
    ]);
  });

  const provider = createAiProvider({
    provider: "anthropic",
    apiKey: "test-key",
    model: "claude-test"
  });
  const result = await provider.streamExplain(baseInput(), (delta) => deltas.push(delta));

  assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(requestBody.stream, true);
  assert.deepEqual(deltas, ["流式", "回答"]);
  assert.equal(result.answer, "流式回答");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 });
});

test("sends a Gemini generateContent request and parses candidates", async (t) => {
  let requestUrl;
  let requestHeaders;
  let requestBody;
  withMockedFetch(t, async (url, options) => {
    requestUrl = String(url);
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Gemini 回答" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const provider = createAiProvider({
    provider: "gemini",
    apiKey: "test-key",
    model: "gemini-test"
  });
  const result = await provider.explain(baseInput());

  assert.equal(requestUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
  assert.equal(requestHeaders["x-goog-api-key"], "test-key");
  assert.equal(requestBody.contents[0].role, "user");
  assert.equal(requestBody.contents[0].parts[0].text.includes("原文选中"), true);
  assert.ok(!("type" in requestBody.contents[0].parts[0]));
  assert.deepEqual(requestBody.contents[0].parts[0], { text: requestBody.contents[0].parts[0].text });
  assert.match(requestBody.systemInstruction.parts[0].text, /不可信资料/);
  assert.equal(requestBody.generationConfig.maxOutputTokens, 700);
  assert.equal(requestBody.generationConfig.temperature, 0.1);

  assert.equal(result.answer, "Gemini 回答");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.provider, "gemini");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 7 });
});

test("maps Gemini MAX_TOKENS to a length limit", async (t) => {
  withMockedFetch(t, async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "截断" }] }, finishReason: "MAX_TOKENS" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const provider = createAiProvider({ provider: "gemini", apiKey: "k", model: "gemini-test" });
  const result = await provider.explain(baseInput());
  assert.equal(result.finishReason, "length");
});

test("streams Gemini sse chunks as incremental parts and keeps whitespace", async (t) => {
  let requestUrl;
  const deltas = [];
  withMockedFetch(t, async (url) => {
    requestUrl = String(url);
    return sseResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"流式"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":0}}',
      'data: {"candidates":[{"content":{"parts":[{"text":" "}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"回答"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":4}}',
      ""
    ]);
  });

  const provider = createAiProvider({ provider: "gemini", apiKey: "k", model: "gemini-test" });
  const result = await provider.streamExplain(baseInput(), (delta) => deltas.push(delta));

  assert.match(requestUrl, /streamGenerateContent\?alt=sse/);
  assert.deepEqual(deltas, ["流式", " ", "回答"]);
  assert.equal(result.answer, "流式 回答");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
});

test("ignores malformed sse lines and keeps the rest of the stream", async (t) => {
  const deltas = [];
  withMockedFetch(t, () => sseResponse([
    'data: not-json',
    ': keepalive comment',
    'event: ping',
    'data: {"choices":[{"delta":{"content":"正文"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    ""
  ]));

  const provider = createAiProvider({
    provider: "openai-compatible",
    apiKey: "k",
    baseUrl: "https://api.deepseek.com",
    model: "m"
  });
  const result = await provider.streamExplain(baseInput(), (delta) => deltas.push(delta));

  assert.deepEqual(deltas, ["正文"]);
  assert.equal(result.answer, "正文");
  assert.equal(result.finishReason, "stop");
});

test("allows keyless Ollama requests without an authorization header", async (t) => {
  let requestHeaders;
  withMockedFetch(t, async (url, options) => {
    requestHeaders = options.headers;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "本地回答" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const provider = createAiProvider({ provider: "ollama", model: "llama3.1" });
  const result = await provider.explain(baseInput());

  assert.ok(!("authorization" in requestHeaders));
  assert.equal(result.answer, "本地回答");
  assert.equal(result.provider, "ollama");
});

test("falls back to the vendor root when anthropic or gemini base url is empty", async (t) => {
  const urls = [];
  withMockedFetch(t, async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: {}
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const anthropic = createAiProvider({ provider: "anthropic", apiKey: "k", baseUrl: "" });
  await anthropic.explain(baseInput());
  assert.equal(urls[0], "https://api.anthropic.com/v1/messages");

  const gemini = createAiProvider({ provider: "gemini", apiKey: "k", baseUrl: "", model: "g" });
  await gemini.explain(baseInput());
  assert.equal(urls[1], "https://generativelanguage.googleapis.com/v1beta/models/g:generateContent");
});

test("propagates delta callback errors instead of swallowing them", async (t) => {
  withMockedFetch(t, () => sseResponse([
    'data: {"choices":[{"delta":{"content":"正文"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    ""
  ]));

  const provider = createAiProvider({
    provider: "openai-compatible",
    apiKey: "k",
    baseUrl: "https://api.deepseek.com",
    model: "m"
  });
  await assert.rejects(
    provider.streamExplain(baseInput(), () => {
      throw new Error("client went away");
    }),
    /client went away/
  );
});
