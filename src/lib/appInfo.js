import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 从应用包/仓库中 package.json 读取版本，Electron 与 CLI 共同使用。
const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../package.json"
);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

export const APP_INFO = Object.freeze({
  name: "文澈阅读",
  fullName: "文澈AI深度阅读系统",
  version: packageJson.version
});
