import { findChild, findChildren, parseXml, textOf } from "./feedParser.js";

/**
 * OPML 1.0/2.0 解析、预览分类与导出。
 */

export function parseOpml(xml) {
  const root = parseXml(String(xml || ""));
  if (root.name.toLowerCase() !== "opml") {
    throw new OpmlError("不是有效的 OPML 文件");
  }
  const body = findChild(root, "body");
  if (!body) throw new OpmlError("OPML 缺少 body 节点");

  const items = [];
  const walk = (node, folderName) => {
    for (const outline of findChildren(node, "outline")) {
      const xmlUrl = outline.attrs?.xmlurl || outline.attrs?.xml_url || "";
      if (xmlUrl) {
        items.push({
          title: outline.attrs?.title || outline.attrs?.text || xmlUrl,
          feedUrl: xmlUrl,
          siteUrl: outline.attrs?.htmlurl || outline.attrs?.html_url || "",
          folderName: folderName || ""
        });
      } else {
        // 无 xmlUrl 的 outline 视为分组
        const name = outline.attrs?.title || outline.attrs?.text || "";
        walk(outline, name || folderName);
      }
    }
  };
  walk(body, "");
  return { title: textOf(findChild(findChild(root, "head"), "title")) || "", items };
}

export function classifyOpmlItems(items, existingFeedsByUrl) {
  return items.map((item) => {
    let status = "new";
    let reason = "";
    try {
      const url = new URL(item.feedUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        status = "unsupported";
        reason = "仅支持 http/https 订阅地址";
      }
    } catch {
      status = "invalid";
      reason = "订阅地址格式无效";
    }
    if (status === "new") {
      const existing = existingFeedsByUrl.get(normalizeFeedUrl(item.feedUrl));
      if (existing) {
        status = existing.deletedAt ? "reenable" : "duplicate";
      }
    }
    return { ...item, status, reason };
  });
}

export function normalizeFeedUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return String(value || "").trim();
  }
}

export function buildOpml({ title = "文澈阅读订阅", folders, feeds }) {
  const escape = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const feedOutline = (feed, indent) =>
    `${indent}<outline text="${escape(feed.title)}" title="${escape(feed.title)}" type="rss" xmlUrl="${escape(feed.feedUrl)}" htmlUrl="${escape(feed.siteUrl)}"/>`;

  const lines = [];
  const grouped = new Map();
  for (const feed of feeds) {
    const key = feed.folderId ?? 0;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(feed);
  }

  for (const feed of grouped.get(0) || []) {
    lines.push(feedOutline(feed, "    "));
  }
  for (const folder of folders) {
    lines.push(`    <outline text="${escape(folder.name)}" title="${escape(folder.name)}">`);
    for (const feed of grouped.get(folder.id) || []) {
      lines.push(feedOutline(feed, "      "));
    }
    lines.push("    </outline>");
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escape(title)}</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    "  </head>",
    "  <body>",
    ...lines,
    "  </body>",
    "</opml>",
    ""
  ].join("\n");
}

export class OpmlError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpmlError";
    this.statusCode = 400;
  }
}
