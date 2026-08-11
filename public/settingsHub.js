/**
 * 统一设置模块：本地文档视图与资讯视图共用同一个设置对话框。
 * 区段：AI 接口 / 资讯 / 数据 / 关于与更新（桌面）。
 * 每个视图只负责“入口”，打开、切换、关闭都走这里，避免设置界面分叉。
 */
const SECTIONS = ["ai", "rss", "data", "about"];

let dialog = null;

export function initSettingsHub() {
  dialog = document.querySelector("#settings-dialog");
  if (!dialog) return;
  // 对话框常驻渲染树（见 design-refresh.css：未打开时 display:block + opacity:0），
  // 用 inert 阻断未打开时的交互与聚焦，打开时移除。
  dialog.setAttribute("inert", "");
  for (const tab of dialog.querySelectorAll("[data-settings-tab]")) {
    tab.addEventListener("click", () => {
      activate(tab.dataset.settingsTab);
    });
  }
  for (const button of dialog.querySelectorAll("[data-settings-close]")) {
    button.addEventListener("click", closeSettings);
  }
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSettings();
  });
  // Esc 等关闭路径也会走到这里，确保关闭后重新加回 inert。
  dialog.addEventListener("close", () => {
    if (!dialog.open) dialog.setAttribute("inert", "");
  });
}

export function openSettings(section) {
  if (!dialog) return;
  activate(section);
  if (!dialog.open) {
    dialog.removeAttribute("inert");
    dialog.showModal();
  }
}

export function closeSettings() {
  dialog?.close();
  if (dialog && !dialog.open) dialog.setAttribute("inert", "");
}

function activate(section) {
  const requested = SECTIONS.includes(section) ? section : "ai";
  const tabFor = (name) =>
    dialog?.querySelector(`[data-settings-tab="${name}"]`);
  const visibleTab =
    tabFor(requested) && !tabFor(requested).hidden
      ? requested
      : SECTIONS.find((name) => tabFor(name) && !tabFor(name).hidden) || "ai";
  for (const name of SECTIONS) {
    const tab = tabFor(name);
    if (!tab) continue;
    const active = name === visibleTab;
    tab.dataset.active = String(active);
    tab.setAttribute("aria-selected", String(active));
    const section = document.querySelector(`#settings-section-${name}`);
    if (section) section.hidden = !active;
  }
  dialog?.dispatchEvent(
    new CustomEvent("wenche:settings-section", {
      bubbles: true,
      detail: { section: visibleTab }
    })
  );
}
