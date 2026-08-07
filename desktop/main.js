import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from "node:fs";
import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  utilityProcess
} from "electron";
import squirrelStartup from "electron-squirrel-startup";
import {
  installAppProtocol,
  registerAppScheme
} from "./protocol.js";
import {
  envKeyInUse,
  mergeEnvAiConfig,
  readEnvAiConfig
} from "./envAiConfig.js";
import { DesktopSettingsRepository } from "./settingsRepository.js";
import { createUpdater } from "./updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ID = "com.littlebeey.wenche.reader";
const PARTITION = "persist:wenche";
const WORKER_READY_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 5000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

if (squirrelStartup) app.quit();

registerAppScheme();

// 本地阅读器使用软件合成：部分 Windows/虚拟化环境的 GPU 子进程会因系统 DLL 缺失崩溃，
// 且阅读、PDF 文本提取、划词和 AI 流程都不依赖 GPU 加速。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("in-process-gpu");
// 本机/部分虚拟化环境的 Chromium 沙箱无法启动渲染进程（exit 49），
// 开发与自动化测试改用 --no-sandbox；打包版保留默认沙箱。
if (!app.isPackaged) {
  app.commandLine.appendSwitch("no-sandbox");
}

function resolveDataRoot() {
  if (!app.isPackaged && process.env.WENCHE_DESKTOP_DATA_ROOT) {
    const root = path.resolve(process.env.WENCHE_DESKTOP_DATA_ROOT);
    if (!path.isAbsolute(root)) throw new Error("invalid-data-root");
    return root;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData)) {
    throw new Error("localappdata-missing");
  }
  return path.join(localAppData, "Wenche Reader");
}

let dataRoot;
try {
  dataRoot = resolveDataRoot();
  mkdirSync(dataRoot, { recursive: true });
} catch (error) {
  dialog.showErrorBox("文澈阅读", "无法创建数据目录，应用将退出。");
  app.exit(1);
  throw error;
}

app.setPath("userData", dataRoot);
app.setPath("sessionData", path.join(dataRoot, "session"));
app.setAppUserModelId(APP_ID);

const dirs = {
  data: path.join(dataRoot, "data"),
  uploads: path.join(dataRoot, "uploads"),
  rssImages: path.join(dataRoot, "cache", "rss-images"),
  config: path.join(dataRoot, "config"),
  secrets: path.join(dataRoot, "secrets"),
  backups: path.join(dataRoot, "backups"),
  logs: path.join(dataRoot, "logs"),
  session: path.join(dataRoot, "session")
};
for (const dir of Object.values(dirs)) {
  mkdirSync(dir, { recursive: true });
}

let logger = () => {};
let mainWindow = null;
let desktopSession = null;
let worker = null;
let backendOrigin = null;
let backendReady = false;
let sessionToken = "";
let settingsRepository = null;
let updater = null;
let protocolUninstall = null;
let envAiConfig = null;
let envAiKeyInUse = false;
let envApplyPending = null;
let updatePending = false;
let quitInitiated = false;
let shutdownStarted = false;
let errorShown = false;
let shuttingDown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitInitiated) return;
    event.preventDefault();
    quitInitiated = true;
    void gracefulShutdown().finally(() => {
      if (updatePending && updater?.hasUpdate()) {
        updater.quitAndInstall();
      } else {
        app.quit();
      }
    });
  });

  void app.whenReady().then(initializeDesktop);
}

async function initializeDesktop() {
  logger = createLogger(dirs.logs);
  logger(
    "info",
    `starting ${app.getVersion()} electron=${process.versions.electron} node=${process.versions.node} chromium=${process.versions.chrome}`
  );
  settingsRepository = new DesktopSettingsRepository({
    configDir: dirs.config,
    secretsDir: dirs.secrets,
    safeStorage
  });
  app.on("render-process-gone", (_event, _contents, details) => {
    logger(
      "error",
      `renderer gone: reason=${details.reason} exit=${details.exitCode}`
    );
  });
  app.on("child-process-gone", (_event, details) => {
    logger(
      "error",
      `child gone: type=${details.type} reason=${details.reason} exit=${details.exitCode} service=${details.serviceName || ""}`
    );
  });
  desktopSession = session.fromPartition(PARTITION);
  configureSession(desktopSession);
  registerIpcHandlers();

  let statePath;
  try {
    statePath = await prepareVersionedDatabase();
  } catch (error) {
    logger("error", `database preparation failed: ${error.message}`);
    await showBackendError(error?.code || "database-preparation-failed");
    return;
  }

  sessionToken = randomBytes(32).toString("base64url");
  const settings = await settingsRepository.read();
  envAiConfig = readEnvAiConfig();
  envAiKeyInUse = envKeyInUse(settings, envAiConfig);
  if (settings.keyUnavailable) {
    logger("warn", "ai key unavailable; starting unconfigured");
  }

  worker = utilityProcess.fork(path.join(__dirname, "backendWorker.js"), [], {
    serviceName: "wenche-backend",
    stdio: "pipe"
  });
  worker.stdout?.on("data", (chunk) =>
    logger("worker", String(chunk).trim())
  );
  worker.stderr?.on("data", (chunk) =>
    logger("worker-error", String(chunk).trim())
  );
  worker.on("exit", (code) => {
    if (!shuttingDown && backendReady && !errorShown) {
      logger("error", `worker exited unexpectedly with code ${code}`);
      backendReady = false;
      void showBackendError("worker-exited");
    } else {
      logger("info", `worker exited with code ${code}`);
    }
  });
  worker.on("message", (message) => {
    void handleWorkerMessage(message, statePath);
  });

  worker.postMessage({
    type: "bootstrap",
    dataDir: dirs.data,
    uploadDir: dirs.uploads,
    rssImageCacheDir: dirs.rssImages,
    staticRoot: path.join(app.getAppPath(), "public"),
    desktopSessionToken: sessionToken,
    initialAiConfig: mergeEnvAiConfig(settings, envAiConfig)
  });

  setTimeout(() => {
    if (!backendReady && !errorShown) {
      void showBackendError("backend-timeout");
    }
  }, WORKER_READY_TIMEOUT_MS);
}

async function handleWorkerMessage(message, statePath) {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "backend-ready") {
    if (errorShown) {
      logger("warn", "backend became ready after error state; staying on error page");
      return;
    }
    backendOrigin = `http://${message.host || "127.0.0.1"}:${message.port}`;
    backendReady = true;
    if (protocolUninstall) {
      protocolUninstall();
      protocolUninstall = null;
    }
    protocolUninstall = await installAppProtocol({
      session: desktopSession,
      appRoot: app.getAppPath(),
      backendOrigin,
      sessionToken
    });
    createMainWindow("app://wenche/");
    initUpdater();
    void markSuccessfulStartup(statePath).catch((error) => {
      logger("warn", `startup health check failed: ${error.message}`);
    });
  } else if (message.type === "backend-start-error") {
    await showBackendError(message.code || "backend-start-error");
  } else if (message.type === "settings-write") {
    void persistAiSettings(message);
  } else if (message.type === "settings-applied") {
    if (envApplyPending) {
      const pending = envApplyPending;
      envApplyPending = null;
      envAiKeyInUse = true;
      pending.resolve(true);
    }
  }
}

async function showBackendError(code) {
  if (errorShown) return;
  errorShown = true;
  logger("fatal", `backend error: ${code}`);
  if (!protocolUninstall) {
    protocolUninstall = await installAppProtocol({
      session: desktopSession,
      appRoot: app.getAppPath(),
      backendOrigin: null,
      sessionToken
    });
  }
  const url = `app://wenche/desktop-error.html?code=${encodeURIComponent(code)}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(url).catch(() => {});
  } else {
    createMainWindow(url);
  }
}

function createMainWindow(url = "app://wenche/") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url).catch((error) => {
      logger("error", `navigation failed: ${error.message}`);
    });
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#e9efef",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      partition: PARTITION,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const external = parseExternalUrl(targetUrl);
    if (external) void shell.openExternal(external);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== "app:" || parsed.host !== "wenche") {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  mainWindow.loadURL(url).catch((error) => {
    logger("error", `load failed: ${error.message}`);
  });
  return mainWindow;
}

function configureSession(desktopSession) {
  desktopSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  desktopSession.setPermissionCheckHandler(() => false);
}

function registerIpcHandlers() {
  ipcMain.handle("wenche:get-runtime-info", (event) => {
    if (!isTrustedSender(event)) throw new Error("unauthorized");
    return {
      desktop: true,
      platform: process.platform,
      version: app.getVersion()
    };
  });
  ipcMain.handle("wenche:check-for-updates", (event) => {
    if (!isTrustedSender(event)) return { accepted: false };
    if (!updater) return { accepted: false };
    return updater.checkForUpdates().then((accepted) => ({ accepted }));
  });
  ipcMain.handle("wenche:restart-to-install-update", (event) => {
    if (!isTrustedSender(event)) return { accepted: false };
    if (!updater?.hasUpdate()) return { accepted: false };
    updatePending = true;
    app.quit();
    return { accepted: true };
  });
  ipcMain.handle("wenche:restart-app", (event) => {
    if (!isTrustedSender(event)) return { accepted: false };
    app.relaunch();
    app.exit(0);
    return { accepted: true };
  });
  ipcMain.handle("wenche:open-log-directory", async (event) => {
    if (!isTrustedSender(event)) return { accepted: false };
    const error = await shell.openPath(dirs.logs);
    return { accepted: error === "" };
  });
  ipcMain.handle("wenche:get-ai-env-state", (event) => {
    if (!isTrustedSender(event)) return { available: false, inUse: false };
    return {
      available: Boolean(envAiConfig?.available),
      inUse: envAiKeyInUse
    };
  });
  ipcMain.handle("wenche:apply-env-ai-config", (event) => {
    if (!isTrustedSender(event)) return { accepted: false };
    if (!envAiConfig?.available || envAiKeyInUse || !worker) {
      return { accepted: false };
    }
    return applyEnvAiConfig();
  });
  ipcMain.handle("wenche:uninstall-app", async (event) => {
    if (!isTrustedSender(event)) return { accepted: false };
    if (!app.isPackaged) return { accepted: false, error: "dev-mode" };
    const updateExe = resolveSquirrelUninstaller(process.execPath);
    if (!updateExe || !existsSync(updateExe)) {
      return { accepted: false, error: "update-exe-missing" };
    }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["取消", "卸载"],
      defaultId: 0,
      cancelId: 0,
      title: "卸载文澈阅读",
      message: "确定要卸载文澈阅读吗？",
      detail:
        "卸载将删除程序文件与开始菜单快捷方式。\n" +
        "你的阅读数据（文档、订阅、AI 记录等）保存在独立的本地数据目录中，不会被删除。"
    });
    if (choice.response !== 1) return { accepted: false, cancelled: true };
    const child = spawn(updateExe, ["--uninstall"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    setTimeout(() => app.quit(), 300);
    return { accepted: true };
  });
}

function applyEnvAiConfig() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      envApplyPending = null;
      resolve({ accepted: false, error: "timeout" });
    }, 3000);
    envApplyPending = {
      resolve: (ok) => {
        clearTimeout(timer);
        resolve({ accepted: ok });
      }
    };
    worker.postMessage({ type: "settings-apply", config: envAiConfig.config });
  });
}

async function persistAiSettings({ requestId, config }) {
  try {
    const saved = await settingsRepository.write({
      provider: String(config?.provider || "mock"),
      apiKey: String(config?.apiKey || ""),
      baseUrl: String(config?.baseUrl || ""),
      model: String(config?.model || ""),
      clearKey: config?.clearKey === true
    });
    envAiKeyInUse = envKeyInUse(saved, envAiConfig);
    worker.postMessage({
      type: "settings-write-result",
      requestId,
      ok: true,
      config: {
        provider: saved.provider,
        apiKey: saved.apiKey,
        baseUrl: saved.baseUrl,
        model: saved.model
      }
    });
  } catch (error) {
    logger("error", `ai settings write failed: ${error.code || error.message}`);
    worker.postMessage({
      type: "settings-write-result",
      requestId,
      ok: false,
      errorCode:
        error?.message === "encryption-unavailable"
          ? "encryption-unavailable"
          : "settings-write-failed"
    });
  }
}

function resolveSquirrelUninstaller(execPath) {
  // Squirrel 启动器 stub 与版本化 exe 都可能成为 process.execPath：
  // 兼容两者（...\wenche_reader\WencheReader.exe 与 ...\app-1.1.0\WencheReader.exe）。
  const candidates = [
    path.resolve(path.dirname(execPath), "Update.exe"),
    path.resolve(path.dirname(execPath), "..", "Update.exe")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function isTrustedSender(event) {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || mainWindow.isDestroyed()) return false;
  if (frame !== mainWindow.webContents.mainFrame) return false;
  try {
    const parsed = new URL(frame.url);
    return parsed.protocol === "app:" && parsed.host === "wenche";
  } catch {
    return false;
  }
}

function parseExternalUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function initUpdater() {
  updater = createUpdater({
    autoUpdater,
    app,
    feedUrl: process.env.WENCHE_UPDATE_BASE_URL || "",
    channel: settingsRepository?.snapshot?.channel || "stable",
    logger,
    notify: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("wenche:update-state", state);
      }
    }
  });
  updater.start();
}

async function gracefulShutdown() {
  if (!worker || shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  const completed = await new Promise((resolve) => {
    let timer = null;
    const onMessage = (message) => {
      if (message?.type === "shutdown-complete") {
        if (timer) clearTimeout(timer);
        worker.off("message", onMessage);
        resolve(true);
      }
    };
    worker.on("message", onMessage);
    worker.postMessage({ type: "shutdown-request" });
    timer = setTimeout(() => {
      worker.off("message", onMessage);
      resolve(false);
    }, SHUTDOWN_TIMEOUT_MS);
  });
  if (!completed) {
    logger("warn", "worker shutdown timed out; killing worker");
    worker.kill();
  }
}

async function prepareVersionedDatabase() {
  const dbPath = path.join(dirs.data, "reader.sqlite");
  const statePath = path.join(dirs.config, "runtime-state.json");
  let runtimeState = { schemaVersion: 1, lastSuccessfulAppVersion: "" };
  try {
    runtimeState = {
      schemaVersion: 1,
      ...JSON.parse(await readFile(statePath, "utf8"))
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger("warn", "runtime-state unreadable; using defaults");
    }
  }
  if (existsSync(dbPath)) {
    if (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)) {
      const error = new Error("sqlite journal files present");
      error.code = "sqlite-inconsistent-state";
      throw error;
    }
    if (runtimeState.lastSuccessfulAppVersion !== app.getVersion()) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const from = sanitizeVersionPart(
        runtimeState.lastSuccessfulAppVersion || "unknown"
      );
      const to = sanitizeVersionPart(app.getVersion());
      const backupName = `pre-upgrade-${from}-to-${to}-${stamp}.sqlite`;
      await copyFile(dbPath, path.join(dirs.backups, backupName));
      await prunePreUpgradeBackups();
      logger("info", `created pre-upgrade backup: ${backupName}`);
    }
  }
  return statePath;
}

async function prunePreUpgradeBackups() {
  let entries = [];
  try {
    entries = await readdir(dirs.backups);
  } catch {
    return;
  }
  const backupsRoot = path.resolve(dirs.backups);
  const backups = entries
    .filter((name) => /^pre-upgrade-.*\.sqlite$/.test(name))
    .sort()
    .reverse();
  for (const name of backups.slice(3)) {
    const filePath = path.resolve(dirs.backups, name);
    if (!filePath.startsWith(backupsRoot + path.sep)) continue;
    await rm(filePath, { force: true });
  }
}

async function markSuccessfulStartup(statePath) {
  const health = await fetch(`${backendOrigin}/api/health`, {
    headers: { "x-wenche-session": sessionToken }
  });
  if (!health.ok) throw new Error(`health ${health.status}`);
  await writeAtomic(
    statePath,
    JSON.stringify(
      { schemaVersion: 1, lastSuccessfulAppVersion: app.getVersion() },
      null,
      2
    ) + "\n"
  );
}

async function writeAtomic(filePath, data) {
  const tempPath = path.join(path.dirname(filePath), `.tmp-${randomUUID()}`);
  try {
    await writeFile(tempPath, data);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function sanitizeVersionPart(value) {
  return String(value || "unknown").replace(/[^\w.-]/g, "_");
}

function createLogger(logsDir) {
  const log = (level, message) => {
    if (!app.isPackaged) {
      console.log(`[${level}] ${message}`);
    }
    const now = new Date();
    const fileName = `desktop-${now.toISOString().slice(0, 10)}.log`;
    const filePath = path.join(logsDir, fileName);
    const line = `${now.toISOString()} [${level}] ${message}\n`;
    try {
      if (existsSync(filePath) && statSync(filePath).size > LOG_MAX_BYTES) {
        renameSync(filePath, `${filePath}.1`);
      }
      appendFileSync(filePath, line);
    } catch {}
    pruneLogs(logsDir);
  };
  return log;
}

function pruneLogs(logsDir) {
  try {
    const cutoff = Date.now() - LOG_RETENTION_MS;
    for (const entry of readdirSync(logsDir)) {
      if (!/^desktop-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(entry)) continue;
      const filePath = path.join(logsDir, entry);
      if (statSync(filePath).mtimeMs < cutoff) {
        rmSync(filePath, { force: true });
      }
    }
  } catch {}
}
