import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AI_KEY_ENV_ALIASES,
  AI_KEY_ENV_FALLBACK_ORDER
} from "../src/lib/aiEnvKeys.js";
import { EnvAiSettingsStore } from "../src/lib/aiSettingsStore.js";

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
  const saved = Object.fromEntries(
    AI_ENV_KEYS.map((key) => [key, process.env[key]])
  );
  // 测试开始前清理全部 AI 环境变量，避免本机已有的别名变量（如 OPENAI_API_KEY）污染断言。
  for (const key of AI_ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const key of AI_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

async function makeEnvRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-ai-store-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("reads defaults when the env file is missing", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const store = new EnvAiSettingsStore({ envPath: path.join(root, ".env") });
  const config = await store.read();
  assert.equal(config.provider, "mock");
  assert.equal(config.apiKey, "");
  assert.equal(config.baseUrl, "");
  assert.equal(config.model, "");
});

test("writes full config and syncs process.env while preserving comments", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  await writeFile(envPath, "# keep me\nAI_PROVIDER=mock\n", "utf8");
  const store = new EnvAiSettingsStore({ envPath });

  const saved = await store.write({
    provider: "deepseek",
    apiKey: "sk-x",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });
  assert.equal(saved.provider, "deepseek");
  assert.equal(saved.apiKey, "sk-x");
  assert.equal(process.env.AI_API_KEY, "sk-x");

  const text = await readFile(envPath, "utf8");
  assert.match(text, /# keep me/);
  assert.match(text, /AI_PROVIDER=deepseek/);
  assert.match(text, /AI_API_KEY=sk-x/);
  assert.match(text, /AI_API_BASE=https:\/\/api\.deepseek\.com/);
});

test("blank key keeps the old key", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  const store = new EnvAiSettingsStore({ envPath });
  await store.write({
    provider: "deepseek",
    apiKey: "keep-me",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });

  const saved = await store.write({
    provider: "mock",
    apiKey: "",
    baseUrl: "",
    model: ""
  });
  assert.equal(saved.apiKey, "keep-me");
  assert.match(await readFile(envPath, "utf8"), /AI_API_KEY=keep-me/);
});

test("reports whether the key comes from the process env, not the env file", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  const store = new EnvAiSettingsStore({ envPath });

  // 无任何 Key：不可用、未使用
  let config = await store.read();
  assert.equal(config.envKeyAvailable, false);
  assert.equal(config.envKeyInUse, false);
  assert.deepEqual(config.envKeyOptions, []);

  // Key 持久化在 .env：可用，但不算环境变量来源
  await writeFile(envPath, "AI_API_KEY=from-file\n", "utf8");
  config = await store.read();
  assert.equal(config.envKeyAvailable, true);
  assert.equal(config.envKeyInUse, false);
  assert.equal(config.apiKey, "from-file");
  assert.deepEqual(config.envKeyOptions, ["AI_API_KEY"]);

  // 仅启动进程环境变量有 Key：视为环境变量来源（仅当前会话）
  await writeFile(envPath, "", "utf8");
  process.env.AI_API_KEY = "from-process-env";
  config = await store.read();
  assert.equal(config.envKeyAvailable, true);
  assert.equal(config.envKeyInUse, true);
  assert.equal(config.apiKey, "from-process-env");
  assert.deepEqual(config.envKeyOptions, ["AI_API_KEY"]);
});

test("reads keys from common env name aliases without persisting", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "sk-alias";
  const store = new EnvAiSettingsStore({ envPath });

  const config = await store.read();
  assert.equal(config.apiKey, "sk-alias");
  assert.equal(config.envKeyAvailable, true);
  assert.equal(config.envKeyInUse, true);
  assert.equal(config.envKeyName, "DEEPSEEK_API_KEY");
  assert.deepEqual(config.envKeyOptions, ["DEEPSEEK_API_KEY"]);
});

test("lists multiple available key env names for user selection", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "sk-deepseek";
  process.env.OPENAI_API_KEY = "sk-openai";
  const store = new EnvAiSettingsStore({ envPath });

  const config = await store.read();
  // 默认按 provider 匹配，但两个变量名都应出现在可选项里供用户选择
  assert.equal(config.apiKey, "sk-deepseek");
  assert.equal(config.envKeyName, "DEEPSEEK_API_KEY");
  assert.deepEqual(config.envKeyOptions, ["OPENAI_API_KEY", "DEEPSEEK_API_KEY"]);
});

test("persistKey=false applies the key to the session without writing the env file", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  const store = new EnvAiSettingsStore({ envPath });

  const saved = await store.write({
    provider: "deepseek",
    apiKey: "session-only-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    persistKey: false
  });
  assert.equal(saved.apiKey, "session-only-key");
  assert.equal(process.env.AI_API_KEY, "session-only-key");

  const text = await readFile(envPath, "utf8");
  assert.match(text, /AI_PROVIDER=deepseek/);
  assert.doesNotMatch(text, /AI_API_KEY=/);
});

test("session-scoped alias key keeps its source env name", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  const store = new EnvAiSettingsStore({ envPath });

  await store.write({
    provider: "deepseek",
    apiKey: "sk-alias-session",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    persistKey: false,
    envKeyName: "OPENAI_API_KEY"
  });
  // Key 写回其来源变量名，而不是提升为 AI_API_KEY
  assert.equal(process.env.OPENAI_API_KEY, "sk-alias-session");
  assert.ok(process.env.AI_API_KEY === undefined);

  // 后续 read 仍识别为 OPENAI_API_KEY 来源，不会变成 AI_API_KEY
  const config = await store.read();
  assert.equal(config.apiKey, "sk-alias-session");
  assert.equal(config.envKeyName, "OPENAI_API_KEY");
  assert.doesNotMatch(await readFile(envPath, "utf8"), /AI_API_KEY=/);
});

test("clearKey removes the key", async (t) => {
  restoreAiEnv(t);
  const root = await makeEnvRoot(t);
  const envPath = path.join(root, ".env");
  const store = new EnvAiSettingsStore({ envPath });
  await store.write({
    provider: "deepseek",
    apiKey: "remove-me",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });

  const saved = await store.write({
    provider: "deepseek",
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    clearKey: true
  });
  assert.equal(saved.apiKey, "");
  assert.match(await readFile(envPath, "utf8"), /AI_API_KEY=$/m);
});
