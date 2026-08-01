import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDedupeKey,
  detectLanguage,
  estimateReadMinutes,
  hashContent,
  normalizeCanonicalUrl,
  parseDate,
  parseFeed,
  selectCoverImage,
  stripHtml
} from "../src/lib/rss/feedParser.js";

test("parses RSS 2.0 with namespaces, CDATA and entities", () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
      <title>示例频道</title>
      <link>https://example.com/</link>
      <description>示例描述</description>
      <language>zh-cn</language>
      <image><url>https://example.com/icon.png</url></image>
      <item>
        <title>标题 &amp; 副标题</title>
        <link>https://example.com/posts/1?utm_source=feed&amp;id=2</link>
        <guid isPermaLink="false">post-1</guid>
        <dc:creator>张三</dc:creator>
        <pubDate>Wed, 23 Jul 2026 08:30:00 GMT</pubDate>
        <description><![CDATA[<p>这是摘要</p>]]></description>
        <content:encoded><![CDATA[<p>这是<strong>全文</strong>内容</p>]]></content:encoded>
        <enclosure url="https://example.com/cover.jpg" type="image/jpeg"/>
        <category>工程</category>
      </item>
    </channel>
  </rss>`;
  const feed = parseFeed(xml, { feedUrl: "https://example.com/feed.xml" });
  assert.equal(feed.format, "rss");
  assert.equal(feed.title, "示例频道");
  assert.equal(feed.iconUrl, "https://example.com/icon.png");
  assert.equal(feed.entries.length, 1);
  const entry = feed.entries[0];
  assert.equal(entry.title, "标题 & 副标题");
  assert.equal(entry.guid, "post-1");
  assert.equal(entry.author, "张三");
  assert.equal(entry.publishedAt, "2026-07-23T08:30:00.000Z");
  assert.equal(entry.summaryHtml, "<p>这是摘要</p>");
  assert.equal(entry.contentHtml, "<p>这是<strong>全文</strong>内容</p>");
  assert.equal(entry.thumbnailUrl, "https://example.com/cover.jpg");
  assert.equal(entry.canonicalUrl, "https://example.com/posts/1?id=2");
  assert.deepEqual(entry.categories, ["工程"]);
});

test("parses Atom 1.0 entries with alternate link and author", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
    <title>Atom Blog</title>
    <link href="https://blog.example.com/"/>
    <link rel="self" href="https://blog.example.com/atom.xml"/>
    <subtitle>Notes</subtitle>
    <entry>
      <title>Deep Agents</title>
      <link rel="alternate" href="https://blog.example.com/deep-agents"/>
      <id>urn:uuid:1234</id>
      <published>2026-07-22T10:00:00+08:00</published>
      <updated>2026-07-23T10:00:00+08:00</updated>
      <author><name>Alice</name></author>
      <summary>Agent summary</summary>
      <content type="html">&lt;p&gt;Full agent post&lt;/p&gt;</content>
      <category term="Agent"/>
    </entry>
  </feed>`;
  const feed = parseFeed(xml);
  assert.equal(feed.format, "atom");
  assert.equal(feed.siteUrl, "https://blog.example.com/");
  const entry = feed.entries[0];
  assert.equal(entry.link, "https://blog.example.com/deep-agents");
  assert.equal(entry.guid, "urn:uuid:1234");
  assert.equal(entry.author, "Alice");
  assert.equal(entry.publishedAt, "2026-07-22T02:00:00.000Z");
  assert.equal(entry.contentHtml, "<p>Full agent post</p>");
  assert.deepEqual(entry.categories, ["Agent"]);
});

test("rejects DOCTYPE to prevent XXE", () => {
  assert.throws(
    () => parseFeed(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><rss version="2.0"><channel><title>t</title></channel></rss>`),
    /DOCTYPE/
  );
});

test("rejects non-feed XML with a readable error", () => {
  assert.throws(() => parseFeed("<html><body>not a feed</body></html>"), /无法解析/);
});

test("handles RSS without channel item dates and falls back safely", () => {
  const xml = `<rss version="2.0"><channel><title>t</title><item><title>x</title></item></channel></rss>`;
  const feed = parseFeed(xml);
  assert.equal(feed.entries[0].publishedAt, null);
  assert.equal(feed.entries[0].title, "x");
});

test("parses multiple date formats", () => {
  assert.equal(parseDate("Wed, 23 Jul 2026 08:30:00 GMT"), "2026-07-23T08:30:00.000Z");
  assert.equal(parseDate("2026-07-23T08:30:00Z"), "2026-07-23T08:30:00.000Z");
  assert.equal(parseDate("2026-07-23"), "2026-07-23T00:00:00.000Z");
  assert.equal(parseDate("not a date"), null);
  assert.equal(parseDate(""), null);
});

test("normalizes canonical urls by stripping tracking params only", () => {
  assert.equal(
    normalizeCanonicalUrl("https://a.com/p?utm_source=x&utm_medium=y&id=3&fbclid=z#comments"),
    "https://a.com/p?id=3"
  );
  assert.equal(normalizeCanonicalUrl("https://a.com/p?tag=ai&tag=ml"), "https://a.com/p?tag=ai&tag=ml");
  assert.equal(normalizeCanonicalUrl("not a url"), "not a url");
});

test("builds dedupe keys with the documented priority", () => {
  assert.equal(buildDedupeKey({ guid: "g1", canonicalUrl: "https://a.com" }), "guid:g1");
  assert.equal(buildDedupeKey({ guid: "", canonicalUrl: "https://a.com/p" }), "url:https://a.com/p");
  assert.equal(
    buildDedupeKey({ guid: "", canonicalUrl: "", title: "  Hello   World ", publishedAt: "2026-07-23T00:00:00.000Z" }),
    "td:hello world:2026-07-23T00:00:00.000Z"
  );
  assert.match(buildDedupeKey({ title: "x", contentText: "abc" }), /^fp:[0-9a-f]{24}$/);
});

test("hashes content for change detection", () => {
  assert.equal(hashContent("abc"), hashContent("abc"));
  assert.notEqual(hashContent("abc"), hashContent("abd"));
});

test("detects language and estimates reading time", () => {
  assert.equal(detectLanguage("这是一段中文内容，用来测试语言检测。"), "zh");
  assert.equal(detectLanguage("This is plain English text for detection."), "en");
  assert.equal(estimateReadMinutes("字".repeat(800)), 2);
  assert.equal(estimateReadMinutes("word ".repeat(400)), 2);
  assert.equal(estimateReadMinutes(""), 1);
});

test("strips html for search and AI context", () => {
  assert.equal(stripHtml("<p>Hello <strong>world</strong></p><p>第二段</p>"), "Hello world\n第二段");
  assert.equal(stripHtml("<script>alert(1)</script><p>safe</p>"), "safe");
});

test("resolves relative article and thumbnail urls against the feed", () => {
  const parsed = parseFeed(`<?xml version="1.0"?>
    <rss version="2.0"><channel><title>Relative</title>
      <item>
        <guid>relative-1</guid>
        <title>Relative entry</title>
        <link>/posts/1</link>
        <description><![CDATA[<p>Summary</p><img src="/images/cover.jpg">]]></description>
      </item>
    </channel></rss>`, { feedUrl: "https://example.com/news/feed.xml" });

  assert.equal(parsed.entries[0].canonicalUrl, "https://example.com/posts/1");
  assert.equal(parsed.entries[0].thumbnailUrl, "https://example.com/images/cover.jpg");
});

test("selects a large article cover instead of avatars, logos, or tracking pixels", () => {
  const html = `
    <img class="author-avatar" src="/avatar.jpg" width="96" height="96">
    <img src="/tracking.gif" width="1" height="1">
    <img class="article-image" data-src="/cover.webp" width="960" height="540">
    <img src="/portrait.jpg" width="600" height="900">
  `;
  assert.equal(selectCoverImage(html), "/cover.webp");
});

test("supports lazy srcsets and ignores decorative svg images", () => {
  const html = `
    <img src="/brand.svg" alt="brand logo">
    <img data-srcset="/small.jpg 320w, /wide.jpg 1280w" width="1280" height="720">
  `;
  assert.equal(selectCoverImage(html), "/wide.jpg");
});
