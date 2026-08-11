import assert from "node:assert/strict";
import test from "node:test";
import {
  envKeyInUse,
  mergeEnvAiConfig,
  readEnvAiConfig
} from "../desktop/envAiConfig.js";

test("readEnvAiConfig returns unavailable when no key env name is set", () => {
  assert.deepEqual(readEnvAiConfig({}), {
    available: false,
    config: null,
    keyEnvName: "",
    keyEnvOptions: []
  });
  assert.deepEqual(readEnvAiConfig({ AI_API_KEY: "   " }), {
    available: false,
    config: null,
    keyEnvName: "",
    keyEnvOptions: []
  });
});

test("readEnvAiConfig trims key and falls back to openai provider", () => {
  const result = readEnvAiConfig({ AI_API_KEY: "  sk-test  " });
  assert.equal(result.available, true);
  assert.deepEqual(result.config, {
    provider: "openai",
    apiKey: "sk-test",
    baseUrl: "",
    model: ""
  });
});

test("readEnvAiConfig keeps a known provider and rejects unknown providers", () => {
  const known = readEnvAiConfig({
    AI_API_KEY: "k",
    AI_PROVIDER: " deepseek ",
    AI_API_BASE: "https://api.deepseek.com",
    AI_MODEL: "deepseek-v4-flash"
  });
  assert.equal(known.config.provider, "deepseek");
  assert.equal(known.config.baseUrl, "https://api.deepseek.com");

  const unknown = readEnvAiConfig({
    AI_API_KEY: "k",
    AI_PROVIDER: "not-a-provider"
  });
  assert.equal(unknown.config.provider, "openai");
});

test("readEnvAiConfig falls back to the provider's common key env name", () => {
  const result = readEnvAiConfig({
    AI_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "sk-deepseek",
    OPENAI_API_KEY: "sk-openai"
  });
  assert.equal(result.available, true);
  assert.equal(result.config.provider, "deepseek");
  assert.equal(result.config.apiKey, "sk-deepseek");
  assert.equal(result.keyEnvName, "DEEPSEEK_API_KEY");
});

test("readEnvAiConfig defaults to openai and prefers OPENAI_API_KEY in fallback", () => {
  const result = readEnvAiConfig({
    DEEPSEEK_API_KEY: "sk-deepseek",
    OPENAI_API_KEY: "sk-openai"
  });
  assert.equal(result.available, true);
  assert.equal(result.config.provider, "openai");
  assert.equal(result.config.apiKey, "sk-openai");
  assert.equal(result.keyEnvName, "OPENAI_API_KEY");
});

test("readEnvAiConfig prefers explicit AI_API_KEY over aliases", () => {
  const result = readEnvAiConfig({
    AI_API_KEY: "sk-explicit",
    DEEPSEEK_API_KEY: "sk-deepseek"
  });
  assert.equal(result.config.apiKey, "sk-explicit");
  assert.equal(result.keyEnvName, "AI_API_KEY");
});

test("readEnvAiConfig uses the user-picked key env name", () => {
  const result = readEnvAiConfig(
    {
      DEEPSEEK_API_KEY: "sk-deepseek",
      OPENAI_API_KEY: "sk-openai"
    },
    "deepseek",
    "OPENAI_API_KEY"
  );
  assert.equal(result.available, true);
  assert.equal(result.config.provider, "deepseek");
  assert.equal(result.config.apiKey, "sk-openai");
  assert.equal(result.keyEnvName, "OPENAI_API_KEY");
});

test("readEnvAiConfig lists all available key env names", () => {
  const result = readEnvAiConfig({
    AI_API_KEY: "sk-explicit",
    DEEPSEEK_API_KEY: "sk-deepseek"
  });
  assert.deepEqual(result.keyEnvOptions, ["AI_API_KEY", "DEEPSEEK_API_KEY"]);
  // 显式 AI_API_KEY 始终优先
  assert.equal(result.config.apiKey, "sk-explicit");
});

test("readEnvAiConfig uses the env provider when the saved provider is mock", () => {
  const result = readEnvAiConfig(
    {
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-openai"
    },
    "mock",
    ""
  );
  assert.equal(result.available, true);
  assert.equal(result.config.provider, "openai");
  assert.equal(result.config.apiKey, "sk-openai");
});

test("readEnvAiConfig matches the key alias by preferred provider", () => {
  const result = readEnvAiConfig(
    {
      DEEPSEEK_API_KEY: "sk-deepseek",
      OPENAI_API_KEY: "sk-openai"
    },
    "deepseek"
  );
  assert.equal(result.available, true);
  assert.equal(result.config.provider, "deepseek");
  assert.equal(result.config.apiKey, "sk-deepseek");
  assert.equal(result.keyEnvName, "DEEPSEEK_API_KEY");
});

test("readEnvAiConfig strips control characters", () => {
  const result = readEnvAiConfig({
    AI_API_KEY: "sk-a\nb",
    AI_MODEL: "m\r\n1"
  });
  assert.equal(result.config.apiKey, "sk-ab");
  assert.equal(result.config.model, "m1");
});

test("mergeEnvAiConfig keeps saved config when it has a key", () => {
  const saved = {
    provider: "deepseek",
    apiKey: "saved-key",
    baseUrl: "https://example.com",
    model: "custom-model"
  };
  const env = readEnvAiConfig({ AI_API_KEY: "env-key" });
  assert.deepEqual(mergeEnvAiConfig(saved, env), saved);
});

test("mergeEnvAiConfig uses env key as fallback but keeps saved provider/base/model", () => {
  const saved = {
    provider: "deepseek",
    apiKey: "",
    baseUrl: "https://example.com",
    model: "custom-model"
  };
  const env = readEnvAiConfig({ AI_API_KEY: "env-key" });
  assert.deepEqual(mergeEnvAiConfig(saved, env), {
    provider: "deepseek",
    apiKey: "env-key",
    baseUrl: "https://example.com",
    model: "custom-model"
  });
});

test("mergeEnvAiConfig adopts the whole env config when nothing is saved", () => {
  const saved = { provider: "mock", apiKey: "", baseUrl: "", model: "" };
  const env = readEnvAiConfig({
    AI_API_KEY: "env-key",
    AI_PROVIDER: "kimi",
    AI_API_BASE: "https://api.moonshot.cn/v1",
    AI_MODEL: "moonshot-v1-8k"
  });
  assert.deepEqual(mergeEnvAiConfig(saved, env), env.config);
});

test("mergeEnvAiConfig returns saved config when env is unavailable", () => {
  const saved = { provider: "mock", apiKey: "", baseUrl: "", model: "" };
  assert.deepEqual(mergeEnvAiConfig(saved, { available: false, config: null }), saved);
});

test("envKeyInUse is only true when env is available and no saved key exists", () => {
  const env = { available: true, config: { apiKey: "k" } };
  assert.equal(envKeyInUse({ apiKey: "" }, env), true);
  assert.equal(envKeyInUse({ apiKey: "saved" }, env), false);
  assert.equal(envKeyInUse({ apiKey: "" }, { available: false, config: null }), false);
});
