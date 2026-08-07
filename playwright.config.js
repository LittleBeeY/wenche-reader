import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // 桌面版 E2E 只由 playwright.desktop.config.js 运行（需要 Electron 窗口/图形环境）。
  testIgnore: "**/desktop.spec.js",
  fullyParallel: false,
  workers: 1,
  // 浏览器 E2E 存在既有偶发用例（共享临时库导致的状态/时序波动），CI 重试避免误报；
  // 稳定失败的重试后仍会标红。
  retries: process.env.CI ? 2 : 0,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: "chrome" } },
    { name: "edge", use: { browserName: "chromium", channel: "msedge" } },
    { name: "firefox", use: { browserName: "firefox" } }
  ],
  webServer: {
    command: "node e2e/server.js",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 30000
  }
});
