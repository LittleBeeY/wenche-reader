import { expect, test as base, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function launchOptions(root) {
  return {
    args: [projectRoot, "--no-sandbox"],
    cwd: projectRoot,
    timeout: 60000,
    env: {
      ...process.env,
      WENCHE_DESKTOP_DATA_ROOT: root,
      NODE_ENV: "test"
    }
  };
}

async function launchAt(root) {
  const app = await electron.launch(launchOptions(root));
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

const test = base.extend({
  desktopApp: async ({}, use) => {
    const root = await mkdtemp(path.join(tmpdir(), "wenche-desktop-e2e-"));
    const launched = await launchAt(root);
    await use(launched);
    await launched.app.close().catch(() => {});
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
  await expect(page.locator("#desktop-about")).toBeVisible();
  await expect(page.locator("#desktop-version")).toContainText("1.1.0");

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
    version: "1.1.0"
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
  expect(health.version).toBe("1.1.0");

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
    await first.app.close();

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
    await second.app.close();
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
    await launched.app.close();
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
