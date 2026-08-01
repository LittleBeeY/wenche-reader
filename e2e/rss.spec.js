import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  // 清理残留状态，保证跨浏览器项目共享服务器时用例相互独立：
  // 先重置条目状态，再软删除订阅
  const entriesResponse = await page.request.get("/api/rss/entries?read=all&limit=100&includeHidden=1");
  const { entries } = await entriesResponse.json();
  if (entries.length > 0) {
    await page.request.post("/api/rss/entries/batch-state", {
      data: {
        ids: entries.map((entry) => entry.id),
        state: { readState: "unread", starred: false, readLater: false }
      }
    });
  }
  const feedsResponse = await page.request.get("/api/rss/feeds");
  const { feeds } = await feedsResponse.json();
  for (const feed of feeds) {
    await page.request.delete(`/api/rss/feeds/${feed.id}`);
  }
  const documentsResponse = await page.request.get("/api/documents");
  const { documents } = await documentsResponse.json();
  for (const document of documents) {
    await page.request.delete(`/api/documents/${document.id}`);
  }
  await page.reload();
});

test("completes the rss loop: subscribe, list, deep-read with AI, star and brief", async ({ page }) => {
  await page.goto("/");

  // 空状态：提供两个主要入口
  await page.locator("#source-rss").click();
  await expect(page.locator("#rss-nav")).toBeVisible();
  await expect(page.locator("#rss-list-panel")).toBeVisible();
  await expect(page.locator(".reader-shell")).toBeHidden();
  await expect(page.locator("#ai-panel")).toBeHidden();
  await expect(page.locator(".rss-empty")).toContainText("添加你信任的来源");

  // 添加订阅：探测 → 确认
  await page.locator(".rss-empty button", { hasText: "添加订阅" }).click();
  await page.locator("#rss-add-url").fill("http://127.0.0.1:4199/");
  await page.locator("#rss-add-discover").click();
  await expect(page.locator(".rss-candidate strong")).toHaveText("E2E 测试源");
  await page.locator(".rss-candidate button", { hasText: "确认订阅" }).click();

  // 收件箱出现两条资讯，未读数正确
  await expect(page.locator("#rss-feed-tree .rss-feed-item")).toContainText("E2E 测试源");
  await page.locator('[data-rss-scope="inbox"]').click();
  await expect(page.locator(".rss-entry")).toHaveCount(2);
  await expect(page.locator(".rss-entry-thumb")).toHaveCount(2);
  await expect(page.locator(".rss-entry-thumb.is-fallback")).toHaveCount(2);
  await expect(page.locator(".view-cards .rss-entry-actions")).toHaveCount(0);
  await expect(page.locator(".rss-entry-reason")).toHaveCount(0);
  await expect(page.locator(".rss-entry-time")).toHaveText([
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · 约 \d+ 分钟$/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · 约 \d+ 分钟$/
  ]);

  // 打开第一条：创建阅读快照，自动标记已读，正文可操作
  await page.locator(".rss-entry-title").first().click();
  await expect(page.locator("#rss-article-bar")).not.toHaveAttribute("hidden");
  await expect(page.locator(".reader-toolbar > #rss-article-bar")).toHaveCount(1);
  await expect(page.locator("#bookmark-page")).toBeHidden();
  await expect(page.locator("#rss-list-panel")).toBeHidden();
  await expect(page.locator(".reader-shell")).toBeVisible();
  await expect(page.locator("#reader-title")).toHaveText("Agent 工程实践案例");
  await expect(page.locator("#rss-article-meta")).toContainText("E2E 测试源");
  await expect(page.locator("#rss-article-meta")).toContainText(
    /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/
  );

  // 划词解析：复用现有 AI 能力（Mock provider），选中正文段落块
  await page.locator("#reader .doc-block").nth(1).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#selection-menu [data-action='direct']").click();
  await expect(page.locator("#answer-list .answer-item").first()).toContainText("直接解析");

  // 高亮保存后出现在沉淀面板
  await page.locator("#reader .doc-block").nth(1).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#selection-menu [data-action='highlight']").click();
  await page.locator("#knowledge-tab").click();
  await expect(page.locator("#annotation-list")).toContainText("工具调用");

  // 收藏与稍后读
  await page.locator('[data-rss-action="star"]').click();
  await expect(page.locator('[data-rss-action="star"]')).toHaveText("★");

  // 隐藏快照不出现在本地文档列表
  await page.locator("#rss-article-back").click();
  await page.locator("#source-local").click();
  await expect(page.locator("#rss-list-panel")).toBeHidden();
  await expect(page.locator(".reader-shell")).toBeVisible();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#document-list")).not.toContainText("Agent 工程实践案例");
  await expect(page.locator("#reader-title")).toHaveText("上传一篇文章开始阅读");
  await expect(page.locator("#reader")).toBeEmpty();

  // 生成今日精选：给出推荐原因（其他浏览器项目可能已生成，两种状态都接受）
  await page.locator("#source-rss").click();
  await page.locator('[data-rss-scope="today"]').click();
  const generateButton = page.locator(".rss-empty button", { hasText: "立即生成" });
  if (await generateButton.count()) {
    await generateButton.click();
  }
  await expect(page.locator("#rss-brief-banner")).toContainText("今日精选");
  await expect(page.locator(".rss-entry-reason").first()).toContainText("推荐");
  await expect.poll(async () => page.locator(".rss-entry-reason").first().evaluate((element) => {
    const card = element.closest(".rss-entry");
    return card && element.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom;
  })).toBe(true);

  // 收藏范围可见已收藏条目
  await page.locator('[data-rss-scope="starred"]').click();
  await expect(page.locator(".rss-entry")).toHaveCount(1);
});

test("imports and exports opml subscriptions", async ({ page }) => {
  await page.goto("/");
  await page.locator("#source-rss").click();

  const opml = `<?xml version="1.0"?>
  <opml version="2.0"><body>
    <outline text="测试" ><outline text="E2E 测试源" xmlUrl="http://127.0.0.1:4199/feed.xml"/></outline>
  </body></opml>`;
  const preview = await page.request.post("/api/rss/opml/preview", {
    data: { opml }
  });
  expect(preview.ok()).toBeTruthy();
  const previewJson = await preview.json();
  // 软删除后的重新订阅记为 reenable，首次记为 new
  expect((previewJson.summary.new || 0) + (previewJson.summary.reenable || 0)).toBe(1);

  const imported = await page.request.post("/api/rss/opml/import", {
    data: { opml }
  });
  const importJson = await imported.json();
  expect(importJson.imported + importJson.reenabled).toBe(1);

  await page.reload();
  await page.locator("#source-rss").click();
  await expect(page.locator("#rss-feed-tree")).toContainText("E2E 测试源");

  const exported = await page.request.get("/api/rss/opml/export");
  expect(exported.ok()).toBeTruthy();
  expect(await exported.text()).toContain("E2E 测试源");
});

test("survives a reload with mode, subscriptions and read states intact", async ({ page }) => {
  await page.goto("/");
  await page.locator("#source-rss").click();
  await page.locator(".rss-empty button", { hasText: "添加订阅" }).click();
  await page.locator("#rss-add-url").fill("http://127.0.0.1:4199/feed.xml");
  await page.locator("#rss-add-discover").click();
  await page.locator(".rss-candidate button", { hasText: "确认订阅" }).click();
  await page.locator('[data-rss-scope="inbox"]').click();
  await page.locator(".rss-entry-title").first().click();
  await expect(page.locator("#rss-article-bar")).not.toHaveAttribute("hidden");
  await expect(page.locator("#reader-title")).toHaveText("Agent 工程实践案例");

  await page.reload();
  // 模式偏好恢复：仍在资讯模式
  await expect(page.locator("#rss-nav")).toBeVisible();
  await page.locator('[data-rss-scope="inbox"]').click();
  await page.locator("#rss-read-filter [data-value='read']").click();
  await expect(page.locator(".rss-entry").first()).toBeVisible();
  await expect(page.locator(".rss-entry-list")).toContainText("Agent 工程实践案例");
});

test("uses single-task navigation on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/");
  await page.locator("#source-rss").click();

  await expect(page.locator("#document-sidebar")).toBeVisible();
  await expect(page.locator("#rss-list-panel")).toBeHidden();

  const subscriptionCreated = await page.request.post("/api/rss/feeds", {
    data: { feedUrl: "http://127.0.0.1:4199/feed.xml" }
  });
  expect(subscriptionCreated.ok()).toBeTruthy();
  await page.reload();
  await page.locator("#source-rss").click();

  await page.locator('[data-rss-scope="inbox"]').click();
  await expect(page.locator("#document-sidebar")).toBeHidden();
  await expect(page.locator("#rss-list-panel")).toBeVisible();

  await page.locator(".rss-entry-title").first().click();
  await expect(page.locator("#rss-list-panel")).toBeHidden();
  await expect(page.locator(".reader-shell")).toBeVisible();
  await expect(page.locator("#rss-article-back")).toBeVisible();

  await page.locator("#rss-article-back").click();
  await expect(page.locator("#rss-list-panel")).toBeVisible();
  await expect(page.locator(".reader-shell")).toBeHidden();

  await page.locator("#rss-list-back").click();
  await expect(page.locator("#document-sidebar")).toBeVisible();
  await expect(page.locator("#rss-list-panel")).toBeHidden();
});

test("keeps desktop browsing and reading focused on the current task", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 950 });
  await page.goto("/");
  await page.locator("#source-rss").click();

  const browseSidebar = await page.locator("#document-sidebar").boundingBox();
  const browseList = await page.locator("#rss-list-panel").boundingBox();
  expect(browseSidebar?.width).toBeLessThanOrEqual(280);
  expect(browseList?.width).toBeGreaterThan(1500);
  await expect(page.locator(".reader-shell")).toBeHidden();
  await expect(page.locator("#ai-panel")).toBeHidden();

  const subscriptionCreated = await page.request.post("/api/rss/feeds", {
    data: { feedUrl: "http://127.0.0.1:4199/feed.xml" }
  });
  expect(subscriptionCreated.ok()).toBeTruthy();
  await page.reload();
  await page.locator("#source-rss").click();
  await page.locator('[data-rss-scope="inbox"]').click();
  await page.locator(".rss-entry-title").first().click();

  await expect(page.locator("#document-sidebar")).toBeHidden();
  await expect(page.locator("#rss-list-panel")).toBeHidden();
  const readingArea = await page.locator(".reader-shell").boundingBox();
  const readingAi = await page.locator("#ai-panel").boundingBox();
  expect(readingArea?.width).toBeGreaterThan(1400);
  expect(readingAi?.width).toBeGreaterThanOrEqual(350);

  await page.locator("#rss-article-back").click();
  await page.locator("#source-local").click();
  await expect(page.locator("#rss-list-panel")).toBeHidden();
  await expect(page.locator("#document-sidebar")).toBeVisible();
  await expect(page.locator(".reader-shell")).toBeVisible();
  await expect(page.locator("#ai-panel")).toBeVisible();
});
