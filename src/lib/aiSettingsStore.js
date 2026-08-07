import { loadEnvFile, updateEnvFile } from "./env.js";

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
    await loadEnvFile(this.envPath);
    return {
      provider: String(process.env.AI_PROVIDER || "mock").trim().toLowerCase() || "mock",
      apiKey: process.env.AI_API_KEY || "",
      baseUrl: process.env.AI_API_BASE || "",
      model: process.env.AI_MODEL || ""
    };
  }

  async write(nextConfig) {
    const updates = {
      AI_PROVIDER: nextConfig.provider,
      AI_API_BASE: nextConfig.baseUrl || "",
      AI_MODEL: nextConfig.model || ""
    };
    if (nextConfig.apiKey || nextConfig.clearKey) {
      updates.AI_API_KEY = nextConfig.clearKey ? "" : nextConfig.apiKey;
    }
    await updateEnvFile(this.envPath, updates);
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }
    return {
      provider: updates.AI_PROVIDER,
      apiKey:
        updates.AI_API_KEY ?? process.env.AI_API_KEY ?? "",
      baseUrl: updates.AI_API_BASE,
      model: updates.AI_MODEL
    };
  }
}
