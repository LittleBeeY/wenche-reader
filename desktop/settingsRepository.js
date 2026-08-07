import { randomUUID } from "node:crypto";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  rm as fsRm,
  writeFile as fsWriteFile
} from "node:fs/promises";
import path from "node:path";

const SETTINGS_MAX_BYTES = 64 * 1024;
const defaultFs = Object.freeze({
  mkdir: fsMkdir,
  readFile: fsReadFile,
  rename: fsRename,
  rm: fsRm,
  writeFile: fsWriteFile
});

/**
 * 桌面版配置仓库（仅 main 进程使用）：
 * - config/settings.json 保存非敏感字段（provider/baseUrl/model/channel）；
 * - secrets/ai-key.bin 保存 safeStorage 加密后的原始 Buffer；
 * - 空白 Key 表示保留旧文件，clearKey=true 才删除密钥文件。
 */
export class DesktopSettingsRepository {
  constructor({ configDir, secretsDir, safeStorage, fs = defaultFs }) {
    this.configDir = configDir;
    this.secretsDir = secretsDir;
    this.safeStorage = safeStorage;
    this.fs = fs;
    this.snapshot = {
      provider: "mock",
      apiKey: "",
      baseUrl: "",
      model: "",
      channel: "stable"
    };
  }

  async read() {
    const settingsPath = path.join(this.configDir, "settings.json");
    let stored = null;
    let settingsError = "";
    let missing = false;
    try {
      const text = await this.fs.readFile(settingsPath, "utf8");
      if (Buffer.byteLength(text, "utf8") > SETTINGS_MAX_BYTES) {
        settingsError = "invalid-settings";
      } else {
        stored = JSON.parse(text);
      }
    } catch (error) {
      if (error.code === "ENOENT") missing = true;
      else settingsError = "invalid-settings";
    }

    const ai = stored?.ai && typeof stored.ai === "object" ? stored.ai : {};
    const updates =
      stored?.updates && typeof stored.updates === "object" ? stored.updates : {};
    const snapshot = {
      provider:
        String(ai.provider || "mock").trim().toLowerCase() || "mock",
      baseUrl: String(ai.baseUrl || ""),
      model: String(ai.model || ""),
      channel: updates.channel === "beta" ? "beta" : "stable",
      apiKey: "",
      keyUnavailable: false
    };

    let keyBytes = null;
    try {
      keyBytes = await this.fs.readFile(path.join(this.secretsDir, "ai-key.bin"));
    } catch (error) {
      if (error.code !== "ENOENT") snapshot.keyUnavailable = true;
    }
    if (keyBytes && keyBytes.length > 0) {
      try {
        snapshot.apiKey = await this.decrypt(keyBytes);
      } catch {
        snapshot.apiKey = "";
        snapshot.keyUnavailable = true;
      }
    }

    if (missing) {
      await writeAtomic(
        settingsPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            ai: {
              provider: snapshot.provider,
              baseUrl: snapshot.baseUrl,
              model: snapshot.model
            },
            updates: { channel: snapshot.channel }
          },
          null,
          2
        ) + "\n",
        this.fs
      );
    }

    this.snapshot = snapshot;
    return { ...snapshot, settingsError };
  }

  async write(nextConfig) {
    const before = await this.read();
    const settingsPath = path.join(this.configDir, "settings.json");
    let oldText = null;
    try {
      oldText = await this.fs.readFile(settingsPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const nextSettings = {
      schemaVersion: 1,
      ai: {
        provider: nextConfig.provider,
        baseUrl: nextConfig.baseUrl || "",
        model: nextConfig.model || ""
      },
      updates: { channel: before.channel || "stable" }
    };

    await writeAtomic(
      settingsPath,
      JSON.stringify(nextSettings, null, 2) + "\n",
      this.fs
    );

    let finalApiKey = before.apiKey || "";
    try {
      if (nextConfig.clearKey) {
        await this.fs.rm(path.join(this.secretsDir, "ai-key.bin"), {
          force: true
        });
        finalApiKey = "";
      } else if (nextConfig.apiKey) {
        if (
          typeof this.safeStorage.isEncryptionAvailable === "function" &&
          !this.safeStorage.isEncryptionAvailable()
        ) {
          throw new Error("encryption-unavailable");
        }
        const encrypted = await this.encrypt(nextConfig.apiKey);
        await writeAtomic(
          path.join(this.secretsDir, "ai-key.bin"),
          encrypted,
          this.fs
        );
        finalApiKey = nextConfig.apiKey;
      }
    } catch (error) {
      if (oldText !== null) {
        try {
          await writeAtomic(settingsPath, oldText, this.fs);
        } catch {}
      }
      throw error;
    }

    this.snapshot = {
      provider: nextConfig.provider,
      baseUrl: nextConfig.baseUrl || "",
      model: nextConfig.model || "",
      channel: before.channel || "stable",
      apiKey: finalApiKey,
      keyUnavailable: false
    };
    return { ...this.snapshot };
  }

  getPublicState() {
    return {
      provider: this.snapshot.provider,
      baseUrl: this.snapshot.baseUrl,
      model: this.snapshot.model,
      hasApiKey: Boolean(this.snapshot.apiKey)
    };
  }

  async encrypt(plainText) {
    if (typeof this.safeStorage.encryptStringAsync === "function") {
      return this.safeStorage.encryptStringAsync(plainText);
    }
    return this.safeStorage.encryptString(plainText);
  }

  async decrypt(buffer) {
    if (typeof this.safeStorage.decryptStringAsync === "function") {
      return this.safeStorage.decryptStringAsync(buffer);
    }
    return this.safeStorage.decryptString(buffer);
  }
}

async function writeAtomic(filePath, data, fs = defaultFs) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.tmp-${randomUUID()}`
  );
  try {
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}
