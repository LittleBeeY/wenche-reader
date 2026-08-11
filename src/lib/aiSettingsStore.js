import { loadEnvFile, updateEnvFile } from "./env.js";
import { listEnvApiKeys, pickEnvApiKey } from "./aiEnvKeys.js";

/**
 * AI 设置存储接口：
 * - read() 返回完整运行时配置 { provider, apiKey, baseUrl, model }；
 * - write() 接受服务端已校验/解析的完整配置，持久化成功后返回实际保存值；
 * - 空白 Key 表示保留旧 Key，clearKey=true 才会清除。
 */
export class EnvAiSettingsStore {
  constructor({ envPath }) {
    this.envPath = envPath;
  }

  async read() {
    // loadEnvFile 不会覆盖已存在的进程环境变量，返回值是 .env 文件本身的键值，
    // 用它区分「Key 来自 .env 持久化」还是「来自启动进程环境变量（仅当前会话）」。
    const envFileVars = await loadEnvFile(this.envPath);
    const provider = String(process.env.AI_PROVIDER || "mock").trim().toLowerCase() || "mock";
    // AI_API_KEY 缺失时自动识别 OPENAI_API_KEY / DEEPSEEK_API_KEY 等常见变量名，
    // 并按当前 provider 优先匹配（见 aiEnvKeys.js）。
    const key = pickEnvApiKey(process.env, provider);
    const apiKey = key.value;
    const envFileKey = envFileVars.AI_API_KEY || "";
    return {
      provider,
      apiKey,
      baseUrl: process.env.AI_API_BASE || "",
      model: process.env.AI_MODEL || "",
      envKeyAvailable: Boolean(apiKey),
      envKeyInUse: Boolean(apiKey) && apiKey !== envFileKey,
      envKeyName: key.envName,
      envKeyOptions: listEnvApiKeys(process.env)
    };
  }

  async write(nextConfig) {
    const updates = {
      AI_PROVIDER: nextConfig.provider,
      AI_API_BASE: nextConfig.baseUrl || "",
      AI_MODEL: nextConfig.model || ""
    };
    // persistKey=false 表示 Key 仅用于当前会话（例如来自环境变量的回退），
    // 只更新进程内值、不写入 .env；.env 中已有的 Key 保持不变。
    const persistKey = nextConfig.persistKey !== false;
    if (persistKey && (nextConfig.apiKey || nextConfig.clearKey)) {
      updates.AI_API_KEY = nextConfig.clearKey ? "" : nextConfig.apiKey;
    } else if (nextConfig.apiKey) {
      // 会话级 Key 回写到其来源变量名，避免把别名 Key 提升为 AI_API_KEY 而丢失来源名。
      const sourceName = nextConfig.envKeyName || "AI_API_KEY";
      process.env[sourceName] = nextConfig.apiKey;
      if (sourceName !== "AI_API_KEY") {
        // 显式选择别名时，旧的 AI_API_KEY 不再代表当前 Key，避免 read() 误判来源。
        delete process.env.AI_API_KEY;
      }
    }
    await updateEnvFile(this.envPath, updates);
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }
    return {
      provider: updates.AI_PROVIDER,
      apiKey:
        updates.AI_API_KEY !== undefined
          ? updates.AI_API_KEY
          : nextConfig.apiKey || process.env.AI_API_KEY || "",
      baseUrl: updates.AI_API_BASE,
      model: updates.AI_MODEL
    };
  }
}
