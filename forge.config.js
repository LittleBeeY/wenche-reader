import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

// 生产依赖白名单：仅打包 package.json dependencies 中声明的模块及其传递依赖，
// 排除 devDependencies（electron、playwright、forge 等），避免 app.asar 膨胀。
// @electron/packager 在 Windows 上 prune 不可靠，这里用函数式 ignore 显式白名单。
// 用 `npm ls --omit=dev --json` 计算生产依赖闭包（含 @napi-rs/canvas 等传递依赖），
// 只打包该闭包内的 node_modules 包，排除全部 devDependencies。
function productionDeps() {
  try {
    const output = execSync("npm ls --omit=dev --all --json", {
      cwd: new URL(".", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const tree = JSON.parse(output);
    const deps = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      for (const [name, child] of Object.entries(node.dependencies || {})) {
        deps.add(name);
        walk(child);
      }
    };
    walk(tree);
    return deps;
  } catch {
    // npm ls 失败时回退到顶层 dependencies，保证构建不中断。
    return new Set(
      Object.keys(
        JSON.parse(
          readFileSync(new URL("./package.json", import.meta.url), "utf8")
        ).dependencies || {}
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
