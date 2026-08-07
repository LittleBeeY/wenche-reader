const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel) {
  return ipcRenderer.invoke(channel);
}

const api = {
  getRuntimeInfo: () => invoke("wenche:get-runtime-info"),
  checkForUpdates: () => invoke("wenche:check-for-updates"),
  restartToInstallUpdate: () => invoke("wenche:restart-to-install-update"),
  restartApp: () => invoke("wenche:restart-app"),
  openLogDirectory: () => invoke("wenche:open-log-directory"),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("wenche:update-state", listener);
    return () => ipcRenderer.removeListener("wenche:update-state", listener);
  }
};

contextBridge.exposeInMainWorld("wencheDesktop", api);
