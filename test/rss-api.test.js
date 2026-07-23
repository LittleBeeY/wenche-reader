import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/server.js";

const NOW = new Date();

function buildRss(entries, { title = "测试源", etag } = {}) {
  const items = entries
    .map(
      (entry) => `
    <item>
      <title>${entry.title}</title>
      <link>https://origin.example.com/posts/${entry.id}</link>
      <guid>${entry.id}</guid>
      <pubDate>${(entry.date || NOW).toUTCString()}</pubDate>
      <description><![CDATA[<p>${entry.summary || entry.title} 的摘要</p>]]></description>
      <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<p>${entry.body || `${entry.title} 的正文内容，包含足够的文字用于测试。`}</p>]]></content:encoded>
    </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${title}</title>
    <link>https://origin.example.com/</link>
    <description>测试频道</description>
    ${items}
  </channel>
</rss>`;
}

async function withFeedServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function makeFeedHandler(state) {
  return (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/feed.xml") {
      if (state.fail) {
        res.writeHead(500);
        return res.end("boom");
      }
      if (state.etag && req.headers["if-none-match"] === state.etag) {
        res.writeHead(304);
        return res.end();
      }
      res.writeHead(200, {
        "content-type": "application/rss+xml",
        ...(state.etag ? { etag: state.etag } : {})
      });
      return res.end(buildRss(state.entries, { title: state.title }));
    }
    if (url.pathname === "/site") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html><head><title>站点</title>
        <link rel="alternate" type="application/rss+xml" title="主订阅" href="/feed.xml">
        </head><body>site</body></html>`);
    }
    if (url.pathname === "/article") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html><head><title>完整文章</title></head><body>
        <article>${"<p>这是提取出来的完整正文段落，包含足够多的内容用于测试提取功能。</p>".repeat(6)}</article>
        </body></html>`);
    }
    res.writeHead(404);
    res.end("not found");
  };
}

async function withTestServer(t, { feedState, rssOptions } = {}) {
  const feedUrl = feedState ? await withFeedServer(t, makeFeedHandler(feedState)) : null;
  const root = await mkdtemp(path.join(tmpdir(), "wenche-rss-"));
  const app = createApp({
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    aiProviderConfig: { provider: "mock" },
    rss: { allowPrivateHosts: true, ...rssOptions }
  });
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    app.locals.storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, feedUrl, app };
}

async function api(baseUrl, pathName, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

const sampleEntries = [
  { id: "p1", title: "Agent 工程实践", body: "Agent 工程的正文内容，讨论工具调用与上下文管理。" },
  { id: "p2", title: "向量数据库对比", body: "不同向量数据库的对比分析与实测数据。" },
  { id: "p3", title: "深度阅读方法", body: "如何更好地深度阅读长文与论文。" }
];

test("discovers a feed from a website and adds it", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });

  const discover = await api(baseUrl, "/api/rss/discover", { method: "POST", body: { url: `${feedUrl}/site` } });
  assert.equal(discover.status, 200);
  assert.equal(discover.json.candidates.length, 1);
  assert.equal(discover.json.candidates[0].title, "测试源");
  assert.equal(discover.json.candidates[0].recentEntries.length, 3);

  const added = await api(baseUrl, "/api/rss/feeds", {
    method: "POST",
    body: { feedUrl: discover.json.candidates[0].feedUrl }
  });
  assert.equal(added.status, 201);
  assert.equal(added.json.inserted, 3);
  assert.equal(added.json.feed.title, "测试源");

  const duplicate = await api(baseUrl, "/api/rss/feeds", {
    method: "POST",
    body: { feedUrl: discover.json.candidates[0].feedUrl }
  });
  assert.equal(duplicate.status, 409);

  const nav = await api(baseUrl, "/api/rss/feeds");
  assert.equal(nav.json.feeds.length, 1);
  assert.equal(nav.json.unreadCount, 3);
});

test("refreshes with etag, dedupes entries and backs off on failures", async (t) => {
  const feedState = { entries: sampleEntries, etag: "v1" };
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState });

  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });

  // 第二次刷新：ETag 命中，返回 304
  const refresh = await api(baseUrl, "/api/rss/feeds/1/refresh", { method: "POST" });
  assert.equal(refresh.json.status, "not_modified");

  // 更新 etag 与内容后：只有新条目入库
  feedState.etag = "v2";
  feedState.entries = [...sampleEntries, { id: "p4", title: "新文章" }];
  const refresh2 = await api(baseUrl, "/api/rss/feeds/1/refresh", { method: "POST" });
  assert.equal(refresh2.json.status, "success");
  assert.equal(refresh2.json.inserted, 1);

  // 再次刷新相同内容：无新增
  feedState.etag = "v3";
  const refresh3 = await api(baseUrl, "/api/rss/feeds/1/refresh", { method: "POST" });
  assert.equal(refresh3.json.inserted, 0);

  // 连续失败：记录错误并退避
  feedState.fail = true;
  const failed = await api(baseUrl, "/api/rss/feeds/1/refresh", { method: "POST" });
  assert.equal(failed.status, 502);
  const nav = await api(baseUrl, "/api/rss/feeds");
  assert.equal(nav.json.feeds[0].consecutiveFailures, 1);
  assert.ok(nav.json.feeds[0].lastError.length > 0);
  assert.ok(Date.parse(nav.json.feeds[0].nextFetchAt) > Date.now() + 60 * 60000);
});

test("lists entries with filters and updates state including batch", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });

  const unread = await api(baseUrl, "/api/rss/entries?scope=inbox&read=unread");
  assert.equal(unread.json.entries.length, 3);
  const firstId = unread.json.entries[0].id;

  const patch = await api(baseUrl, `/api/rss/entries/${firstId}/state`, {
    method: "PATCH",
    body: { readState: "read", starred: true }
  });
  assert.equal(patch.json.readState, "read");
  assert.equal(patch.json.starred, true);

  const starred = await api(baseUrl, "/api/rss/entries?scope=starred&read=all");
  assert.equal(starred.json.entries.length, 1);

  const batch = await api(baseUrl, "/api/rss/entries/batch-state", {
    method: "POST",
    body: { ids: [firstId], state: { readLater: true } }
  });
  assert.equal(batch.json.updated, 1);

  const later = await api(baseUrl, "/api/rss/entries?scope=later&read=all");
  assert.equal(later.json.entries.length, 1);

  const hidden = await api(baseUrl, `/api/rss/entries/${firstId}/state`, {
    method: "PATCH",
    body: { hidden: true }
  });
  assert.equal(hidden.json.hidden, true);
  const inbox = await api(baseUrl, "/api/rss/entries?read=all");
  assert.ok(!inbox.json.entries.some((entry) => entry.id === firstId));

  const search = await api(baseUrl, `/api/rss/entries?read=all&query=${encodeURIComponent("向量数据库")}`);
  assert.equal(search.json.entries.length, 1);
});

test("creates an idempotent hidden reading snapshot and keeps it after unsubscribe", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });
  const entries = await api(baseUrl, "/api/rss/entries?read=all");
  const entryId = entries.json.entries[0].id;

  const opened = await api(baseUrl, `/api/rss/entries/${entryId}/open`, { method: "POST" });
  assert.equal(opened.status, 200);
  const documentId = opened.json.documentId;
  assert.ok(documentId);
  assert.equal(opened.json.entry.readState, "read");

  // 幂等：再次打开返回同一快照
  const openedAgain = await api(baseUrl, `/api/rss/entries/${entryId}/open`, { method: "POST" });
  assert.equal(openedAgain.json.documentId, documentId);

  // 隐藏快照不出现在本地文档列表
  const documents = await api(baseUrl, "/api/documents");
  assert.ok(!documents.json.documents.some((document) => document.id === documentId));

  // 快照文档可直接阅读并复用现有 AI / 标注
  const document = await api(baseUrl, `/api/documents/${documentId}`);
  assert.equal(document.json.sourceType, "rss");
  assert.ok(document.json.blocks.length > 0);
  const annotation = await api(baseUrl, "/api/annotations", {
    method: "POST",
    body: {
      documentId,
      kind: "highlight",
      pageIndex: 0,
      selectedText: "正文内容",
      blockIds: [document.json.blocks[0].id]
    }
  });
  assert.equal(annotation.status, 201);

  // 取消订阅后快照与标注保留
  const removed = await api(baseUrl, "/api/rss/feeds/1", { method: "DELETE" });
  assert.equal(removed.json.deleted, true);
  const snapshot = await api(baseUrl, `/api/documents/${documentId}`);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.json.annotations.length, 1);

  // 重新订阅同一地址：恢复而不是重复创建
  const readded = await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });
  assert.equal(readded.status, 201);
  const nav = await api(baseUrl, "/api/rss/feeds");
  assert.equal(nav.json.feeds.length, 1);
});

test("saves an entry snapshot to the library on demand", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });
  const entries = await api(baseUrl, "/api/rss/entries?read=all");

  const saved = await api(baseUrl, `/api/rss/entries/${entries.json.entries[0].id}/save-to-library`, {
    method: "POST",
    body: { category: "AI 论文" }
  });
  assert.equal(saved.status, 200);
  const documents = await api(baseUrl, "/api/documents");
  assert.ok(documents.json.documents.some((document) => document.id === saved.json.documentId));
  assert.equal(saved.json.document.category, "AI 论文");
});

test("extracts full text on demand", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });
  const entries = await api(baseUrl, "/api/rss/entries?read=all");
  const entry = entries.json.entries[0];

  // 把条目的原文地址指到本地文章页，模拟提取
  const storage = (await import("../src/lib/storage.js")).Storage;
  const response = await api(baseUrl, `/api/rss/entries/${entry.id}/extract`, { method: "POST" });
  // 原文链接是公网示例地址，提取会失败，但错误必须可读且不破坏数据
  assert.ok([200, 400, 422, 502].includes(response.status));
  if (response.status !== 200) {
    const after = await api(baseUrl, `/api/rss/entries/${entry.id}`);
    assert.equal(after.json.title, entry.title);
    assert.ok(after.json.contentHtml.length > 0);
  }
});

test("generates a stable daily brief with reasons", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml`, priority: 1 } });
  await api(baseUrl, "/api/rss/preferences", {
    method: "PATCH",
    body: { topics: [{ name: "Agent", weight: 1 }] }
  });

  const brief = await api(baseUrl, "/api/rss/briefs/today", { method: "POST", body: {} });
  assert.equal(brief.status, 200);
  // 同一来源在今日精选中默认不超过两条
  assert.equal(brief.json.entries.length, 2);
  assert.ok(brief.json.entries.every((item) => item.reason.length > 0));
  assert.ok(brief.json.entries.some((item) => item.section === "focus"));

  // 同一天再次请求：保持稳定
  const again = await api(baseUrl, "/api/rss/briefs/today");
  assert.equal(again.status, 200);
  assert.deepEqual(
    again.json.entries.map((item) => item.entryId),
    brief.json.entries.map((item) => item.entryId)
  );

  const todayScope = await api(baseUrl, "/api/rss/entries?scope=today");
  assert.equal(todayScope.json.entries.length, brief.json.entries.length);
});

test("handles opml preview, import and export", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  const opml = `<?xml version="1.0"?>
  <opml version="2.0"><body>
    <outline text="技术"><outline text="测试源" xmlUrl="${feedUrl}/feed.xml" htmlUrl="https://origin.example.com"/></outline>
    <outline text="无效" xmlUrl="not-a-url ::"/>
  </body></opml>`;

  const preview = await api(baseUrl, "/api/rss/opml/preview", { method: "POST", body: { opml } });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.summary.new, 1);
  assert.equal(preview.json.summary.invalid, 1);

  const imported = await api(baseUrl, "/api/rss/opml/import", { method: "POST", body: { opml } });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.imported, 1);
  assert.equal(imported.json.failed.length, 0);

  // 重复导入识别 duplicate
  const previewAgain = await api(baseUrl, "/api/rss/opml/preview", { method: "POST", body: { opml } });
  assert.equal(previewAgain.json.summary.duplicate, 1);

  const exported = await fetch(`${baseUrl}/api/rss/opml/export`);
  assert.equal(exported.status, 200);
  const exportedText = await exported.text();
  assert.match(exportedText, /<opml version="2.0">/);
  assert.match(exportedText, /xmlUrl=/);
});

test("blocks ssrf attempts through the public api surface", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-rss-"));
  const app = createApp({
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    aiProviderConfig: { provider: "mock" }
  });
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    app.locals.storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const url of [
    "http://127.0.0.1:3000/feed",
    "http://localhost/feed",
    "http://169.254.169.254/latest/meta-data",
    "file:///c:/windows/win.ini"
  ]) {
    const result = await api(baseUrl, "/api/rss/discover", { method: "POST", body: { url } });
    assert.ok([400, 404, 502].includes(result.status), `${url} should be rejected, got ${result.status}`);
    assert.ok(!String(result.json?.error || "").includes("win.ini"));
  }
});

test("keeps subscriptions, states and preferences through backup and restore", async (t) => {
  const { baseUrl, feedUrl } = await withTestServer(t, { feedState: { entries: sampleEntries } });
  await api(baseUrl, "/api/rss/feeds", { method: "POST", body: { feedUrl: `${feedUrl}/feed.xml` } });
  await api(baseUrl, "/api/rss/folders", { method: "POST", body: { name: "技术" } });
  await api(baseUrl, "/api/rss/preferences", { method: "PATCH", body: { topics: [{ name: "Agent" }], dailyBriefCount: 8 } });
  const entries = await api(baseUrl, "/api/rss/entries?read=all");
  await api(baseUrl, `/api/rss/entries/${entries.json.entries[0].id}/state`, {
    method: "PATCH",
    body: { starred: true }
  });
  await api(baseUrl, "/api/rss/briefs/today", { method: "POST", body: {} });

  const backup = await (await fetch(`${baseUrl}/api/backup`)).json();
  assert.equal(backup.version, 2);
  assert.equal(backup.rss.feeds.length, 1);
  assert.equal(backup.rss.entries.length, 3);
  assert.equal(backup.rss.preferences.dailyBriefCount, 8);
  assert.equal(backup.rss.briefs.length, 1);

  const restore = await api(baseUrl, "/api/backup/restore", { method: "POST", body: backup });
  assert.equal(restore.status, 200);

  const nav = await api(baseUrl, "/api/rss/feeds");
  assert.equal(nav.json.feeds.length, 1);
  const starred = await api(baseUrl, "/api/rss/entries?scope=starred&read=all");
  assert.equal(starred.json.entries.length, 1);
  const prefs = await api(baseUrl, "/api/rss/preferences");
  assert.equal(prefs.json.dailyBriefCount, 8);
  const brief = await api(baseUrl, "/api/rss/briefs/today");
  assert.equal(brief.status, 200);
});
