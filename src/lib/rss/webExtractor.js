import { fetchRemote, FETCH_LIMITS } from "./feedFetcher.js";
import { sanitizeArticleHtml } from "../documentParser.js";

/**
 * 按需网页正文提取（Readability 轻量实现）：
 * 仅在用户打开文章并请求提取全文时执行，不做后台批量抓取。
 */
export async function extractFullText(url, { allowPrivateHosts = false } = {}) {
  const response = await fetchRemote({
    url,
    maxBytes: FETCH_LIMITS.maxPageBytes,
    allowPrivateHosts,
    accept: "text/html,application/xhtml+xml,*/*"
  });
  if (response.status >= 400) {
    throw new ExtractError(`原网页返回错误（HTTP ${response.status}）`);
  }
  const html = response.text();
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  const mainHtml = pickMainContent(html);
  const cleaned = sanitizeArticleHtml(mainHtml);
  if (!cleaned || cleaned.replace(/<[^>]+>/g, "").trim().length < 40) {
    throw new ExtractError("未能从原网页提取到有效正文");
  }
  return { title: decodeBasicEntities(pageTitle), contentHtml: cleaned };
}

function pickMainContent(html) {
  const stripped = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "");

  // 优先 <article>，其次 <main>，最后按段落密度选择最大容器
  for (const tag of ["article", "main"]) {
    const match = stripped.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (match && textLength(match[1]) > 200) return match[1];
  }

  let best = "";
  let bestScore = 200;
  const containerPattern = /<(div|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = containerPattern.exec(stripped))) {
    const score = paragraphScore(match[2]);
    if (score > bestScore) {
      bestScore = score;
      best = match[2];
    }
  }
  if (best) return best;

  const bodyMatch = stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : stripped;
}

function paragraphScore(html) {
  let score = 0;
  const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = paragraphPattern.exec(html))) {
    const length = textLength(match[1]);
    if (length > 40) score += length;
  }
  return score;
}

function textLength(html) {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
}

function decodeBasicEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export class ExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractError";
    this.statusCode = 422;
  }
}
