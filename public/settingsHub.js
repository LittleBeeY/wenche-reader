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
}

export function openSettings(section) {
  if (!dialog) return;
  activate(section);
  if (!dialog.open) dialog.showModal();
}

export function closeSettings() {
  dialog?.close();
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
      detail: { section: visibleTab }
    })
  );
}
