import { expect, test } from "@playwright/test";

/*
 * 视觉回归锁（Visual Regression Locks）
 *
 * 这些测试守护"外观改动不得破坏行为"的红线：
 * 1. 划词 AI 解析必须自动展开右侧面板（CLAUDE.md 约束）
 * 2. 夜间主题（深空·极光）的计算样式必须正确渲染（e2e 默认只跑 light）
 * 3. theme-color 必须跟随主题，避免"深空内容 + 浅色浏览器外壳"
 */

test.beforeEach(async ({ page }) => {
  const response = await page.request.get("/api/documents");
  const { documents } = await response.json();
  for (const document of documents) {
    await page.request.delete(`/api/documents/${document.id}`);
  }
});

test("expands the AI panel when selection-triggered AI parsing happens while collapsed", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "selection-expand.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "The quick brown fox jumps over the lazy dog. ".repeat(60)
    )
  });

  // 折叠右侧 AI 面板
  await page.locator("#toggle-ai-panel").click();
  await expect(page.locator("#app-shell")).toHaveClass(/is-right-collapsed/);
  await expect(page.locator("#ai-panel")).toHaveCSS("width", "48px");

  // 划词
  await page.locator(".doc-block").filter({ hasText: "quick brown fox" }).first().evaluate((block) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.nodeValue.indexOf("quick brown fox");
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "quick brown fox".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      block.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error("Could not select text: quick brown fox");
  });
  await expect(page.locator("#selection-menu")).toBeVisible();

  // 触发 AI 解析 → 右侧面板必须自动展开（CLAUDE.md 红线）
  await page.locator("#selection-menu [data-action='direct']").click();
  await expect(page.locator("#app-shell")).not.toHaveClass(/is-right-collapsed/);
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator(".answer-item").first()).toContainText("quick brown fox");
});

test("renders the deep-space night theme with correct computed styles", async ({ page }) => {
  await page.goto("/");
  // 通过 localStorage 预置 night（不依赖既有 reading-settings click delegation）
  await page.evaluate(() => {
    localStorage.setItem(
      "ai-reader:reading-settings",
      JSON.stringify({
        fontScale: 100,
        contentWidth: "standard",
        lineHeight: "comfortable",
        theme: "night"
      })
    );
  });
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");

  // 深空背景：body 背景必须包含径向渐变光晕
  const bodyBackground = await page.locator("body").evaluate(
    (el) => getComputedStyle(el).backgroundImage
  );
  expect(bodyBackground).toContain("radial-gradient");

  // 玻璃材质：AI 面板必须应用 backdrop-filter（降级路径存在时由 @supports 接管）
  const panelFilter = await page.locator("#ai-panel").evaluate(
    (el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter
  );
  expect(panelFilter).toContain("blur");

  // 深空底色令牌已定义
  const paper = await page.locator("html").evaluate(
    (el) => getComputedStyle(el).getPropertyValue("--paper").trim()
  );
  expect(paper).not.toBe("");
});

test("keeps the browser theme-color in sync with the app theme", async ({ page }) => {
  await page.goto("/");
  // 默认 light
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#e9efef");

  // 用 localStorage + reload 验证 night 主题与 theme-color 联动
  await page.evaluate(() => {
    localStorage.setItem(
      "ai-reader:reading-settings",
      JSON.stringify({
        fontScale: 100,
        contentWidth: "standard",
        lineHeight: "comfortable",
        theme: "night"
      })
    );
  });
  await page.reload();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#10171c");
});

test("shows the cold-start card when empty and hides it after a document opens", async ({ page }) => {
  await page.goto("/");

  // 空态：卡片可见，且不破坏既有空态断言（#reader 仍空、标题不变）
  await expect(page.locator("#cold-start-card")).toBeVisible();
  await expect(page.locator("#reader-title")).toHaveText("上传一篇文章开始阅读");
  await expect(page.locator("#reader")).toBeEmpty();
  await expect(page.locator("#cold-start-card h2")).toContainText("深度阅读");

  // 上传文档后卡片隐藏，标题变为文档名
  await page.locator("#file-input").setInputFiles({
    name: "cold-start.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Cold start card content.")
  });
  await expect(page.locator("#cold-start-card")).toBeHidden();
  await expect(page.locator("#reader-title")).toHaveText("cold-start.txt");
});

test("cold-start card CTAs wire up upload and rss switch", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#cold-start-card")).toBeVisible();

  // CTA：订阅资讯 → 切到 rss 模式且卡片隐藏
  await page.locator("#cold-start-rss").click();
  await expect(page.locator("#app-shell")).toHaveClass(/rss-mode/);
  await expect(page.locator("#cold-start-card")).toBeHidden();

  // 切回本地且无文档 → 卡片恢复
  await page.locator("#source-local").click();
  await expect(page.locator("#cold-start-card")).toBeVisible();

  // CTA：添加文档 → 触发文件选择器
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator("#cold-start-upload").click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser).toBeTruthy();
});

test("activates the AI panel glow band when the selection menu appears", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "glow-check.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "The quick brown fox jumps over the lazy dog. ".repeat(60)
    )
  });

  // 空闲时：光带暗淡（opacity 0.4）
  const idleOpacity = await page.locator("#ai-panel").evaluate((el) => {
    return Number.parseFloat(getComputedStyle(el, "::before").opacity);
  });
  expect(idleOpacity).toBeLessThan(0.6);

  // 划词菜单出现 → 光带激活（opacity 1）
  await page.locator(".doc-block").filter({ hasText: "quick brown fox" }).first().evaluate((block) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.nodeValue.indexOf("quick brown fox");
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "quick brown fox".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      block.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error("Could not select text: quick brown fox");
  });
  await expect(page.locator("#selection-menu")).toBeVisible();
  // 光带 opacity 有 220ms transition，等待过渡完成后读取
  await page.waitForTimeout(300);
  const activeOpacity = await page.locator("#ai-panel").evaluate((el) => {
    return Number.parseFloat(getComputedStyle(el, "::before").opacity);
  });
  expect(activeOpacity).toBeGreaterThan(0.9);
});
