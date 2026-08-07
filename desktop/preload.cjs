const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

const api = {
  getRuntimeInfo: () => invoke("wenche:get-runtime-info"),
  checkForUpdates: () => invoke("wenche:check-for-updates"),
  restartToInstallUpdate: () => invoke("wenche:restart-to-install-update"),
  restartApp: () => invoke("wenche:restart-app"),
  openLogDirectory: () => invoke("wenche:open-log-directory"),
  getAiEnvState: () => invoke("wenche:get-ai-env-state"),
  applyEnvAiConfig: () => invoke("wenche:apply-env-ai-config"),
  uninstallApp: () => invoke("wenche:uninstall-app"),
  getStorageInfo: () => invoke("wenche:get-storage-info"),
  cleanCache: (target) => invoke("wenche:clean-cache", target),
  relocateData: (target) => invoke("wenche:relocate-data", target),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("wenche:update-state", listener);
    return () => ipcRenderer.removeListener("wenche:update-state", listener);
  }
};

contextBridge.exposeInMainWorld("wencheDesktop", api);
