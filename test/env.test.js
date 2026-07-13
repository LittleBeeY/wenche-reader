import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEnvFile, parseEnv } from "../src/lib/env.js";

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
