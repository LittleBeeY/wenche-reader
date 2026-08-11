import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const iconPath = process.env.WENCHE_ICON_PATH || "assets/desktop/icon";

// 顶层要排除的目录/文件（相对项目根，以 / 开头，packager 会匹配规范化后的相对路径）。
const TOP_LEVEL_EXCLUDES = [
  /^\/\.git($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.agents($|\/)/,
  /^\/\.codex($|\/)/,
  /^\/\.workbuddy($|\/)/,
  /^\/test($|\/)/,
  /^\/e2e($|\/)/,
  /^\/docs($|\/)/,
  /^\/scripts($|\/)/,
  /^\/test-results($|\/)/,
  /^\/playwright-report($|\/)/,
  /^\/out($|\/)/,
  /^\/release($|\/)/,
  /^\/data($|\/)/,
  /^\/uploads($|\/)/,
  /^\/\.env($|\/)/,
  /^\/\.env\.example$/,
  /^\/\.gitignore($|\/)/,
  /^\/\.npmrc($|\/)/,
  /^\/\.editorconfig($|\/)/,
  /^\/CHANGELOG\.md$/,
  /^\/CONTRIBUTING\.md$/,
  /^\/CODE_OF_CONDUCT\.md$/,
  /^\/SECURITY\.md$/
];

// 生产依赖白名单：仅打包 production dependencies 及其传递依赖，
// 排除 devDependencies（electron、playwright、forge 等），避免 app.asar 膨胀。
// 方案：解析 package-lock.json 的 packages 字段。lockfile v3 中每个包都有 dev: true
// 标记，不依赖子进程，比 npm ls 更可靠（不受 cwd/stdio/环境 影响）。
function productionDeps() {
  try {
    const lockPath = path.join(projectRoot, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const packages = lock.packages || {};
    const deps = new Set();

    for (const [pkgPath, info] of Object.entries(packages)) {
      // 跳过根包
      if (!pkgPath || pkgPath === "") continue;
      // 跳过 dev-only 包（lockfile v3 的 dev 标记）
      if (info.dev) continue;
      // 提取包名：最后一个 "node_modules/" 之后的部分
      const segments = pkgPath.split("node_modules/");
      const pkgName = segments[segments.length - 1];
      if (pkgName) deps.add(pkgName);
    }

    console.error(`[forge] production deps (lockfile): ${deps.size}`);
    return deps;
  } catch (error) {
    // lockfile 解析失败时回退到顶层 dependencies
    console.error(`[forge] lockfile parse failed, using top-level deps fallback: ${error.message}`);
    return new Set(
      Object.keys(
        JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"))
          .dependencies || {}
      )
    );
  }
}

const PRODUCTION_DEPS = productionDeps();

export default {
  outDir: process.env.WENCHE_FORGE_OUT || "out",
  packagerConfig: {
    asar: true,
    name: "WencheReader",
    executableName: "WencheReader",
    win32metadata: {
      ProductName: "文澈阅读",
      FileDescription: "文澈阅读：本地优先的 AI 深度阅读器"
    },
    icon: iconPath,
    out: process.env.WENCHE_FORGE_OUT || "out",
    // 函数式 ignore：返回 true 表示忽略（不打包）。
    ignore: (file) => {
      if (TOP_LEVEL_EXCLUDES.some((regex) => regex.test(file))) return true;
      // 仅保留生产依赖白名单内的 node_modules 包；其余（devDependencies 及传递依赖）全部排除。
      const nodeModulesMatch = file.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
      if (nodeModulesMatch) {
        if (!PRODUCTION_DEPS.has(nodeModulesMatch[1])) return true;
        // 排除生产包自带的测试/文档目录，进一步瘦身。
        if (/(^|\/)(test|tests|test-data|__tests__|benchmark|benchmarks)(\/|$)/.test(file)) {
          return true;
        }
      }
      return false;
    }
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "wenche_reader",
        title: "文澈阅读",
        setupExe: "WencheReader-Setup.exe",
        setupIcon: `${iconPath}.ico`,
        // 正式发布必须设置 WENCHE_ICON_URL 为公开 HTTPS 的品牌图标地址；
        // 本地/CI 构建使用 Electron 官方图标占位，保证 Squirrel 可打包。
        iconUrl:
          process.env.WENCHE_ICON_URL ||
          "https://raw.githubusercontent.com/electron/electron/main/shell/browser/resources/win/electron.ico",
        authors: "LittleBeeY",
        description: "文澈阅读：本地优先的 AI 深度阅读器"
      }
    }
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};
