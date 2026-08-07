const UPDATE_STATES = new Set([
  "disabled",
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "error"
]);

/**
 * 封装 Electron autoUpdater：仅打包版且配置更新源后启用。
 * 下载完成后只通知，由用户明确选择后才 quitAndInstall。
 */
export function createUpdater({
  autoUpdater,
  app,
  feedUrl,
  channel = "stable",
  logger = () => {},
  notify = () => {}
}) {
  let state = "disabled";
  let started = false;
  let updateReady = false;
  let inFlight = null;
  let interval = null;

  function publish(next) {
    if (!UPDATE_STATES.has(next.state)) next.state = "error";
    state = next.state;
    updateReady = next.state === "downloaded";
    notify({
      state,
      ...(next.version ? { version: next.version } : {}),
      ...(next.message ? { message: String(next.message).slice(0, 200) } : {})
    });
  }

  function buildBaseUrl() {
    if (!feedUrl) return null;
    return `${String(feedUrl).replace(/\/+$/, "")}/${channel}/win32/x64`;
  }

  function start() {
    const baseUrl = buildBaseUrl();
    if (!app.isPackaged || !baseUrl) {
      publish({
        state: "disabled",
        message: app.isPackaged ? "未配置更新源" : ""
      });
      return;
    }
    started = true;
    autoUpdater.setFeedURL({ url: baseUrl });
    autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));
    autoUpdater.on("update-available", (info) =>
      publish({ state: "available", version: info?.version || "" })
    );
    autoUpdater.on("update-not-available", () =>
      publish({ state: "not-available" })
    );
    autoUpdater.on("download-progress", () => publish({ state: "downloading" }));
    autoUpdater.on("update-downloaded", (info) =>
      publish({ state: "downloaded", version: info?.version || "" })
    );
    autoUpdater.on("error", (error) => {
      logger("error", `updater: ${sanitizeError(error)}`);
      publish({ state: "error", message: "更新检查失败" });
    });
    setTimeout(() => void checkForUpdates(), 30 * 1000);
    interval = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
    interval.unref?.();
  }

  function checkForUpdates() {
    if (!started) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await autoUpdater.checkForUpdates();
        return true;
      } catch (error) {
        logger("error", `updater check: ${sanitizeError(error)}`);
        publish({ state: "error", message: "更新检查失败" });
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function quitAndInstall() {
    if (started && updateReady) autoUpdater.quitAndInstall();
  }

  function hasUpdate() {
    return updateReady;
  }

  function getState() {
    return { state };
  }

  return { start, checkForUpdates, quitAndInstall, hasUpdate, getState };
}

function sanitizeError(error) {
  return String(error?.message || error || "")
    .replace(/https?:\/\/[^\s]+/g, "[url]")
    .slice(0, 160);
}
