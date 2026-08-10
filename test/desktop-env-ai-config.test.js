import assert from "node:assert/strict";
import test from "node:test";
import {
  envKeyInUse,
  mergeEnvAiConfig,
  readEnvAiConfig
} from "../desktop/envAiConfig.js";

test("readEnvAiConfig returns unavailable when AI_API_KEY is missing or blank", () => {
  assert.deepEqual(readEnvAiConfig({}), { available: false, config: null });
  assert.deepEqual(readEnvAiConfig({ AI_API_KEY: "   " }), {
    available: false,
    config: null
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
