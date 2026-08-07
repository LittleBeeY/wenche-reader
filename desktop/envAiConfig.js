/**
 * 桌面版环境变量 AI 配置（仅当前会话）：
 * - 启动进程环境中的 AI_API_KEY 作为「未保存 Key」的只读回退；
 * - 绝不写回 .env、settings.json、secrets 或日志；
 * - renderer 只能通过 IPC 得知「可用 / 正在使用」，拿不到 Key 本身。
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

export function readEnvAiConfig(env = process.env) {
  const apiKey = sanitize(env.AI_API_KEY);
  if (!apiKey) return { available: false, config: null };
  const rawProvider = sanitize(env.AI_PROVIDER).toLowerCase();
  const provider = VALID_ENV_PROVIDERS.has(rawProvider) ? rawProvider : "openai";
  return {
    available: true,
    config: {
      provider,
      apiKey,
      baseUrl: sanitize(env.AI_API_BASE),
      model: sanitize(env.AI_MODEL)
    }
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
