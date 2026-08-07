import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { EnvAiSettingsStore } from "../src/lib/aiSettingsStore.js";

const AI_ENV_KEYS = ["AI_PROVIDER", "AI_API_KEY", "AI_API_BASE", "AI_MODEL"];

function restoreAiEnv(t) {
  const saved = Object.fromEntries(
    AI_ENV_KEYS.map((key) => [key, process.env[key]])
  );
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
