import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AI_KEY_ENV_ALIASES,
  AI_KEY_ENV_FALLBACK_ORDER
} from "../src/lib/aiEnvKeys.js";
import { createApp } from "../src/server.js";
import { consumeEventStream } from "../public/aiStream.js";

const AI_ENV_KEYS = [
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_API_BASE",
  "AI_MODEL",
  ...new Set([
    ...Object.values(AI_KEY_ENV_ALIASES).flat(),
    ...AI_KEY_ENV_FALLBACK_ORDER
  ])
];

function restoreAiEnv(t) {
  const saved = Object.fromEntries(AI_ENV_KEYS.map((key) => [key, process.env[key]]));
  // 测试开始前清理全部 AI 环境变量，避免本机已有的别名变量（如 OPENAI_API_KEY）污染断言。
  for (const key of AI_ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const key of AI_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

async function withTestServer(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-"));
  const app = createApp({
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    envPath: options.envPath || path.join(root, ".env"),
    aiProvider: options.aiProvider,
    aiProviderConfig: options.aiProviderConfig || { provider: "mock" },
    aiRequestTimeoutMs: options.aiRequestTimeoutMs,
    uploadLimits: options.uploadLimits,
    aiTestRequestImpl: options.aiTestRequestImpl
  });
  options.onRoot?.(root);
  options.onApp?.(app);

  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    app.locals.storage.close();
    await rm(root, { recursive: true, force: true });
  });

  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("serves browser renderer dependencies", async (t) => {
  const baseUrl = await withTestServer(t);

  for (const asset of [
    "marked.min.js",
    "purify.min.js",
    "jszip.min.js",
    "docx-preview.min.js"
  ]) {
    const response = await fetch(`${baseUrl}/vendor/${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
  }
});

test("sets browser security headers without exposing Express", async (t) => {
  const baseUrl = await withTestServer(t);
  const response = await fetch(baseUrl);

  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("reports the service identity from the health endpoint", async (t) => {
  const baseUrl = await withTestServer(t);
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    name: "文澈阅读",
    fullName: "文澈AI深度阅读系统",
    version: "1.1.0",
    status: "ok"
  });
});

test("reports ai provider status without exposing secrets", async (t) => {
  const baseUrl = await withTestServer(t, {
    aiProviderConfig: { provider: "openai-compatible", model: "example-model" }
  });

  const response = await fetch(`${baseUrl}/api/ai/status`);
  assert.equal(response.status, 200);
  const status = await response.json();

  assert.equal(status.provider, "openai-compatible");
  assert.equal(status.configured, false);
  assert.equal(status.model, "example-model");
  assert.ok(!("apiKey" in status));
});

test("lists AI provider options without exposing the saved key", async (t) => {
  restoreAiEnv(t);
  const baseUrl = await withTestServer(t);

  const response = await fetch(`${baseUrl}/api/ai/settings`);
  assert.equal(response.status, 200);
  const settings = await response.json();

  assert.equal(settings.provider, "mock");
  assert.equal(settings.hasApiKey, false);
  assert.equal(settings.envKeyAvailable, false);
  assert.equal(settings.envKeyInUse, false);
  assert.deepEqual(settings.envKeyOptions, []);
  assert.ok(!("apiKey" in settings));
  assert.ok(Array.isArray(settings.providers));
  const keys = settings.providers.map((item) => item.key);
  assert.ok(keys.includes("deepseek"));
  assert.ok(keys.includes("anthropic"));
  assert.ok(keys.includes("gemini"));
  assert.ok(keys.includes("openai-compatible"));
  assert.ok(keys.includes("mock"));
  const deepseek = settings.providers.find((item) => item.key === "deepseek");
  assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(deepseek.model, "deepseek-v4-flash");
  // 每个选项附带说明，UI 可用于悬停提示或附加描述
  assert.ok(typeof deepseek.description === "string" && deepseek.description.length > 0);
  const openaiCompatible = settings.providers.find((item) => item.key === "openai-compatible");
  assert.match(openaiCompatible.description, /OpenAI Chat Completions/);
});

test("saves AI settings, persists to the env file, and reloads the provider", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  const baseUrl = await withTestServer(t, { envPath });

  const save = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "secret-key" })
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.provider, "deepseek");
  assert.equal(saved.configured, true);
  assert.equal(saved.model, "deepseek-v4-flash");
  assert.equal(saved.hasApiKey, true);

  const status = await (await fetch(`${baseUrl}/api/ai/status`)).json();
  assert.equal(status.provider, "deepseek");
  assert.equal(status.configured, true);

  const envText = await readFile(envPath, "utf8");
  assert.match(envText, /AI_PROVIDER=deepseek/);
  assert.match(envText, /AI_API_KEY=secret-key/);
  assert.match(envText, /AI_API_BASE=https:\/\/api\.deepseek\.com/);

  const backToMock = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock" })
  });
  assert.equal(backToMock.status, 200);
  const mockStatus = await (await fetch(`${baseUrl}/api/ai/status`)).json();
  assert.equal(mockStatus.provider, "mock");
  // 切回 Mock 只禁用真实接口，不删除已保存的 Key
  const mockEnv = await readFile(envPath, "utf8");
  assert.match(mockEnv, /AI_PROVIDER=mock/);
  assert.match(mockEnv, /AI_API_KEY=secret-key/);
});

test("keeps the saved API key when the submitted key is empty", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  const baseUrl = await withTestServer(t, { envPath });

  await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "keep-me" })
  });

  const save = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", model: "deepseek-chat", apiKey: "" })
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.model, "deepseek-chat");
  assert.equal(saved.hasApiKey, true);
  assert.match(await readFile(envPath, "utf8"), /AI_API_KEY=keep-me/);
});

test("uses the process env key as a session-only fallback without persisting it", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_KEY = "env-secret";
  const baseUrl = await withTestServer(t, { envPath });

  const settings = await (await fetch(`${baseUrl}/api/ai/settings`)).json();
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.envKeyAvailable, true);
  assert.equal(settings.envKeyInUse, true);
  assert.equal(settings.envKeyName, "AI_API_KEY");
  assert.deepEqual(settings.envKeyOptions, ["AI_API_KEY"]);
  assert.ok(!("apiKey" in settings));

  // 留空 Key 保存：环境变量 Key 继续生效，但不写入 .env
  const save = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "", model: "deepseek-chat" })
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.hasApiKey, true);
  const envText = await readFile(envPath, "utf8");
  assert.match(envText, /AI_PROVIDER=deepseek/);
  assert.doesNotMatch(envText, /AI_API_KEY=/);
});

test("recognizes common key env names such as DEEPSEEK_API_KEY", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "sk-alias-secret";
  const baseUrl = await withTestServer(t, { envPath });

  const settings = await (await fetch(`${baseUrl}/api/ai/settings`)).json();
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.envKeyAvailable, true);
  assert.equal(settings.envKeyInUse, true);
  assert.equal(settings.envKeyName, "DEEPSEEK_API_KEY");
  assert.ok(!("apiKey" in settings));
});

test("lets the user pick which env key to use for the current session", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "sk-deepseek";
  process.env.OPENAI_API_KEY = "sk-openai";
  const baseUrl = await withTestServer(t, { envPath });

  // 两个变量都可用，默认按 provider 用 deepseek 的 Key
  const settings = await (await fetch(`${baseUrl}/api/ai/settings`)).json();
  assert.equal(settings.envKeyName, "DEEPSEEK_API_KEY");
  assert.deepEqual(settings.envKeyOptions, ["OPENAI_API_KEY", "DEEPSEEK_API_KEY"]);

  // 用户显式选择 OPENAI_API_KEY：会话切到该 Key，且不写入 .env
  const save = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "deepseek",
      apiKey: "",
      model: "deepseek-chat",
      envKeyName: "OPENAI_API_KEY"
    })
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.hasApiKey, true);
  assert.doesNotMatch(await readFile(envPath, "utf8"), /AI_API_KEY=/);
});

test("rejects unknown AI providers when saving settings", async (t) => {
  restoreAiEnv(t);
  const baseUrl = await withTestServer(t);
  const response = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "not-a-provider", apiKey: "k" })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown AI provider/);
});

test("clears the saved API key when clearKey is requested", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  const baseUrl = await withTestServer(t, { envPath });

  await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "remove-me" })
  });

  const response = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", model: "deepseek-chat", clearKey: true })
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.hasApiKey, false);
  assert.match(await readFile(envPath, "utf8"), /AI_API_KEY=$/m);
});

test("strips control characters that could inject extra env keys", async (t) => {
  restoreAiEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const envPath = path.join(root, ".env");
  const baseUrl = await withTestServer(t, { envPath });

  const response = await fetch(`${baseUrl}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-ok\nAI_PROVIDER=anthropic", model: "m" })
  });
  assert.equal(response.status, 200);
  const envText = await readFile(envPath, "utf8");
  assert.match(envText, /AI_API_KEY=sk-okAI_PROVIDER=anthropic/);
  assert.ok(!/^AI_PROVIDER=anthropic$/m.test(envText), "不应注入新键");
});

test("blocks connection tests to loopback addresses for non-local providers", async (t) => {
  restoreAiEnv(t);
  const baseUrl = await withTestServer(t);
  const response = await fetch(`${baseUrl}/api/ai/settings/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "deepseek",
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9999/v1",
      model: "m"
    })
  });
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.match(result.message, /本机或内网/);
});

test("allows connection tests to the local Ollama endpoint", async (t) => {
  restoreAiEnv(t);
  let requestUrl;
  let allowPrivateHosts;
  const baseUrl = await withTestServer(t, {
    aiTestRequestImpl: async (uri, options) => {
      requestUrl = String(uri);
      allowPrivateHosts = options.allowPrivateHosts;
      return { status: 200, text: JSON.stringify({ models: [{ name: "llama3.1" }] }) };
    }
  });

  const response = await fetch(`${baseUrl}/api/ai/settings/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "ollama", model: "llama3.1" })
  });
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(requestUrl, "http://127.0.0.1:11434/api/tags");
  assert.equal(allowPrivateHosts, true);
});

test("tests provider connection with the submitted config", async (t) => {
  restoreAiEnv(t);
  let requestUrl;
  let requestHeaders;
  const baseUrl = await withTestServer(t, {
    aiTestRequestImpl: async (uri, options) => {
      requestUrl = String(uri);
      requestHeaders = options.headers;
      return { status: 200, text: JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }) };
    }
  });

  const response = await fetch(`${baseUrl}/api/ai/settings/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "k", model: "deepseek-v4-flash" })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(requestUrl, "https://api.deepseek.com/models");
  assert.equal(requestHeaders.authorization, "Bearer k");
});

test("tests connection for anthropic using native headers", async (t) => {
  restoreAiEnv(t);
  let requestUrl;
  let requestHeaders;
  const baseUrl = await withTestServer(t, {
    aiTestRequestImpl: async (uri, options) => {
      requestUrl = String(uri);
      requestHeaders = options.headers;
      return { status: 200, text: JSON.stringify({ data: [{ id: "claude-sonnet-4-20250514" }] }) };
    }
  });

  const response = await fetch(`${baseUrl}/api/ai/settings/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", apiKey: "k", model: "claude-test" })
  });
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(requestUrl, "https://api.anthropic.com/v1/models");
  assert.equal(requestHeaders["x-api-key"], "k");
  assert.equal(requestHeaders["anthropic-version"], "2023-06-01");
});

test("uploads a document and reads normalized blocks", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.html",
      contentBase64: Buffer.from("<h1>Title</h1><p>Body text</p>").toString("base64")
    })
  });

  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.ok(uploaded.id);
  assert.equal(uploaded.category, "未分类");

  const readResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  assert.equal(readResponse.status, 200);
  const document = await readResponse.json();

  assert.equal(document.title, "Title");
  assert.equal(document.formatVersion, 4);
  assert.deepEqual(
    document.blocks.map((block) => [block.type, block.text]),
    [
      ["heading", "Title"],
      ["paragraph", "Body text"]
    ]
  );

  const sourceResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}/source`);
  assert.equal(sourceResponse.status, 200);
  assert.match(sourceResponse.headers.get("content-type"), /text\/html/);
  assert.equal(await sourceResponse.text(), "<h1>Title</h1><p>Body text</p>");
});

test("does not expose source files outside the upload directory", async (t) => {
  let app;
  const baseUrl = await withTestServer(t, { onApp: (createdApp) => { app = createdApp; } });
  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "safe.txt",
      contentBase64: Buffer.from("safe source").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();
  app.locals.storage.db
    .prepare("UPDATE documents SET file_path = ? WHERE id = ?")
    .run(path.join(tmpdir(), "outside.txt"), uploaded.id);

  const response = await fetch(`${baseUrl}/api/documents/${uploaded.id}/source`);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /outside the upload directory/);
});

test("reparses documents created before the current formatting version", async (t) => {
  let app;
  const baseUrl = await withTestServer(t, { onApp: (createdApp) => { app = createdApp; } });
  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "legacy.html",
      contentBase64: Buffer.from("<h1>Fresh title</h1><p>Fresh body</p>").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();
  app.locals.storage.db
    .prepare("UPDATE documents SET title = 'Stale title', format_version = 3 WHERE id = ?")
    .run(uploaded.id);

  const response = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  const document = await response.json();

  assert.equal(response.status, 200);
  assert.equal(document.title, "Fresh title");
  assert.equal(document.formatVersion, 4);
});

test("rejects invalid base64 and mismatched binary file signatures", async (t) => {
  const baseUrl = await withTestServer(t);

  const missingName = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentBase64: "SGVsbG8=" })
  });
  assert.equal(missingName.status, 400);

  const invalidBase64 = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "article.txt", contentBase64: "not-base64!" })
  });
  assert.equal(invalidBase64.status, 400);

  const fakePdf = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.pdf",
      contentBase64: Buffer.from("plain text").toString("base64")
    })
  });
  assert.equal(fakePdf.status, 400);
  assert.match((await fakePdf.json()).error, /does not match the PDF extension/);
});

test("enforces per-file and batch upload limits", async (t) => {
  const baseUrl = await withTestServer(t, {
    uploadLimits: { maxFilesPerBatch: 2, maxFileBytes: 4, maxBatchBytes: 6 }
  });

  const oversized = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "large.txt",
      contentBase64: Buffer.from("12345").toString("base64")
    })
  });
  assert.equal(oversized.status, 413);

  const tooMany = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documents: ["a", "b", "c"].map((name) => ({
        name: `${name}.txt`,
        contentBase64: Buffer.from(name).toString("base64")
      }))
    })
  });
  assert.equal(tooMany.status, 413);
});

test("uploads multiple documents and lists them newest first", async (t) => {
  const baseUrl = await withTestServer(t);

  const batchResponse = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "Research",
      documents: [
        {
          name: "first.txt",
          contentBase64: Buffer.from("First article").toString("base64")
        },
        {
          name: "second.html",
          contentBase64: Buffer.from("<h1>Second</h1><p>Second article</p>").toString("base64")
        }
      ]
    })
  });

  assert.equal(batchResponse.status, 201);
  const batch = await batchResponse.json();
  assert.equal(batch.documents.length, 2);
  assert.deepEqual(batch.errors, []);
  assert.deepEqual(
    batch.documents.map((document) => document.category),
    ["Research", "Research"]
  );

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.deepEqual(
    list.documents.map((document) => document.title),
    ["Second", "first.txt"]
  );
  assert.deepEqual(
    list.documents.map((document) => document.category),
    ["Research", "Research"]
  );
});

test("creates and persists an empty named archive", async (t) => {
  const baseUrl = await withTestServer(t);

  const createResponse = await fetch(`${baseUrl}/api/archives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "待读论文" })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.name, "待读论文");
  assert.equal(created.documentCount, 0);

  const listResponse = await fetch(`${baseUrl}/api/archives`);
  assert.equal(listResponse.status, 200);
  const payload = await listResponse.json();
  assert.deepEqual(
    payload.archives.map((archive) => [archive.name, archive.documentCount]),
    [["待读论文", 0]]
  );
});

test("renames and deletes an empty archive", async (t) => {
  const baseUrl = await withTestServer(t);
  const createResponse = await fetch(`${baseUrl}/api/archives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "旧名称" })
  });
  const created = await createResponse.json();

  const renameResponse = await fetch(`${baseUrl}/api/archives/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "新名称" })
  });
  assert.equal(renameResponse.status, 200);
  assert.equal((await renameResponse.json()).name, "新名称");

  const deleteResponse = await fetch(`${baseUrl}/api/archives/${created.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual((await deleteResponse.json()).deleted, true);

  const archives = await (await fetch(`${baseUrl}/api/archives`)).json();
  assert.deepEqual(archives.archives, []);
});

test("does not delete an archive that still contains documents", async (t) => {
  const baseUrl = await withTestServer(t);
  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "kept.txt",
      category: "保留归档",
      contentBase64: Buffer.from("Keep me").toString("base64")
    })
  });
  assert.equal(uploadResponse.status, 201);
  const archives = await (await fetch(`${baseUrl}/api/archives`)).json();

  const deleteResponse = await fetch(
    `${baseUrl}/api/archives/${archives.archives[0].id}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 409);
});

test("batch archives selected documents into a category", async (t) => {
  const baseUrl = await withTestServer(t);
  const uploadResponse = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documents: [
        { name: "one.txt", contentBase64: Buffer.from("One").toString("base64") },
        { name: "two.txt", contentBase64: Buffer.from("Two").toString("base64") },
        { name: "three.txt", contentBase64: Buffer.from("Three").toString("base64") }
      ]
    })
  });
  const uploaded = await uploadResponse.json();
  const ids = [uploaded.documents[0].id, uploaded.documents[2].id];

  const archiveResponse = await fetch(`${baseUrl}/api/documents/batch-category`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, category: "重点阅读" })
  });

  assert.equal(archiveResponse.status, 200);
  assert.deepEqual(await archiveResponse.json(), {
    updated: true,
    ids,
    category: "重点阅读",
    count: 2
  });

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  const list = await listResponse.json();
  const categories = new Map(list.documents.map((document) => [document.id, document.category]));
  assert.equal(categories.get(ids[0]), "重点阅读");
  assert.equal(categories.get(ids[1]), "重点阅读");
  assert.equal(categories.get(uploaded.documents[1].id), "未分类");

  const archivesResponse = await fetch(`${baseUrl}/api/archives`);
  const archives = await archivesResponse.json();
  assert.deepEqual(
    archives.archives.map((archive) => [archive.name, archive.documentCount]),
    [["重点阅读", 2]]
  );
});

test("rejects batch archive without a category", async (t) => {
  const baseUrl = await withTestServer(t);
  const response = await fetch(`${baseUrl}/api/documents/batch-category`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [1], category: "   " })
  });

  assert.equal(response.status, 400);
});

test("deletes a document, its ai history, blocks, and uploaded file", async (t) => {
  let root;
  let app;
  const baseUrl = await withTestServer(t, {
    onRoot(value) {
      root = value;
    },
    onApp(value) {
      app = value;
    }
  });

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "delete-me.txt",
      contentBase64: Buffer.from("Delete this article.").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      selection: { text: "Delete", blockIds: [uploaded.blocks[0].id] }
    })
  });

  const deleteResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);

  const readResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  assert.equal(readResponse.status, 404);

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  const list = await listResponse.json();
  assert.deepEqual(list.documents, []);
  assert.deepEqual(await readdir(path.join(root, "uploads")), []);
  assert.equal(
    app.locals.storage.db.prepare("SELECT COUNT(*) AS count FROM blocks").get()
      .count,
    0
  );
  assert.equal(
    app.locals.storage.db
      .prepare("SELECT COUNT(*) AS count FROM ai_records")
      .get().count,
    0
  );
});

test("batch deletes documents, their ai history, blocks, and uploaded files", async (t) => {
  let root;
  let app;
  const baseUrl = await withTestServer(t, {
    onRoot(value) {
      root = value;
    },
    onApp(value) {
      app = value;
    }
  });

  const batchResponse = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "Batch",
      documents: [
        {
          name: "one.txt",
          contentBase64: Buffer.from("First article").toString("base64")
        },
        {
          name: "two.txt",
          contentBase64: Buffer.from("Second article").toString("base64")
        },
        {
          name: "three.txt",
          contentBase64: Buffer.from("Third article").toString("base64")
        }
      ]
    })
  });
  const batch = await batchResponse.json();
  const [first, second, third] = batch.documents;

  await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: first.id,
      selection: { text: "First", blockIds: [first.blocks[0].id] }
    })
  });

  const deleteResponse = await fetch(`${baseUrl}/api/documents/batch-delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [first.id, third.id] })
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), {
    deleted: true,
    ids: [first.id, third.id],
    count: 2
  });

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  const list = await listResponse.json();
  assert.deepEqual(
    list.documents.map((document) => document.id),
    [second.id]
  );
  assert.deepEqual(await readdir(path.join(root, "uploads")), [
    await path.basename(app.locals.storage.getDocument(second.id).filePath)
  ]);
  assert.equal(
    app.locals.storage.db.prepare("SELECT COUNT(*) AS count FROM documents").get()
      .count,
    1
  );
  assert.equal(
    app.locals.storage.db.prepare("SELECT COUNT(*) AS count FROM blocks").get()
      .count,
    1
  );
  assert.equal(
    app.locals.storage.db
      .prepare("SELECT COUNT(*) AS count FROM ai_records")
      .get().count,
    0
  );
});

test("explains a selection and persists ai history", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.txt",
      contentBase64: Buffer.from("Background block.\n\nCore concept block.\n\nConclusion block.", "utf8").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  const explainResponse = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      mode: "deep",
      selection: { text: "Core concept", blockIds: [2] }
    })
  });

  assert.equal(explainResponse.status, 200);
  const explanation = await explainResponse.json();
  assert.match(explanation.answer, /Core concept/);
  assert.equal(explanation.provider, "mock");

  const documentResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  const document = await documentResponse.json();
  assert.equal(document.aiRecords.length, 1);
  assert.equal(document.aiRecords[0].mode, "deep");
});

test("streams an AI answer and persists page-aware source context", async (t) => {
  const baseUrl = await withTestServer(t);
  const upload = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "stream.txt",
      contentBase64: Buffer.from("First source.\n\nSecond source.").toString("base64")
    })
  });
  const document = await upload.json();
  const response = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      documentId: document.id,
      mode: "direct",
      scope: "selection",
      selection: {
        text: "Second source",
        blockIds: [document.blocks[1].id],
        anchors: [{
          blockId: document.blocks[1].id,
          startOffset: 0,
          endOffset: 13
        }],
        pageIndex: 2
      }
    })
  });
  const deltas = [];
  const completed = await consumeEventStream(response, (event, payload) => {
    if (event === "delta") deltas.push(payload.delta);
  });

  assert.ok(deltas.length > 1);
  assert.match(completed.answer, /Second source/);
  assert.ok(Number.isInteger(completed.recordId));
  const refreshed = await (await fetch(`${baseUrl}/api/documents/${document.id}`)).json();
  assert.match(refreshed.aiRecords[0].context, /\[source:B\d+ position=2/);
  assert.equal(refreshed.aiRecords[0].scope, "selection");
  assert.equal(refreshed.aiRecords[0].contextSources[1].pageIndex, 2);
  assert.equal(refreshed.aiRecords[0].model, "mock");
  assert.equal(refreshed.aiRecords[0].promptVersion, "reader-v3");
  assert.equal(refreshed.aiRecords[0].selectionAnchors[0].startOffset, 0);
  assert.ok(refreshed.aiRecords[0].inputTokens > 0);
  assert.ok(refreshed.aiRecords[0].outputTokens > 0);
  assert.ok(refreshed.aiRecords[0].latencyMs > 0);
});

test("explains the current page when block ids are provided without a text selection", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.txt",
      contentBase64: Buffer.from("Page block one.\n\nPage block two.", "utf8").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  const explainResponse = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      mode: "direct",
      scope: "page",
      selection: {
        text: "",
        blockIds: uploaded.blocks.map((block) => block.id),
        pageIndex: 0
      }
    })
  });

  assert.equal(explainResponse.status, 200);
  const explanation = await explainResponse.json();
  assert.match(explanation.answer, /Page block one/);
  assert.equal(explanation.scope, "page");
});

test("answers a custom question with document context when no text is selected", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "photosynthesis.txt",
      contentBase64: Buffer.from(
        "The introduction is general.\n\n光合作用把光能转化为化学能。\n\nThe conclusion is brief.",
        "utf8"
      ).toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  const askResponse = await fetch(`${baseUrl}/api/ai/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      mode: "custom",
      question: "文章如何解释光合作用？"
    })
  });

  assert.equal(askResponse.status, 200);
  const answer = await askResponse.json();
  assert.match(answer.answer, /光合作用把光能转化为化学能/);
});

test("times out an unresponsive AI provider", async (t) => {
  const aiProvider = {
    name: "hanging-test-provider",
    async explain({ signal }) {
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  };
  const baseUrl = await withTestServer(t, {
    aiProvider,
    aiRequestTimeoutMs: 20
  });
  const upload = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "timeout.txt",
      contentBase64: Buffer.from("Timeout context").toString("base64")
    })
  });
  const document = await upload.json();

  const response = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      mode: "direct",
      selection: { text: "Timeout", blockIds: [1] }
    })
  });

  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: "AI provider request timed out" });
});

test("does not save an AI answer stopped by the output limit", async (t) => {
  const aiProvider = {
    name: "length-limited-provider",
    async explain() {
      return {
        answer: "这是没有结束的回答",
        finishReason: "length",
        provider: "length-limited-provider",
        model: "test"
      };
    }
  };
  let app;
  const baseUrl = await withTestServer(t, {
    aiProvider,
    onApp: (value) => { app = value; }
  });
  const upload = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "length.txt",
      contentBase64: Buffer.from("Length limited context").toString("base64")
    })
  });
  const document = await upload.json();

  const response = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      mode: "deep",
      selection: { text: "Length", blockIds: [document.blocks[0].id] }
    })
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "AI 回答达到长度上限，未完整生成，请重试。" });
  assert.equal(app.locals.storage.getDocument(document.id).aiRecords.length, 0);
});

test("persists reading annotations and saved AI answers and exports Markdown", async (t) => {
  const baseUrl = await withTestServer(t);
  const upload = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "notes.txt",
      contentBase64: Buffer.from("Important concept.\n\nSupporting evidence.").toString("base64")
    })
  });
  const document = await upload.json();

  const annotationResponse = await fetch(`${baseUrl}/api/annotations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      kind: "note",
      pageIndex: 0,
      selectedText: "Important concept",
      blockIds: [document.blocks[0].id],
      note: "Connect this to the introduction."
    })
  });
  assert.equal(annotationResponse.status, 201);
  const annotation = await annotationResponse.json();
  assert.equal(annotation.kind, "note");

  const bookmarkResponse = await fetch(`${baseUrl}/api/annotations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      kind: "bookmark",
      pageIndex: 0
    })
  });
  assert.equal(bookmarkResponse.status, 201);

  await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      mode: "deep",
      selection: { text: "Important concept", blockIds: [document.blocks[0].id] }
    })
  });
  let current = await (await fetch(`${baseUrl}/api/documents/${document.id}`)).json();
  assert.equal(current.annotations.length, 2);
  const record = current.aiRecords[0];

  const saveResponse = await fetch(`${baseUrl}/api/ai/records/${record.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      saved: true,
      title: "核心概念解析",
      note: "后续复习时重点查看。"
    })
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.saved, true);
  assert.equal(saved.savedTitle, "核心概念解析");

  const knowledge = await (await fetch(`${baseUrl}/api/knowledge`)).json();
  assert.equal(knowledge.items.length, 1);
  assert.equal(knowledge.items[0].documentTitle, "notes.txt");

  const exportResponse = await fetch(`${baseUrl}/api/export/markdown?documentId=${document.id}`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type"), /text\/markdown/);
  const markdown = await exportResponse.text();
  assert.match(markdown, /# notes\.txt/);
  assert.match(markdown, /Connect this to the introduction/);
  assert.match(markdown, /核心概念解析/);

  const updateResponse = await fetch(`${baseUrl}/api/annotations/${annotation.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: "Updated note." })
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).note, "Updated note.");

  const deleteResponse = await fetch(`${baseUrl}/api/annotations/${annotation.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);
  current = await (await fetch(`${baseUrl}/api/documents/${document.id}`)).json();
  assert.equal(current.annotations.length, 1);
});

test("backs up and restores documents and reading artifacts without secrets", async (t) => {
  const baseUrl = await withTestServer(t);
  const upload = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "backup.txt",
      category: "备份测试",
      contentBase64: Buffer.from("Backup body.").toString("base64")
    })
  });
  const document = await upload.json();

  await fetch(`${baseUrl}/api/annotations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      kind: "highlight",
      pageIndex: 0,
      selectedText: "Backup body",
      blockIds: [document.blocks[0].id]
    })
  });
  await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      selection: { text: "Backup body", blockIds: [document.blocks[0].id] }
    })
  });
  const withHistory = await (await fetch(`${baseUrl}/api/documents/${document.id}`)).json();
  await fetch(`${baseUrl}/api/ai/records/${withHistory.aiRecords[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ saved: true, title: "备份回答" })
  });

  const backupResponse = await fetch(`${baseUrl}/api/backup`);
  assert.equal(backupResponse.status, 200);
  const backup = await backupResponse.json();
  assert.equal(backup.format, "wenche-reader-backup");
  assert.equal(backup.version, 2);
  assert.equal(backup.documents.length, 1);
  assert.ok(backup.documents[0].originalFileBase64);
  assert.ok(!JSON.stringify(backup).includes("AI_API_KEY"));

  await fetch(`${baseUrl}/api/documents/${document.id}`, { method: "DELETE" });
  const restoreResponse = await fetch(`${baseUrl}/api/backup/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup)
  });
  assert.equal(restoreResponse.status, 200);
  assert.deepEqual(await restoreResponse.json(), { restored: true, documentCount: 1 });

  const documents = await (await fetch(`${baseUrl}/api/documents`)).json();
  assert.equal(documents.documents.length, 1);
  assert.equal(documents.documents[0].category, "备份测试");
  const restored = await (
    await fetch(`${baseUrl}/api/documents/${documents.documents[0].id}`)
  ).json();
  assert.equal(restored.annotations.length, 1);
  assert.equal(restored.aiRecords[0].saved, true);
  assert.equal(restored.aiRecords[0].savedTitle, "备份回答");
  assert.equal(restored.aiRecords[0].promptVersion, "reader-v3");
  assert.ok(restored.aiRecords[0].contextSources.length > 0);
});
