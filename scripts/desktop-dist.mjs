import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 本地桌面版一键构建：最终产物统一落在 <项目根>/release/。
 *
 * 为什么需要暂存目录：electron-winstaller 的 rcedit 在 Windows 上无法处理
 * 非 ASCII 输出路径（本项目根目录是中文），直接在项目内输出会报
 * "Unable to load file"。因此先在系统临时目录（纯 ASCII）构建，
 * 成功后把安装器/更新包/RELEASES 回拷到项目 release/，再清理暂存目录。
 * CI 路径为 ASCII，继续直接使用 npm run desktop:make。
 */
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const releaseDir = path.join(projectRoot, "release");

function fail(message) {
  console.error(`[desktop:dist] ${message}`);
  process.exit(1);
}

function main() {
  const staging = mkdtempSync(path.join(tmpdir(), "wenche-desktop-dist-"));
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const build = spawnSync(npmCommand, ["run", "desktop:make"], {
    cwd: projectRoot,
    env: { ...process.env, WENCHE_FORGE_OUT: staging },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (build.status !== 0) {
    rmSync(staging, { recursive: true, force: true });
    fail(
      `desktop:make 失败（退出码 ${build.status ?? build.error?.message ?? "未知"}），已清理暂存目录。`
    );
  }

  const squirrelDir = path.join(
    staging,
    "make",
    "squirrel.windows",
    "x64"
  );
  const setupExe = path.join(squirrelDir, "WencheReader-Setup.exe");
  const nupkg = readdirSync(squirrelDir).find((name) =>
    /^wenche_reader-.*-full\.nupkg$/.test(name)
  );
  const releases = path.join(squirrelDir, "RELEASES");
  for (const [label, file] of [
    ["安装器", setupExe],
    ["更新包", nupkg ? path.join(squirrelDir, nupkg) : ""],
    ["RELEASES", releases]
  ]) {
    if (!file || !existsSync(file)) {
      rmSync(staging, { recursive: true, force: true });
      fail(`缺少构建产物：${label}`);
    }
  }

  mkdirSync(releaseDir, { recursive: true });
  copyFileSync(setupExe, path.join(releaseDir, "WencheReader-Setup.exe"));
  copyFileSync(
    path.join(squirrelDir, nupkg),
    path.join(releaseDir, nupkg)
  );
  copyFileSync(releases, path.join(releaseDir, "RELEASES"));
  rmSync(staging, { recursive: true, force: true });

  console.log("");
  console.log(`[desktop:dist] 构建完成，产物统一在：${releaseDir}`);
  console.log(`[desktop:dist]   WencheReader-Setup.exe`);
  console.log(`[desktop:dist]   ${nupkg}`);
  console.log(`[desktop:dist]   RELEASES`);
}

main();
