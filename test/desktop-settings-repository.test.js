import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DesktopSettingsRepository } from "../desktop/settingsRepository.js";

function createSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad key");
      return text.slice(4);
    }
  };
}

async function makeRepository(t, fsOverride) {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-settings-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const repository = new DesktopSettingsRepository({
    configDir: path.join(root, "config"),
    secretsDir: path.join(root, "secrets"),
    safeStorage: createSafeStorage(),
    ...(fsOverride ? { fs: fsOverride } : {})
  });
  return { root, repository };
}

test("reads safe defaults on first launch without creating a key file", async (t) => {
  const { root, repository } = await makeRepository(t);
  const config = await repository.read();
  assert.equal(config.provider, "mock");
  assert.equal(config.apiKey, "");
  assert.equal(config.keyUnavailable, false);
  assert.equal(config.settingsError, "");
  await assert.rejects(readFile(path.join(root, "secrets", "ai-key.bin")));
  const settings = JSON.parse(
    await readFile(path.join(root, "config", "settings.json"), "utf8")
  );
  assert.equal(settings.ai.provider, "mock");
  assert.equal(settings.updates.channel, "stable");
});

test("persists public settings and an encrypted key separately", async (t) => {
  const { root, repository } = await makeRepository(t);
  const saved = await repository.write({
    provider: "deepseek",
    apiKey: "secret-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });
  assert.equal(saved.apiKey, "secret-key");
  assert.equal(repository.getPublicState().hasApiKey, true);

  const settings = JSON.parse(
    await readFile(path.join(root, "config", "settings.json"), "utf8")
  );
  assert.equal(settings.ai.provider, "deepseek");
  assert.equal(settings.ai.baseUrl, "https://api.deepseek.com");
  assert.equal(settings.ai.model, "deepseek-chat");
  assert.equal("apiKey" in settings, false);
  assert.equal("api_key" in settings.ai, false);

  const keyFile = await readFile(path.join(root, "secrets", "ai-key.bin"));
  assert.equal(keyFile.toString("utf8"), "enc:secret-key");
  const readBack = await repository.read();
  assert.equal(readBack.apiKey, "secret-key");
});

test("blank key keeps the old encrypted key", async (t) => {
  const { root, repository } = await makeRepository(t);
  await repository.write({
    provider: "deepseek",
    apiKey: "keep-me",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });
  const before = await readFile(path.join(root, "secrets", "ai-key.bin"));

  const saved = await repository.write({
    provider: "mock",
    apiKey: "",
    baseUrl: "",
    model: ""
  });
  assert.equal(saved.apiKey, "keep-me");
  const after = await readFile(path.join(root, "secrets", "ai-key.bin"));
  assert.deepEqual(after, before);
});

test("clearKey removes the encrypted key", async (t) => {
  const { root, repository } = await makeRepository(t);
  await repository.write({
    provider: "deepseek",
    apiKey: "remove-me",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });
  const saved = await repository.write({
    provider: "deepseek",
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    clearKey: true
  });
  assert.equal(saved.apiKey, "");
  assert.equal(repository.getPublicState().hasApiKey, false);
  await assert.rejects(readFile(path.join(root, "secrets", "ai-key.bin")));
});

test("decrypt failure preserves the file and reports keyUnavailable", async (t) => {
  const { root, repository } = await makeRepository(t);
  await repository.write({
    provider: "deepseek",
    apiKey: "old-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  });
  const keyPath = path.join(root, "secrets", "ai-key.bin");
  await writeFile(keyPath, "corrupted", "utf8");

  const config = await repository.read();
  assert.equal(config.apiKey, "");
  assert.equal(config.keyUnavailable, true);
  assert.equal(await readFile(keyPath, "utf8"), "corrupted");
});

test("invalid settings JSON falls back to safe defaults without overwriting", async (t) => {
  const { root, repository } = await makeRepository(t);
  const settingsPath = path.join(root, "config", "settings.json");
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(settingsPath, "{ not json", "utf8");
  const config = await repository.read();
  assert.equal(config.provider, "mock");
  assert.equal(config.settingsError, "invalid-settings");
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
});

test("key write failure restores the previous settings file", async (t) => {
  const realFs = await import("node:fs/promises");
  const fs = {
    ...realFs,
    rename: async (from, to) => {
      if (String(to).includes("ai-key.bin")) {
        throw new Error("key rename failed");
      }
      return realFs.rename(from, to);
    }
  };
  const { root, repository } = await makeRepository(t, fs);
  const settingsPath = path.join(root, "config", "settings.json");
  await repository.write({
    provider: "mock",
    apiKey: "",
    baseUrl: "",
    model: ""
  });
  const oldText = await readFile(settingsPath, "utf8");

  await assert.rejects(
    () =>
      repository.write({
        provider: "deepseek",
        apiKey: "new-key",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat"
      }),
    /key rename failed/
  );
  assert.equal(await readFile(settingsPath, "utf8"), oldText);
  assert.equal(repository.getPublicState().provider, "mock");
});
