// 桌面版“关于与更新”入口：仅在 Electron preload 暴露 wencheDesktop 时启用。
// 浏览器版不依赖也不加载任何桌面能力。
(function initDesktopUi() {
  const api = window.wencheDesktop;
  if (!api) return;
  const panel = document.getElementById("desktop-about");
  if (!panel) return;
  panel.hidden = false;

  const versionElement = document.getElementById("desktop-version");
  const stateElement = document.getElementById("desktop-update-state");
  const checkButton = document.getElementById("desktop-check-updates");
  const installButton = document.getElementById("desktop-install-update");
  const logsButton = document.getElementById("desktop-open-logs");

  const STATE_LABELS = {
    disabled: "更新未启用",
    idle: "",
    checking: "正在检查更新…",
    available: "发现新版本，可在后台下载",
    "not-available": "已是最新版本",
    downloading: "正在下载更新…",
    downloaded: "更新已下载，重启后安装",
    error: "更新检查失败"
  };

  function renderUpdateState(state) {
    stateElement.textContent = STATE_LABELS[state.state] || "";
    installButton.hidden = state.state !== "downloaded";
  }

  api.getRuntimeInfo().then((info) => {
    if (versionElement) {
      versionElement.textContent = `文澈阅读 ${info.version}（桌面版）`;
    }
  });

  const unsubscribe = api.onUpdateState(renderUpdateState);
  window.addEventListener("beforeunload", () => unsubscribe(), { once: true });

  checkButton?.addEventListener("click", async () => {
    const result = await api.checkForUpdates();
    if (!result?.accepted && stateElement) {
      stateElement.textContent = "当前无法检查更新";
    }
  });
  installButton?.addEventListener("click", () => void api.restartToInstallUpdate());
  logsButton?.addEventListener("click", () => void api.openLogDirectory());
})();
