import { listEnvApiKeys, pickEnvApiKey } from "../src/lib/aiEnvKeys.js";

/**
 * 桌面版环境变量 AI 配置（仅当前会话）：
 * - 启动进程环境中的 AI_API_KEY 作为「未保存 Key」的只读回退；
 *   AI_API_KEY 缺失时自动识别 OPENAI_API_KEY / DEEPSEEK_API_KEY 等常见变量名
 *   （见 src/lib/aiEnvKeys.js 的别名与回退顺序）；
 * - 绝不写回 .env、settings.json、secrets 或日志；
 * - renderer 只能通过 IPC 得知「可用 / 正在使用 / 来源变量名」，拿不到 Key 本身。
 *
 * 允许的 provider 名单镜像 src/lib/aiProvider.js 的 PROVIDER_PRESETS 与
 * openai-compatible / mock；新增预设时需同步本文件与 scripts/config-ai.ps1。
 */
const VALID_ENV_PROVIDERS = new Set([
  "mock",
  "openai-compatible",
  "deepseek",
  "openai",
  "kimi",
  "zhipu",
  "qwen",
  "ollama",
  "anthropic",
  "gemini"
]);

/**
 * @param {object} env 环境变量对象（默认 process.env）
 * @param {string} preferredProvider 期望的 provider（如用户已保存的 provider），
 *   用于让 Key 来源与最终生效的 provider 匹配
 * @param {string} preferredKeyName 用户显式选择的环境变量名（可选），
 *   存在时优先读取该变量
 */
export function readEnvAiConfig(
  env = process.env,
  preferredProvider = "",
  preferredKeyName = ""
) {
  const rawProvider = sanitize(env.AI_PROVIDER).toLowerCase();
  const fallbackProvider = VALID_ENV_PROVIDERS.has(rawProvider)
    ? rawProvider
    : "openai";
  // 已保存 provider 为 mock（未配置）时不应覆盖环境变量的 provider，
  // 让 mergeEnvAiConfig 能整体采用环境变量配置。
  const provider =
    preferredProvider &&
    preferredProvider !== "mock" &&
    VALID_ENV_PROVIDERS.has(preferredProvider)
      ? preferredProvider
      : fallbackProvider;
  const key = pickEnvApiKey(env, provider, preferredKeyName);
  if (!key.value) {
    return { available: false, config: null, keyEnvName: "", keyEnvOptions: [] };
  }
  return {
    available: true,
    config: {
      provider,
      apiKey: key.value,
      baseUrl: sanitize(env.AI_API_BASE),
      model: sanitize(env.AI_MODEL)
    },
    keyEnvName: key.envName,
    keyEnvOptions: listEnvApiKeys(env)
  };
}

/**
 * 已保存配置优先；只有「Key 缺失」时才用环境变量补齐。
 * 未配置（provider 为空或 mock）时，环境变量的 provider/baseUrl/model 整体生效；
 * 已配置过 provider 的用户只借环境变量 Key，仍沿用自己保存的地址与模型。
 */
export function mergeEnvAiConfig(saved, envConfig) {
  const fallback = envConfig?.available ? envConfig.config : null;
  if (!fallback) return { ...saved };
  const useEnvProvider = !saved.provider || saved.provider === "mock";
  return {
    provider: useEnvProvider ? fallback.provider : saved.provider,
    apiKey: saved.apiKey || fallback.apiKey,
    baseUrl: useEnvProvider && !saved.baseUrl ? fallback.baseUrl : saved.baseUrl,
    model: useEnvProvider && !saved.model ? fallback.model : saved.model
  };
}

export function envKeyInUse(saved, envConfig) {
  return Boolean(envConfig?.available && !saved.apiKey);
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/[\r\n\x00-\x1f\x7f]/g, "")
    .trim();
}
