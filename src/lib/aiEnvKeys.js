/**
 * AI Key 环境变量名的常见别名解析（Web 与桌面版共用）。
 *
 * 项目标准变量名是 AI_API_KEY；为了让用户已有的本机环境变量直接生效，
 * 在 AI_API_KEY 缺失时按以下顺序回退：
 *   1. AI_API_KEY（显式设置永远优先）；
 *   2. 当前 provider 对应的常见官方变量名（例如 DEEPSEEK_API_KEY）；
 *   3. 未指定 provider 或别名未命中时，按常见程度兜底。
 *
 * 只读取环境变量，不落盘、不回显 Key 本身；返回来源变量名仅供 UI 提示。
 */

/** 各 provider 对应的常见官方环境变量名（按优先级排序）。 */
export const AI_KEY_ENV_ALIASES = Object.freeze({
  deepseek: ["DEEPSEEK_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-compatible": ["OPENAI_API_KEY"],
  kimi: ["MOONSHOT_API_KEY"],
  zhipu: ["ZHIPUAI_API_KEY"],
  qwen: ["DASHSCOPE_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  mock: [],
  ollama: []
});

/** provider 未知或对应别名未命中时的兜底顺序（常见程度优先）。 */
export const AI_KEY_ENV_FALLBACK_ORDER = Object.freeze([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MOONSHOT_API_KEY",
  "ZHIPUAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "GOOGLE_API_KEY"
]);

/** 剔除换行与控制字符，防止把环境变量里夹带的换行当作 Key 的一部分。 */
export function sanitizeEnvValue(value) {
  return String(value ?? "")
    .replace(/[\r\n\x00-\x1f\x7f]/g, "")
    .trim();
}

/** 全部已知 Key 变量名（含显式 AI_API_KEY、各 provider 别名与兜底顺序），用于白名单校验与下拉列表。 */
export const AI_KEY_ENV_NAMES = Object.freeze(
  [
    "AI_API_KEY",
    ...AI_KEY_ENV_FALLBACK_ORDER,
    ...Object.values(AI_KEY_ENV_ALIASES).flat()
  ].filter((name, index, array) => array.indexOf(name) === index)
);

/**
 * 解析 API Key 及其来源环境变量名。
 * @param {object} env 环境变量对象（默认 process.env）
 * @param {string} provider 当前 provider（小写），用于优先匹配对应别名
 * @param {string} preferredName 用户显式指定的环境变量名（可选）；仅接受已知白名单名，存在时优先使用
 * @returns {{ value: string, envName: string }}
 */
export function pickEnvApiKey(env = process.env, provider = "", preferredName = "") {
  if (preferredName && AI_KEY_ENV_NAMES.includes(preferredName)) {
    const explicitValue = sanitizeEnvValue(env[preferredName]);
    if (explicitValue) return { value: explicitValue, envName: preferredName };
  }
  const explicit = sanitizeEnvValue(env.AI_API_KEY);
  if (explicit) return { value: explicit, envName: "AI_API_KEY" };

  for (const name of AI_KEY_ENV_ALIASES[provider] || []) {
    const value = sanitizeEnvValue(env[name]);
    if (value) return { value, envName: name };
  }

  for (const name of AI_KEY_ENV_FALLBACK_ORDER) {
    const value = sanitizeEnvValue(env[name]);
    if (value) return { value, envName: name };
  }

  return { value: "", envName: "AI_API_KEY" };
}

/** 列出环境中当前可用的所有 Key 变量名（含显式 AI_API_KEY），供设置界面让用户选择。 */
export function listEnvApiKeys(env = process.env) {
  return AI_KEY_ENV_NAMES.filter(
    (name) => sanitizeEnvValue(env[name]) !== ""
  );
}
