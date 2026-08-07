import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const iconPath = process.env.WENCHE_ICON_PATH || "assets/desktop/icon";

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
    ignore: [
      /^\/\.git/,
      /^\/\.github/,
      /^\/\.agents/,
      /^\/\.codex/,
      /^\/\.workbuddy/,
      /^\/test\//,
      /^\/e2e\//,
      /^\/docs\//,
      /^\/scripts\//,
      /^\/test-results\//,
      /^\/playwright-report\//,
      /^\/out\//,
      /^\/data\//,
      /^\/uploads\//,
      /^\/\.env/,
      /^\/CHANGELOG\.md$/,
      /^\/CONTRIBUTING\.md$/,
      /^\/CODE_OF_CONDUCT\.md$/,
      /^\/SECURITY\.md$/
    ]
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
