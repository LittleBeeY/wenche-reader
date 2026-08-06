import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEnvFile, parseEnv, updateEnvFile } from "../src/lib/env.js";

test("parses simple env files with comments and quoted values", () => {
  const parsed = parseEnv(`
    # comment
    AI_PROVIDER=openai-compatible
    AI_MODEL="gpt-4.1-mini"
    EMPTY=
  `);

  assert.deepEqual(parsed, {
    AI_PROVIDER: "openai-compatible",
    AI_MODEL: "gpt-4.1-mini",
    EMPTY: ""
  });
});

test("strips utf8 bom from the first env key", () => {
  const parsed = parseEnv("\uFEFFAI_PROVIDER=openai-compatible\nAI_MODEL=deepseek-v4-flash\n");

  assert.deepEqual(parsed, {
    AI_PROVIDER: "openai-compatible",
    AI_MODEL: "deepseek-v4-flash"
  });
});

test("loads env file without overriding existing process env by default", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-env-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.AI_READER_TEST_VALUE;
  });

  const envPath = path.join(root, ".env");
  await writeFile(envPath, "AI_READER_TEST_VALUE=from_file\n", "utf8");
  process.env.AI_READER_TEST_VALUE = "from_process";

  const loaded = await loadEnvFile(envPath);

  assert.equal(loaded.AI_READER_TEST_VALUE, "from_file");
  assert.equal(process.env.AI_READER_TEST_VALUE, "from_process");
});

test("updates env file keys while preserving comments, order, and unrelated keys", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-env-"));
  const envPath = path.join(root, ".env");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(
    envPath,
    "# project config\nAI_PROVIDER=mock\nPORT=3000\nHOST=127.0.0.1\n\n",
    "utf8"
  );
  await updateEnvFile(envPath, { AI_PROVIDER: "deepseek", AI_API_KEY: "k1", PORT: "3127" });

  assert.equal(
    await readFile(envPath, "utf8"),
    "# project config\nAI_PROVIDER=deepseek\nPORT=3127\nHOST=127.0.0.1\nAI_API_KEY=k1\n"
  );
  assert.deepEqual(parseEnv(await readFile(envPath, "utf8")), {
    AI_PROVIDER: "deepseek",
    PORT: "3127",
    HOST: "127.0.0.1",
    AI_API_KEY: "k1"
  });
});

test("creates an env file from scratch when it does not exist", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-env-"));
  const envPath = path.join(root, ".env");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await updateEnvFile(envPath, { AI_PROVIDER: "anthropic", AI_API_KEY: "k" });

  assert.equal(await readFile(envPath, "utf8"), "AI_PROVIDER=anthropic\nAI_API_KEY=k\n");
});

test("strips a utf8 bom from the first env line when updating", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-env-"));
  const envPath = path.join(root, ".env");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(envPath, "\uFEFFAI_PROVIDER=mock\n", "utf8");
  await updateEnvFile(envPath, { AI_PROVIDER: "gemini" });

  assert.equal(await readFile(envPath, "utf8"), "AI_PROVIDER=gemini\n");
});

test("keeps crlf line endings when updating an env file", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-env-"));
  const envPath = path.join(root, ".env");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(envPath, "AI_PROVIDER=mock\r\nPORT=3000\r\n", "utf8");
  await updateEnvFile(envPath, { AI_PROVIDER: "deepseek", AI_API_KEY: "k" });

  const text = await readFile(envPath, "utf8");
  assert.ok(text.includes("\r\n"));
  assert.match(text, /AI_PROVIDER=deepseek\r\n/);
  assert.match(text, /AI_API_KEY=k\r\n/);
  assert.ok(!text.includes("\nAI_PROVIDER"), "不应混入 LF 行尾");
});
