// 桌面版“关于与更新”入口：仅在 Electron preload 暴露 wencheDesktop 时启用。
// 浏览器版不依赖也不加载任何桌面能力。
(function initDesktopUi() {
  const api = window.wencheDesktop;
  if (!api) return;
  const aboutTab = document.querySelector('[data-settings-tab="about"]');
  if (!aboutTab) return;
  aboutTab.hidden = false;

  const versionElement = document.getElementById("desktop-version");
  const stateElement = document.getElementById("desktop-update-state");
  const checkButton = document.getElementById("desktop-check-updates");
  const installButton = document.getElementById("desktop-install-update");
  const logsButton = document.getElementById("desktop-open-logs");
  const uninstallButton = document.getElementById("desktop-uninstall");
  const storageUsage = document.getElementById("storage-usage");
  const dataLocation = document.getElementById("data-location");
  if (storageUsage) storageUsage.hidden = false;
  if (dataLocation) dataLocation.hidden = false;

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
    if (result?.accepted || !stateElement) return;
    if (result.reason === "error") {
      stateElement.textContent = "更新检查失败";
    } else {
      stateElement.textContent = "更新未启用（未配置更新源，正式发布后可用）";
    }
  });
  installButton?.addEventListener("click", () => void api.restartToInstallUpdate());
  logsButton?.addEventListener("click", () => void api.openLogDirectory());
  uninstallButton?.addEventListener("click", async () => {
    if (!uninstallButton || uninstallButton.disabled) return;
    uninstallButton.disabled = true;
    if (stateElement) stateElement.textContent = "正在启动卸载…";
    const result = await api.uninstallApp();
    if (!result?.accepted && stateElement) {
      uninstallButton.disabled = false;
      stateElement.textContent =
        result?.error === "dev-mode"
          ? "开发模式不支持应用内卸载"
          : result?.error === "update-exe-missing"
            ? "未找到卸载程序（Update.exe）"
            : "已取消卸载";
    }
  });

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  async function refreshStorageInfo() {
    const info = await api.getStorageInfo();
    if (!info?.ok) return;
    const rows = document.getElementById("storage-usage-rows");
    const total = document.getElementById("storage-usage-total");
    if (rows) {
      rows.replaceChildren();
      for (const entry of info.entries) {
        const row = document.createElement("div");
        row.className = "storage-usage-row";
        const label = document.createElement("span");
        label.textContent = entry.label;
        const size = document.createElement("strong");
        size.textContent = formatBytes(entry.size);
        row.append(label, size);
        rows.appendChild(row);
      }
    }
    if (total) total.textContent = `合计：${formatBytes(info.total)}`;
    const pathElement = document.getElementById("data-location-path");
    if (pathElement) pathElement.textContent = info.root;
  }

  document.addEventListener("wenche:settings-section", (event) => {
    if (event.detail?.section === "data") void refreshStorageInfo();
  });
  document
    .getElementById("storage-refresh")
    ?.addEventListener("click", () => void refreshStorageInfo());
  document
    .getElementById("storage-clean-rss-images")
    ?.addEventListener("click", async () => {
      await api.cleanCache("rss-images");
      await refreshStorageInfo();
    });
  document
    .getElementById("storage-clean-session")
    ?.addEventListener("click", async () => {
      await api.cleanCache("session");
      await refreshStorageInfo();
    });
  const changeLocationButton = document.getElementById("data-location-change");
  const locationStatus = document.getElementById("data-location-status");
  changeLocationButton?.addEventListener("click", async () => {
    if (changeLocationButton.disabled) return;
    changeLocationButton.disabled = true;
    if (locationStatus) locationStatus.textContent = "";
    const result = await api.relocateData();
    if (result?.ok) {
      if (locationStatus) locationStatus.textContent = "迁移完成，应用即将重启…";
      return;
    }
    changeLocationButton.disabled = false;
    if (locationStatus) {
      const messages = {
        "same-as-current": "新位置与当前数据位置相同。",
        "drive-root": "不能选择磁盘根目录，请选择文件夹。",
        "inside-current": "新位置不能位于当前数据目录内部。",
        "contains-current": "新位置不能包含当前数据目录。",
        "inside-install": "新位置不能位于应用安装目录内。",
        "target-not-writable": "目标位置不可写。",
        "relocate-rewrite-failed": "路径迁移失败，数据未移动。",
        "relocate-move-failed": "移动数据失败，已回滚，可重试。",
        "pointer-write-failed": "无法写入位置指针，请重试。"
      };
      locationStatus.textContent =
        result?.cancelled
          ? "已取消。"
          : messages[result?.error] || `迁移失败：${result?.error || "未知错误"}`;
    }
  });
})();
