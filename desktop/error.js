const params = new URLSearchParams(location.search);
const code = params.get("code") || "unknown";
document.getElementById("error-code").textContent = code;

document
  .getElementById("restart-app")
  .addEventListener("click", () => void window.wencheDesktop?.restartApp());
document
  .getElementById("open-logs")
  .addEventListener("click", () => void window.wencheDesktop?.openLogDirectory());
