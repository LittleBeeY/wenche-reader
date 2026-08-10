import asar from "@electron/asar";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);
const outRoot = path.resolve(
  projectRoot,
  process.env.WENCHE_FORGE_OUT || "out"
);
const unpackedDir = path.join(outRoot, "WencheReader-win32-x64");
const appAsar = path.join(unpackedDir, "resources", "app.asar");
const exePath = path.join(unpackedDir, "WencheReader.exe");
const squirrelDir = path.join(outRoot, "make", "squirrel.windows", "x64");

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  process.exit(1);
}
function ok(message) {
  console.log(`[smoke] ok: ${message}`);
}

if (!existsSync(exePath)) {
  fail(`missing packaged executable: ${exePath}`);
}
for (const name of [
  "WencheReader-Setup.exe",
  `wenche_reader-${packageJson.version}-full.nupkg`,
  "RELEASES"
]) {
  if (!existsSync(path.join(squirrelDir, name))) {
    fail(`missing Squirrel artifact: ${name}`);
  }
}
ok("Squirrel artifacts present");

if (!existsSync(appAsar)) fail(`missing app.asar: ${appAsar}`);
const asarFiles = asar.listPackage(appAsar).map((entry) => entry.replaceAll("\\", "/"));
const required = [
  "/desktop/main.js",
  "/desktop/backendWorker.js",
  "/desktop/protocol.js",
  "/desktop/preload.cjs",
  "/desktop/settingsRepository.js",
  "/desktop/updater.js",
  "/desktop/error.html",
  "/desktop/error.js",
  "/src/cli.js",
  "/src/runtime.js",
  "/src/server.js",
  "/src/lib/aiSettingsStore.js",
  "/public/index.html",
  "/package.json",
  "/LICENSE",
  "/node_modules/marked/lib/marked.umd.js",
  "/node_modules/dompurify/dist/purify.min.js",
  "/node_modules/jszip/dist/jszip.min.js",
  "/node_modules/docx-preview/dist/docx-preview.min.js"
];
for (const entry of required) {
  if (!asarFiles.includes(entry)) fail(`missing asar entry: ${entry}`);
}
ok("required asar entries present");

const forbiddenPrefixes = [
  "/test/",
  "/e2e/",
  "/docs/",
  "/scripts/",
  "/data/",
  "/uploads/",
  "/.env",
  "/.git",
  "/.github/",
  "/.agents/",
  "/.codex/",
  "/.workbuddy/",
  "/test-results/",
  "/playwright-report/",
  "/out/",
  "/CHANGELOG.md",
  "/CONTRIBUTING.md",
  "/CODE_OF_CONDUCT.md",
  "/SECURITY.md"
];
for (const prefix of forbiddenPrefixes) {
  const found = asarFiles.find((entry) => entry.startsWith(prefix));
  if (found) fail(`forbidden asar entry: ${found}`);
}
ok("asar manifest excludes dev and private content");

const asarPackage = JSON.parse(
  asar.extractFile(appAsar, "package.json").toString("utf8")
);
if (asarPackage.main !== "desktop/main.js") {
  fail(`asar package main is ${asarPackage.main}`);
}
if (asarPackage.version !== packageJson.version) {
  fail(`asar version ${asarPackage.version} != ${packageJson.version}`);
}
ok("asar package metadata matches");

const fusesBin = path.join(
  projectRoot,
  "node_modules",
  "@electron",
  "fuses",
  "dist",
  "bin.js"
);
const fuses = spawnSync(process.execPath, [fusesBin, "read", "--app", exePath], {
  encoding: "utf8"
});
if (fuses.status !== 0) fail(`electron-fuses read failed: ${fuses.stderr}`);
const fuseValues = {};
for (const line of String(fuses.stdout).split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s+is\s+(Enabled|Disabled)\s*$/);
  if (match) fuseValues[match[1]] = match[2] === "Enabled";
}
const expectedFuses = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true
};
for (const [key, value] of Object.entries(expectedFuses)) {
  if (fuseValues[key] !== value) {
    fail(`fuse ${key} is ${fuseValues[key]}, expected ${value}`);
  }
}
ok("fuses match the release contract");

const runAsNode = await new Promise((resolve) => {
  const isolatedRoot = mkdtempSync(path.join(tmpdir(), "wenche-runasnode-"));
  const child = spawn(exePath, ["-e", "console.log(1)"], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      LOCALAPPDATA: isolatedRoot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill(), 15000);
  child.on("exit", (code) => {
    clearTimeout(timer);
    rmSync(isolatedRoot, { recursive: true, force: true });
    resolve({ code, stderr });
  });
});
if (runAsNode.code === 0) {
  fail("RunAsNode is not disabled: executable ran as Node");
}
ok("RunAsNode disabled");

const versionInfo = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${exePath}').VersionInfo.FileVersion`
  ],
  { encoding: "utf8" }
);
const fileVersion = String(versionInfo.stdout || "").trim();
if (fileVersion !== packageJson.version) {
  fail(`executable FileVersion ${fileVersion} != ${packageJson.version}`);
}
ok(`executable FileVersion ${fileVersion}`);

const launchRoot = await mkdtemp(path.join(tmpdir(), "wenche-smoke-"));
const localAppData = path.join(launchRoot, "localappdata");
const ignoredOverride = path.join(launchRoot, "ignored");
try {
  const child = spawn(exePath, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData,
      WENCHE_DESKTOP_DATA_ROOT: ignoredOverride
    },
    stdio: "ignore"
  });
  const dataRoot = path.join(localAppData, "Wenche Reader");
  const dbPath = path.join(dataRoot, "data", "reader.sqlite");
  const settingsPath = path.join(dataRoot, "config", "settings.json");
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (
      existsSync(dbPath) &&
      existsSync(settingsPath) &&
      existsSync(path.join(dataRoot, "logs"))
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!existsSync(dbPath) || !existsSync(settingsPath)) {
    child.kill();
    fail("packaged app did not create the LocalAppData structure");
  }
  if (existsSync(ignoredOverride)) {
    child.kill();
    fail("packaged app honored WENCHE_DESKTOP_DATA_ROOT override");
  }
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  if ("apiKey" in settings || "api_key" in settings) {
    child.kill();
    fail("settings.json contains a key field");
  }
  if (existsSync(path.join(dataRoot, "secrets", "ai-key.bin"))) {
    child.kill();
    fail("unexpected ai-key.bin on first launch");
  }
  if (existsSync(path.join(dataRoot, ".env"))) {
    child.kill();
    fail(".env leaked into the data root");
  }
  const logDir = path.join(dataRoot, "logs");
  const logNames = await readdir(logDir);
  const startupLog = logNames.find((name) => /^desktop-\d{4}-\d{2}-\d{2}\.log$/.test(name));
  if (!startupLog) {
    child.kill();
    fail("desktop log was not created");
  }
  const logText = await readFile(path.join(logDir, startupLog), "utf8");
  if (!logText.includes(`starting ${packageJson.version}`)) {
    child.kill();
    fail("startup log does not report the app version");
  }
  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  ok("packaged app launched with the LocalAppData structure and version log");
} finally {
  await rm(launchRoot, { recursive: true, force: true }).catch(() => {});
}

console.log("[smoke] all packaged checks passed");
