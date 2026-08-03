import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

const root = await mkdtemp(path.join(tmpdir(), "wenche-e2e-"));
const app = createApp({
  dataDir: path.join(root, "data"),
  uploadDir: path.join(root, "uploads"),
  aiProviderConfig: { provider: "mock" },
  rss: { allowPrivateHosts: true }
});
const server = app.listen(4173, "127.0.0.1", () => {
  console.log("Wenche E2E server running at http://127.0.0.1:4173");
});

// 固定测试 Feed 服务：供 e2e 订阅流程使用
const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>E2E 测试源</title>
    <link>http://127.0.0.1:4199/</link>
    <description>端到端测试频道</description>
    <item>
      <title>Agent 工程实践案例</title>
      <link>http://127.0.0.1:4199/posts/1</link>
      <guid>e2e-post-1</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<p>关于 Agent 工程的摘要。</p>]]></description>
      <content:encoded><![CDATA[<p>Agent 工程实践的正文。它讨论了工具调用、上下文管理与评估方法，包含足够的内容用于分页与划词解析测试。</p><p>第二个段落讨论深入解析所需的上下文关系与概念背景，并补充任务拆分、结果校验、失败恢复和人工确认等工程环节，确保测试资讯具备可进入今日精选的完整正文。</p>]]></content:encoded>
    </item>
    <item>
      <title>向量数据库实践</title>
      <link>http://127.0.0.1:4199/posts/2</link>
      <guid>e2e-post-2</guid>
      <pubDate>${new Date(Date.now() - 3600000).toUTCString()}</pubDate>
      <description><![CDATA[<p>向量数据库摘要。</p>]]></description>
      <content:encoded><![CDATA[<p>向量数据库实践的正文内容，介绍索引构建、相似度检索、数据更新和召回评估。</p><p>文章进一步比较不同数据规模下的延迟与准确率，并说明如何通过过滤条件、分片策略和离线评测改善真实应用中的检索质量。</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const feedServer = http.createServer((req, res) => {
  if (req.url === "/feed.xml") {
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(feedXml);
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<html><head><title>E2E 站点</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>site</body></html>');
    return;
  }
  res.writeHead(404);
  res.end("not found");
});
feedServer.listen(4199, "127.0.0.1");

async function close() {
  await new Promise((resolve) => feedServer.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  app.locals.storage.close();
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
