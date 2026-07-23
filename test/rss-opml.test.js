import assert from "node:assert/strict";
import test from "node:test";
import { buildOpml, classifyOpmlItems, normalizeFeedUrl, parseOpml } from "../src/lib/rss/opml.js";

test("parses OPML with nested folders", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <opml version="2.0">
    <head><title>我的订阅</title></head>
    <body>
      <outline text="技术" title="技术">
        <outline text="阮一峰" title="阮一峰" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com"/>
      </outline>
      <outline text="独立订阅" title="独立订阅" type="rss" xmlUrl="https://blog.example.com/atom.xml"/>
    </body>
  </opml>`;
  const { title, items } = parseOpml(xml);
  assert.equal(title, "我的订阅");
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: "阮一峰",
    feedUrl: "https://example.com/feed.xml",
    siteUrl: "https://example.com",
    folderName: "技术"
  });
  assert.equal(items[1].folderName, "");
});

test("rejects non-opml content", () => {
  assert.throws(() => parseOpml("<rss version='2.0'></rss>"), /OPML/);
});

test("classifies items against existing subscriptions", () => {
  const existing = new Map([
    ["https://a.com/feed.xml", { deletedAt: null }],
    ["https://b.com/feed.xml", { deletedAt: "2026-07-01T00:00:00.000Z" }]
  ]);
  const classified = classifyOpmlItems(
    [
      { title: "new", feedUrl: "https://c.com/feed.xml" },
      { title: "dup", feedUrl: "https://a.com/feed.xml" },
      { title: "again", feedUrl: "https://b.com/feed.xml" },
      { title: "bad", feedUrl: "not a url ::" },
      { title: "file", feedUrl: "file:///etc/passwd" }
    ],
    existing
  );
  assert.deepEqual(classified.map((item) => item.status), [
    "new",
    "duplicate",
    "reenable",
    "invalid",
    "unsupported"
  ]);
});

test("normalizes feed urls for comparison", () => {
  assert.equal(normalizeFeedUrl("https://A.com:443/feed#x"), "https://a.com/feed");
  assert.equal(normalizeFeedUrl("http://a.com:8080/feed"), "http://a.com:8080/feed");
});

test("exports opml grouped by folders and escapes attributes", () => {
  const opml = buildOpml({
    folders: [{ id: 1, name: 'Tech "技术"' }],
    feeds: [
      { id: 1, folderId: 1, title: "A & B", feedUrl: "https://a.com/feed?x=1&y=2", siteUrl: "https://a.com" },
      { id: 2, folderId: null, title: "Solo", feedUrl: "https://b.com/feed", siteUrl: "" }
    ]
  });
  assert.match(opml, /<opml version="2.0">/);
  assert.match(opml, /text="Tech &quot;技术&quot;"/);
  assert.match(opml, /title="A &amp; B"/);
  assert.match(opml, /xmlUrl="https:\/\/a\.com\/feed\?x=1&amp;y=2"/);

  const roundTrip = parseOpml(opml);
  assert.equal(roundTrip.items.length, 2);
  const grouped = roundTrip.items.find((item) => item.title === "A & B");
  assert.equal(grouped.folderName, 'Tech "技术"');
  assert.equal(grouped.feedUrl, "https://a.com/feed?x=1&y=2");
});
