import crypto from "node:crypto";

/**
 * RSS 2.0 / Atom 1.0 解析与规范化。
 * 使用自带的安全 XML 解析器：拒绝 DOCTYPE，不展开外部实体，
 * 天然规避 XXE 与实体炸弹。
 */

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "gclid", "fbclid", "dclid", "gbraid", "wbraid",
  "mc_cid", "mc_eid", "igshid", "spm", "ref", "ref_src"
]);

export function parseFeed(xml, { feedUrl = "" } = {}) {
  const text = String(xml || "").replace(/^﻿/, "");
  const root = parseXml(text);
  const name = localName(root.name).toLowerCase();
  if (name === "rss" || name === "rdf") {
    return parseRss(root, feedUrl);
  }
  if (name === "feed") {
    return parseAtom(root, feedUrl);
  }
  throw new FeedParseError("来源返回的内容格式无法解析");
}

function parseRss(root, feedUrl) {
  const channel = findChild(root, "channel") || (localName(root.name).toLowerCase() === "rdf" ? root : null);
  if (!channel) throw new FeedParseError("来源返回的内容格式无法解析");

  const isRdf = localName(root.name).toLowerCase() === "rdf";
  const itemSource = isRdf ? root : channel;
  const entries = findChildren(itemSource, "item").map((item) => {
    const guidNode = findChild(item, "guid");
    const link = childText(item, "link");
    const guid = textOf(guidNode) || "";
    const contentNode = findChild(item, "encoded") || findChild(item, "content");
    const descriptionNode = findChild(item, "description");
    const categories = findChildren(item, "category").map(textOf).filter(Boolean);
    return {
      guid,
      link: link || (guidNode?.attrs?.ispermalink === "true" ? guid : ""),
      title: childText(item, "title") || "(无标题)",
      author: childText(item, "creator") || childText(item, "author") || "",
      publishedAt: parseDate(childText(item, "pubDate") || childText(item, "date")),
      summaryHtml: textOf(descriptionNode) || "",
      contentHtml: textOf(contentNode) || "",
      thumbnailUrl: findRssThumbnail(item),
      categories
    };
  });

  return {
    format: "rss",
    title: childText(channel, "title") || feedUrl,
    siteUrl: childText(channel, "link"),
    description: childText(channel, "description"),
    iconUrl: textOf(findChild(findChild(channel, "image"), "url")),
    language: childText(channel, "language"),
    entries: entries.map((entry) => normalizeEntry(entry, feedUrl))
  };
}

function parseAtom(root, feedUrl) {
  const alternateLink = (node) => {
    const links = findChildren(node, "link");
    const alternate = links.find((link) => !link.attrs.rel || link.attrs.rel === "alternate");
    return (alternate || links[0])?.attrs?.href || "";
  };

  const entries = findChildren(root, "entry").map((entry) => {
    const contentNode = findChild(entry, "content");
    const summaryNode = findChild(entry, "summary");
    const authorNode = findChild(entry, "author");
    return {
      guid: childText(entry, "id"),
      link: alternateLink(entry),
      title: childText(entry, "title") || "(无标题)",
      author: childText(authorNode, "name") || childText(entry, "author"),
      publishedAt: parseDate(childText(entry, "published") || childText(entry, "updated")),
      summaryHtml: textOf(summaryNode) || "",
      contentHtml: textOf(contentNode) || "",
      thumbnailUrl: findAtomThumbnail(entry),
      categories: findChildren(entry, "category").map((node) => node.attrs?.term || "").filter(Boolean)
    };
  });

  return {
    format: "atom",
    title: childText(root, "title") || feedUrl,
    siteUrl: alternateLink(root),
    description: childText(root, "subtitle"),
    iconUrl: childText(root, "icon") || childText(root, "logo"),
    language: root.attrs?.["xml:lang"] || "",
    entries: entries.map((entry) => normalizeEntry(entry, feedUrl))
  };
}

function normalizeEntry(entry, feedUrl) {
  const link = absolutizeUrl(entry.link, feedUrl);
  const canonicalUrl = link ? normalizeCanonicalUrl(link) : "";
  const rawText = stripHtml(entry.contentHtml || entry.summaryHtml);
  return {
    ...entry,
    link,
    canonicalUrl,
    title: entry.title.replace(/\s+/g, " ").trim() || "(无标题)",
    language: detectLanguage(rawText),
    estimatedReadMinutes: estimateReadMinutes(rawText),
    textPreview: rawText.slice(0, 200000)
  };
}

export function buildDedupeKey({ guid, canonicalUrl, title, publishedAt, contentText }) {
  if (guid) return `guid:${guid}`;
  if (canonicalUrl) return `url:${canonicalUrl}`;
  const normalizedTitle = String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedTitle && publishedAt) return `td:${normalizedTitle}:${publishedAt}`;
  const fingerprint = crypto.createHash("sha256").update(String(contentText || normalizedTitle)).digest("hex").slice(0, 24);
  return `fp:${fingerprint}`;
}

export function hashContent(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

export function normalizeCanonicalUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function absolutizeUrl(value, base) {
  if (!value) return "";
  try {
    return new URL(value, base || undefined).toString();
  } catch {
    return "";
  }
}

export function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  // RFC 822 变体：单日数字、缩写时区等
  const rfcLike = trimmed.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (rfcLike) {
    const retry = new Date(`${rfcLike[1]} ${rfcLike[2]} ${rfcLike[3]} ${rfcLike[4]}:${rfcLike[5]}:${rfcLike[6] || "00"} UTC`);
    if (!Number.isNaN(retry.getTime())) return retry.toISOString();
  }
  return null;
}

export function detectLanguage(text) {
  const sample = String(text || "").slice(0, 2000);
  if (!sample) return "";
  const cjk = (sample.match(/[぀-ヿ一-鿿가-힯]/g) || []).length;
  return cjk / sample.length > 0.15 ? "zh" : "en";
}

export function estimateReadMinutes(text) {
  const value = String(text || "");
  if (!value.trim()) return 1;
  const cjk = (value.match(/[぀-ヿ一-鿿가-힯]/g) || []).length;
  const latinWords = (value.replace(/[぀-ヿ一-鿿가-힯]/g, " ").match(/\S+/g) || []).length;
  const minutes = cjk / 400 + latinWords / 200;
  return Math.max(1, Math.round(minutes));
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|tr|h[1-6]|blockquote|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function findRssThumbnail(item) {
  const media = ["thumbnail", "content"].map((name) => findChild(item, name)).find(Boolean);
  if (media?.attrs?.url && String(media.attrs.url).match(/\.(png|jpe?g|gif|webp|avif)(\?|$)/i)) {
    return media.attrs.url;
  }
  const enclosure = findChildren(item, "enclosure").find((node) =>
    String(node.attrs?.type || "").startsWith("image/")
  );
  if (enclosure?.attrs?.url) return enclosure.attrs.url;
  const html = childText(item, "encoded") || childText(item, "description") || "";
  return html.match(/<img[^>]+\bsrc=["']([^"']+)["']/i)?.[1] || "";
}

function findAtomThumbnail(entry) {
  const link = findChildren(entry, "link").find((node) =>
    ["enclosure", "icon"].includes(node.attrs?.rel) && String(node.attrs?.type || "").startsWith("image/")
  );
  if (link?.attrs?.href) return link.attrs.href;
  const html = childText(entry, "content") || childText(entry, "summary") || "";
  return html.match(/<img[^>]+\bsrc=["']([^"']+)["']/i)?.[1] || "";
}

// ---------- 安全 XML 解析 ----------

export function parseXml(input) {
  if (/<!DOCTYPE/i.test(input)) {
    throw new FeedParseError("出于安全原因，不接受包含 DOCTYPE 的 XML");
  }
  const rootNode = { name: "", attrs: {}, children: [], text: "" };
  const stack = [rootNode];
  let index = 0;
  const length = input.length;

  while (index < length) {
    if (input.startsWith("<!--", index)) {
      const end = input.indexOf("-->", index + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", index)) {
      const end = input.indexOf("]]>", index + 9);
      const cdata = end === -1 ? input.slice(index + 9) : input.slice(index + 9, end);
      stack[stack.length - 1].text += cdata;
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (input.startsWith("<?", index)) {
      const end = input.indexOf("?>", index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }
    if (input.startsWith("</", index)) {
      const end = input.indexOf(">", index + 2);
      const rawName = input.slice(index + 2, end === -1 ? length : end).trim();
      closeElement(stack, rawName);
      index = end === -1 ? length : end + 1;
      continue;
    }
    if (input[index] === "<") {
      const tagEnd = findTagEnd(input, index + 1);
      if (tagEnd === -1) break;
      const rawTag = input.slice(index + 1, tagEnd);
      const selfClosing = rawTag.endsWith("/");
      const { name, attrs } = parseTag(selfClosing ? rawTag.slice(0, -1) : rawTag);
      if (name) {
        const node = { name, attrs, children: [], text: "" };
        stack[stack.length - 1].children.push(node);
        if (!selfClosing) stack.push(node);
      }
      index = tagEnd + 1;
      continue;
    }
    const nextTag = input.indexOf("<", index);
    const textChunk = input.slice(index, nextTag === -1 ? length : nextTag);
    stack[stack.length - 1].text += decodeEntities(textChunk);
    index = nextTag === -1 ? length : nextTag;
  }

  if (rootNode.children.length === 0) {
    throw new FeedParseError("来源返回的内容格式无法解析");
  }
  return rootNode.children[0];
}

function findTagEnd(input, start) {
  let quote = "";
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function parseTag(raw) {
  const nameMatch = raw.match(/^([^\s/>]+)/);
  if (!nameMatch) return { name: "", attrs: {} };
  const name = nameMatch[1];
  const attrs = {};
  const attrPattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrPattern.exec(raw))) {
    attrs[decodeEntities(match[1]).toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return { name, attrs };
}

function closeElement(stack, rawName) {
  const name = rawName.toLowerCase();
  for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
    if (stack[depth].name.toLowerCase() === name) {
      stack.length = depth;
      return;
    }
  }
  // 未匹配的结束标签：忽略，保持容错
}

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const codePoint = entity[1].toLowerCase() === "x"
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

// ---------- 树查询工具 ----------

function localName(name) {
  const value = String(name || "");
  const colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(colon + 1);
}

export function findChild(node, name) {
  if (!node) return null;
  const wanted = name.toLowerCase();
  return node.children.find((child) => localName(child.name).toLowerCase() === wanted) || null;
}

export function findChildren(node, name) {
  if (!node) return [];
  const wanted = name.toLowerCase();
  return node.children.filter((child) => localName(child.name).toLowerCase() === wanted);
}

export function textOf(node) {
  if (!node) return "";
  const childTextValue = node.children.map((child) => textOf(child)).join("");
  return (node.text + childTextValue).trim();
}

function childText(node, name) {
  return textOf(findChild(node, name));
}

export class FeedParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedParseError";
    this.statusCode = 422;
  }
}
