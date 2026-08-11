import { expect, test as base, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_KEY_ENV_NAMES } from "../src/lib/aiEnvKeys.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);
const APP_VERSION = packageJson.version;

/** 测试默认只保留显式传入的 AI 环境变量，避免宿主机器的别名变量污染断言。 */
function launchOptions(root, extraEnv = {}) {
  const env = { ...process.env };
  for (const name of AI_KEY_ENV_NAMES) delete env[name];
  return {
    args: [projectRoot, "--no-sandbox"],
    cwd: projectRoot,
    timeout: 60000,
    env: {
      ...env,
      WENCHE_DESKTOP_DATA_ROOT: root,
      NODE_ENV: "test",
      ...extraEnv
    }
  };
}

async function launchAt(root, extraEnv = {}) {
  const app = await electron.launch(launchOptions(root, extraEnv));
  app.process().stdout?.on("data", (chunk) => {
    console.log(`[desktop-main] ${String(chunk).trim()}`);
  });
  app.process().stderr?.on("data", (chunk) => {
    console.log(`[desktop-main-err] ${String(chunk).trim()}`);
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => {
    console.log(`[desktop-renderer-error] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`[desktop-renderer-console] ${message.text()}`);
    }
  });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, root };
}

async function closeApp(app) {
  let child;
  try {
    child = app.process();
  } catch {
    return;
  }
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 10000))
  ]);
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

const test = base.extend({
  desktopApp: async ({}, use) => {
    const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-e2e-"));
    const launched = await launchAt(root);
    await use(launched);
    await closeApp(launched.app);
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("renders the reader in a sandboxed renderer with the desktop API", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  await expect(page).toHaveTitle(/文澈阅读/);
  await expect(page.locator("#app-shell")).toBeVisible();
  await page.locator("#sidebar-more > summary").click();
  await expect(page.locator("#sidebar-settings-open")).toBeVisible();
  await page.locator("#sidebar-settings-open").click();
  await expect(page.locator("#settings-dialog")).toHaveJSProperty("open", true);
  await page.locator('[data-settings-tab="about"]').click();
  await expect(page.locator("#desktop-version")).toContainText(APP_VERSION);
  await page.locator("#settings-close").click();

  const sandbox = await page.evaluate(() => ({
    hasRequire: typeof window.require !== "undefined",
    hasProcess: typeof window.process !== "undefined",
    hasIpcRenderer: "ipcRenderer" in window,
    hasDesktopApi: typeof window.wencheDesktop === "object"
  }));
  expect(sandbox.hasRequire).toBe(false);
  expect(sandbox.hasProcess).toBe(false);
  expect(sandbox.hasIpcRenderer).toBe(false);
  expect(sandbox.hasDesktopApi).toBe(true);

  const info = await page.evaluate(() => window.wencheDesktop.getRuntimeInfo());
  expect(info).toEqual({
    desktop: true,
    platform: "win32",
    version: APP_VERSION
  });
});

test("proxies the API and vendor assets through app:// with a strict CSP", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  const health = await page.evaluate(() =>
    fetch("/api/health").then((response) => response.json())
  );
  expect(health.status).toBe("ok");
  expect(health.version).toBe(APP_VERSION);

  const vendor = await page.evaluate(async () => {
    const response = await fetch("/vendor/docx-preview.min.js");
    const text = await response.text();
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      length: text.length
    };
  });
  expect(vendor.status).toBe(200);
  expect(vendor.type).toMatch(/javascript/);
  expect(vendor.length).toBeGreaterThan(1000);

  const csp = await page.evaluate(async () => {
    const response = await fetch("/");
    return response.headers.get("content-security-policy");
  });
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-eval");
});

test("imports a document and streams a mock AI answer", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  const contentBase64 = Buffer.from(
    "文澈阅读桌面端导入测试正文，包含足够用于分页与划词解析的中文内容。",
    "utf8"
  ).toString("base64");
  const created = await page.evaluate(async (base64) => {
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "desktop-e2e.txt", contentBase64: base64 })
    });
    return response.json();
  }, contentBase64);
  expect(created.id).toBeGreaterThan(0);

  const streamText = await page.evaluate(async (documentId) => {
    const response = await fetch("/api/ai/explain", {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        documentId,
        mode: "direct",
        scope: "document"
      })
    });
    return response.text();
  }, created.id);
  expect(streamText).toContain("event: start");
  expect(streamText.match(/event: delta/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(streamText).toContain("event: done");
});

test("persists localStorage and library data across restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-e2e-"));
  try {
    const first = await launchAt(root);
    const firstPage = first.page;
    await firstPage.evaluate(() => localStorage.setItem("desktop-e2e", "persisted"));
    const base64 = Buffer.from("重启后仍应存在的正文内容。", "utf8").toString("base64");
    await firstPage.evaluate(async (contentBase64) => {
      await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "persist.txt", contentBase64 })
      });
    }, base64);
    await closeApp(first.app);

    const second = await launchAt(root);
    const secondPage = second.page;
    expect(
      await secondPage.evaluate(() => localStorage.getItem("desktop-e2e"))
    ).toBe("persisted");
    const documents = await secondPage.evaluate(async () => {
      const response = await fetch("/api/documents");
      return (await response.json()).documents;
    });
    expect(documents.length).toBe(1);
    await closeApp(second.app);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("single instance lock focuses the existing window", async ({
  desktopApp
}) => {
  const { app, root } = desktopApp;
  const second = spawn(
    path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe"),
    [projectRoot, "--no-sandbox"],
    {
      env: {
        ...process.env,
        WENCHE_DESKTOP_DATA_ROOT: root,
        NODE_ENV: "test"
      },
      stdio: "ignore"
    }
  );
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      second.kill();
      resolve();
    }, 20000);
    second.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  expect(await app.windows()).toHaveLength(1);
});

test("saves AI settings through safeStorage and keeps them across restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-e2e-"));
  try {
    const first = await launchAt(root);
    const firstPage = first.page;
    await expect(firstPage.locator("#ai-status")).not.toContainText("正在检查", {
      timeout: 30000
    });
    await firstPage.locator("#ai-status").click();
    await expect(firstPage.locator("#settings-dialog")).toHaveJSProperty("open", true);
    await firstPage.locator("#ai-settings-provider").selectOption("openai");
    await firstPage.locator("#ai-settings-key").fill("saved-secret-key");
    await firstPage.locator("#ai-settings-save").click();
    await expect(firstPage.locator("#settings-dialog")).toHaveJSProperty("open", false);
    await firstPage.locator("#ai-status").click();
    await expect(firstPage.locator("#ai-settings-key-hint")).toContainText("已配置");
    await firstPage.locator("#ai-settings-cancel").click();
    await closeApp(first.app);

    const second = await launchAt(root);
    const settings = await second.page.evaluate(async () => {
      const response = await fetch("/api/ai/settings");
      return response.json();
    });
    expect(settings.provider).toBe("openai");
    expect(settings.hasApiKey).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("saved-secret-key");
    await closeApp(second.app);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("uses AI_API_KEY from the environment for the current session only", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-e2e-"));
  try {
    const launched = await launchAt(root, {
      AI_API_KEY: "env-session-key",
      AI_PROVIDER: "openai",
      AI_MODEL: "gpt-4.1-mini"
    });
    const { page } = launched;
    const envState = await page.evaluate(() => window.wencheDesktop.getAiEnvState());
    expect(envState).toEqual({
      available: true,
      inUse: true,
      keyEnvName: "AI_API_KEY",
      keyEnvOptions: ["AI_API_KEY"]
    });

    const settings = await page.evaluate(async () => {
      const response = await fetch("/api/ai/settings");
      return response.json();
    });
    expect(settings.provider).toBe("openai");
    expect(settings.hasApiKey).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("env-session-key");

    await expect(page.locator("#ai-status")).not.toContainText("正在检查", {
      timeout: 30000
    });
    await page.locator("#ai-status").click();
    await expect(page.locator("#ai-settings-env")).toBeVisible();
    await expect(page.locator("#ai-settings-env-text")).toContainText("环境变量");
    await page.locator("#ai-settings-cancel").click();
    await closeApp(launched.app);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("exposes an in-app uninstall entry that stays safe in dev mode", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  await page.locator("#sidebar-more > summary").click();
  await page.locator("#sidebar-settings-open").click();
  await expect(page.locator("#settings-dialog")).toHaveJSProperty("open", true);
  await page.locator('[data-settings-tab="about"]').click();
  const uninstallButton = page.locator("#desktop-uninstall");
  await expect(uninstallButton).toBeVisible();
  await uninstallButton.click();
  await expect(page.locator("#desktop-update-state")).toContainText(
    "开发模式不支持应用内卸载"
  );
});

test("explains that updates are disabled before a feed is configured", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  await page.locator("#sidebar-more > summary").click();
  await page.locator("#sidebar-settings-open").click();
  await page.locator('[data-settings-tab="about"]').click();
  await page.locator("#desktop-check-updates").click();
  await expect(page.locator("#desktop-update-state")).toContainText(
    "更新未启用"
  );
});

test("keeps the RSS article AI panel floating with a visible launcher", async ({
  desktopApp
}) => {
  const { app, page } = desktopApp;
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(400, 300);
    win.setSize(1280, 800);
    win.setPosition(0, 0);
  });
  await page.waitForTimeout(400);
  const geometry = await page.evaluate((collapsed) => {
    const shell = document.querySelector("#app-shell");
    shell.classList.add("rss-mode", "rss-reading");
    shell.classList.toggle("is-right-collapsed", collapsed);
    const panel = document.querySelector("#ai-panel").getBoundingClientRect();
    const toggle = document.querySelector("#toggle-ai-panel").getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    const visible = (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= viewport.width &&
      rect.bottom <= viewport.height;
    return {
      panelVisible: visible(panel),
      toggleVisible: visible(toggle),
      toggle: { left: toggle.left, top: toggle.top, width: toggle.width, height: toggle.height }
    };
  }, false);
  expect(geometry.panelVisible).toBe(true);

  const collapsed = await page.evaluate(() => {
    const shell = document.querySelector("#app-shell");
    shell.classList.add("is-right-collapsed");
    const toggle = document.querySelector("#toggle-ai-panel").getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return (
      toggle.width > 0 &&
      toggle.height > 0 &&
      toggle.left >= 0 &&
      toggle.top >= 0 &&
      toggle.right <= viewport.width &&
      toggle.bottom <= viewport.height
    );
  });
  expect(collapsed).toBe(true);
});

test("opens the unified settings dialog from the RSS article menu", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  await page.evaluate(() => {
    const shell = document.querySelector("#app-shell");
    shell.classList.add("rss-mode", "rss-reading");
    document.querySelector(".rss-article-bar").hidden = false;
  });
  await page.locator(".rss-article-more > summary").click();
  await page.locator("#rss-open-settings").click();
  await expect(page.locator("#settings-dialog")).toHaveJSProperty("open", true);
  await page.locator('[data-settings-tab="about"]').click();
  await expect(page.locator("#desktop-version")).toContainText(APP_VERSION);
  await page.locator("#settings-close").click();
});

test("keeps the AI panel inside a small restored window", async ({
  desktopApp
}) => {
  const { app, page } = desktopApp;
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(400, 300);
    win.setSize(900, 560);
    win.setPosition(0, 0);
  });
  await page.waitForTimeout(500);
  const bounds = await page.evaluate(() => {
    const rect = document.querySelector("#ai-panel").getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
});

test("reports storage usage and cleans safe caches", async ({ desktopApp }) => {
  const { page, root } = desktopApp;
  const rssImagesDir = path.join(root, "cache", "rss-images");
  await mkdir(rssImagesDir, { recursive: true });
  await writeFile(path.join(rssImagesDir, "pic.bin"), Buffer.alloc(2048));

  const before = await page.evaluate(() => window.wencheDesktop.getStorageInfo());
  expect(before.ok).toBe(true);
  const rssEntry = before.entries.find((entry) => entry.key === "rss-images");
  expect(rssEntry.size).toBeGreaterThanOrEqual(2048);

  const cleaned = await page.evaluate(() =>
    window.wencheDesktop.cleanCache("rss-images")
  );
  expect(cleaned.ok).toBe(true);

  const after = await page.evaluate(() => window.wencheDesktop.getStorageInfo());
  expect(after.entries.find((entry) => entry.key === "rss-images").size).toBe(0);
});

test("opens AI settings while startup data is still loading", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.includes("/api/documents")) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      return originalFetch(...args);
    };
  });
  await page.reload();
  await page.waitForSelector("#ai-status");
  await page.locator("#ai-status").click();
  await expect(page.locator("#settings-dialog")).toHaveJSProperty(
    "open",
    true,
    { timeout: 20000 }
  );
});

test("populates the AI settings section when opened from the sidebar tab", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  await page.locator("#sidebar-more > summary").click();
  await page.locator("#sidebar-settings-open").click();
  await expect(page.locator("#settings-dialog")).toHaveJSProperty("open", true);
  await page.locator('[data-settings-tab="ai"]').click();
  await expect(page.locator("#settings-section-ai")).toBeVisible();
  await expect
    .poll(
      async () => page.locator("#ai-settings-provider option").count(),
      { timeout: 15000 }
    )
    .toBeGreaterThan(0);
  expect(
    await page.locator("#ai-settings-provider").isEnabled()
  ).toBe(true);
});

test("keeps the settings dialog composited while closed to avoid soft-render flash", async ({
  desktopApp
}) => {
  const { page } = desktopApp;
  const dialog = page.locator("#settings-dialog");
  // 常驻渲染：未打开时保持 display:block + opacity:0（而非 UA 的 display:none），
  // 合成层与内容从页面加载起就已光栅化，showModal 不再新建表面 → 不闪帧。
  await expect(dialog).toHaveCSS("display", "block");
  await expect(dialog).toHaveCSS("opacity", "0");
  await expect(dialog).toHaveJSProperty("open", false);
  expect(await dialog.getAttribute("inert")).not.toBeNull();

  // 打开：移除 inert 并进入 modal
  await page.locator("#sidebar-more > summary").click();
  await page.locator("#sidebar-settings-open").click();
  await expect(dialog).toHaveJSProperty("open", true);
  await expect(dialog).toHaveCSS("opacity", "1");
  expect(await dialog.getAttribute("inert")).toBeNull();

  // 关闭：inert 恢复，渲染状态回到常驻隐藏
  await page.locator("#settings-close").click();
  await expect(dialog).toHaveJSProperty("open", false);
  await expect(dialog).toHaveCSS("opacity", "0");
  expect(await dialog.getAttribute("inert")).not.toBeNull();
});

test("relocates the data root and keeps documents readable", async () => {
  const rootA = await mkdtemp(path.join(tmpdir(), "wenche-relocate-a-"));
  const rootB = await mkdtemp(path.join(tmpdir(), "wenche-relocate-b-"));
  try {
    const first = await launchAt(rootA);
    const firstPage = first.page;
    const contentBase64 = Buffer.from(
      "数据目录迁移后仍可阅读的正文。",
      "utf8"
    ).toString("base64");
    const created = await firstPage.evaluate(async (base64) => {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "relocate.txt", contentBase64: base64 })
      });
      return response.json();
    }, contentBase64);
    expect(created.id).toBeGreaterThan(0);

    const relocated = await firstPage.evaluate((target) =>
      window.wencheDesktop.relocateData(target)
    , rootB);
    expect(relocated.ok).toBe(true);
    await closeApp(first.app);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const pointer = JSON.parse(
      await readFile(path.join(rootA, "data-location.json"), "utf8")
    );
    expect(path.resolve(pointer.root)).toBe(path.resolve(rootB));
    expect(existsSync(path.join(rootB, "data", "reader.sqlite"))).toBe(true);

    const second = await launchAt(rootA);
    const documents = await second.page.evaluate(async () => {
      const response = await fetch("/api/documents");
      return response.json();
    });
    expect(documents.documents.length).toBe(1);
    expect(documents.documents[0].title).toBe("relocate.txt");
    await closeApp(second.app);
  } finally {
    await rm(rootA, { recursive: true, force: true }).catch(() => {});
    await rm(rootB, { recursive: true, force: true }).catch(() => {});
  }
});

test("denies popups and permission requests", async ({ desktopApp }) => {
  const { page } = desktopApp;
  const opened = await page.evaluate(() => window.open("https://example.com"));
  expect(opened).toBeNull();
  const permission = await page.evaluate(() =>
    navigator.permissions.query({ name: "geolocation" }).then((result) => result.state)
  );
  expect(permission).toBe("denied");
});

test("shows the error page when the database state is inconsistent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-e2e-"));
  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "reader.sqlite"), "", "utf8");
  await writeFile(path.join(dataDir, "reader.sqlite-wal"), "", "utf8");
  try {
    const launched = await launchAt(root);
    await expect(launched.page).toHaveURL(/desktop-error\.html/);
    await expect(launched.page.locator("h1")).toContainText("未能启动");
    await expect(launched.page.locator("#error-code")).toHaveText(
      "sqlite-inconsistent-state"
    );
    await closeApp(launched.app);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("closing the last window quits the app and the worker", async ({
  desktopApp
}) => {
  const { app, page } = desktopApp;
  const child = app.process();
  await page.close();
  await expect
    .poll(async () => child.exitCode, { timeout: 30000 })
    .not.toBeNull();
});
