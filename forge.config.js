import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { existsSync, readFileSync } from "node:fs";
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
// 方案：从顶层 package.json 的 dependencies 出发，BFS 遍历实际安装的
// node_modules 中每个包的 package.json 的 dependencies 字段构建依赖闭包。
// 不依赖 lockfile 的 dev 标记（npm 会在同时被 prod/dev 引用的包上误标 dev: true，
// 例如 express 的传递依赖 negotiator/iconv-lite），也不依赖 npm ls 子进程。
function productionDeps() {
  const rootPkg = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8")
  );
  const nodeModulesRoot = path.join(projectRoot, "node_modules");
  const deps = new Set();
  const queue = Object.keys(rootPkg.dependencies || {});

  for (const name of queue) deps.add(name);

  while (queue.length > 0) {
    const name = queue.shift();
    // 只读顶层平铺目录（npm 默认 hoist）；嵌套包由父包整个目录树保留。
    const pkgJsonPath = path.join(nodeModulesRoot, name, "package.json");
    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    } catch {
      // 顶层缺失（嵌套在别处）时跳过，不影响闭包正确性。
      continue;
    }
    for (const dep of Object.keys(pkgJson.dependencies || {})) {
      if (!deps.has(dep)) {
        deps.add(dep);
        queue.push(dep);
      }
    }
  }

  console.error(`[forge] production deps (BFS node_modules): ${deps.size}`);
  return deps;
}

const PRODUCTION_DEPS = productionDeps();

export default {
  outDir: process.env.WENCHE_FORGE_OUT || "out",
  packagerConfig: {
    asar: true,
    // packager 的 prune（galactus）会用 npm 解析器重算生产依赖闭包，可能误删
    // mammoth 的 @xmldom/xmldom 等实际运行必需的传递依赖。关闭 prune，完全
    // 由下方函数式 ignore 白名单精确控制 asar 内容（见 productionDeps）。
    prune: false,
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
        // scoped 包的 scope 目录本身（如 /node_modules/@xmldom）不含包，必须放行，
        // 让 packager 继续遍历到具体包目录（/node_modules/@xmldom/xmldom）再做白名单判断；
        // 否则整个 scope 目录会被当作未知包名忽略，其下所有包（如 @xmldom/xmldom）全部丢失。
        if (/^\/node_modules\/@[^/]+$/.test(file)) return false;
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
