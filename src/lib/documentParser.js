import path from "node:path";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { marked } from "marked";
import { PDFParse } from "pdf-parse";
import sanitizeHtml from "sanitize-html";

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".html", ".htm", ".pdf", ".docx", ".epub"]);
const EPUB_LIMITS = Object.freeze({
  maxEntries: 2000,
  maxHtmlEntries: 500,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxHtmlBytes: 30 * 1024 * 1024,
  maxCompressionRatio: 200
});
const DOCX_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxEntryBytes: 30 * 1024 * 1024,
  maxTotalBytes: 150 * 1024 * 1024,
  maxCompressionRatio: 200
});
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1.docx-title:fresh",
  "p[style-name='标题'] => h1.docx-title:fresh",
  "p[style-name='Subtitle'] => p.docx-subtitle:fresh",
  "p[style-name='副标题'] => p.docx-subtitle:fresh",
  "p[style-name='Quote'] => blockquote.docx-quote:fresh",
  "p[style-name='Intense Quote'] => blockquote.docx-quote:fresh",
  "p[style-name='引用'] => blockquote.docx-quote:fresh",
  "p[style-name='Caption'] => p.docx-caption:fresh",
  "p[style-name='题注'] => p.docx-caption:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
  "u => span.docx-underline",
  "strike => del"
];

export function isSupportedFile(originalName) {
  return SUPPORTED_EXTENSIONS.has(path.extname(originalName).toLowerCase());
}

export async function parseDocumentBuffer({ originalName, buffer }) {
  const extension = path.extname(originalName).toLowerCase();
  if (!isSupportedFile(originalName)) {
    throw new Error(`Unsupported file type: ${extension || "unknown"}`);
  }

  if (extension === ".html" || extension === ".htm") {
    return parseHtml(originalName, buffer.toString("utf8"), {
      preserveDocumentLayout: true
    });
  }

  if (extension === ".md" || extension === ".markdown") {
    return parseMarkdown(originalName, buffer.toString("utf8"));
  }

  if (extension === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsePlainText(originalName, parsed.text || "");
    } finally {
      await parser.destroy();
    }
  }

  if (extension === ".docx") {
    validateZipEntries(new AdmZip(buffer).getEntries(), "DOCX", DOCX_LIMITS);
    const parsed = await mammoth.convertToHtml(
      { buffer },
      { styleMap: DOCX_STYLE_MAP, includeDefaultStyleMap: true }
    );
    return parseHtml(originalName, parsed.value || "");
  }

  if (extension === ".epub") {
    return parseEpub(originalName, buffer);
  }

  return parsePlainText(originalName, buffer.toString("utf8"));
}

function parsePlainText(originalName, text) {
  const blocks = splitParagraphs(text).map((paragraph, index) => ({
    type: "paragraph",
    text: paragraph,
    position: index
  }));

  return {
    title: path.basename(originalName),
    blocks
  };
}

function parseMarkdown(originalName, markdown) {
  return parseHtml(originalName, marked.parse(markdown));
}

function parseHtml(originalName, html, options = {}) {
  const sanitizedHtml = sanitizeHtml(html, {
    allowedTags: [
      "article",
      "section",
      "main",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "blockquote",
      "ul",
      "ol",
      "li",
      "span",
      "strong",
      "em",
      "b",
      "i",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "br",
      "pre",
      "code",
      "hr",
      "a",
      "img",
      "del",
      "sub",
      "sup"
    ],
    allowedAttributes: {
      "*": ["class"],
      a: ["href", "title", "class"],
      img: ["src", "alt", "title", "width", "height", "class"],
      ol: ["start", "class"],
      li: ["value", "class"],
      th: ["colspan", "rowspan", "scope", "class"],
      td: ["colspan", "rowspan", "class"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["data"]
    },
    disallowedTagsMode: "discard"
  });

  const blocks = extractHtmlBlocks(sanitizedHtml);
  return {
    title: firstHeading(blocks) || titleTag(html) || path.basename(originalName),
    blocks,
    sanitizedHtml,
    renderHtml: options.preserveDocumentLayout ? sanitizeLayoutDocument(html) : ""
  };
}

function parseEpub(originalName, buffer) {
  const zip = new AdmZip(buffer);
  const allEntries = zip.getEntries();
  validateEpubEntries(allEntries);
  const entries = allEntries
    .filter((entry) => /\.(xhtml|html|htm)$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  if (entries.length === 0) {
    throw new Error("EPUB does not contain readable HTML content");
  }
  if (entries.length > EPUB_LIMITS.maxHtmlEntries) {
    throw new Error(`EPUB contains more than ${EPUB_LIMITS.maxHtmlEntries} HTML documents`);
  }

  const blocks = [];
  let title = path.basename(originalName);
  let htmlBytes = 0;

  for (const entry of entries) {
    const data = entry.getData();
    htmlBytes += data.length;
    if (data.length > EPUB_LIMITS.maxEntryBytes || htmlBytes > EPUB_LIMITS.maxHtmlBytes) {
      throw new Error("EPUB HTML content exceeds the safe parsing limit");
    }
    const parsed = parseHtml(entry.entryName, data.toString("utf8"));
    if (title === path.basename(originalName) && firstHeading(parsed.blocks)) {
      title = firstHeading(parsed.blocks);
    }
    for (const block of parsed.blocks) {
      blocks.push({ ...block, position: blocks.length });
    }
  }

  return { title, blocks };
}

function validateEpubEntries(entries) {
  validateZipEntries(entries, "EPUB", EPUB_LIMITS);
}

function validateZipEntries(entries, label, limits) {
  if (entries.length > limits.maxEntries) {
    throw new Error(`${label} contains more than ${limits.maxEntries} files`);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    const uncompressedSize = Number(entry.header?.size || 0);
    const compressedSize = Number(entry.header?.compressedSize || 0);
    totalBytes += uncompressedSize;

    if (uncompressedSize > limits.maxEntryBytes) {
      throw new Error(`${label} contains an oversized compressed entry`);
    }
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(`${label} uncompressed content exceeds the safe parsing limit`);
    }
    if (
      compressedSize > 0 &&
      uncompressedSize > 1024 * 1024 &&
      uncompressedSize / compressedSize > limits.maxCompressionRatio
    ) {
      throw new Error(`${label} contains a suspicious compression ratio`);
    }
  }
}

function extractHtmlBlocks(html) {
  const blocks = [];
  const blockPattern = /<(table|ul|ol|pre|blockquote|h[1-6]|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockPattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const content = match[3];
    const text = cleanText(htmlToText(content)) || imageDescription(content);
    if (!text) continue;
    blocks.push({
      type: blockType(tag),
      text,
      html: `<${tag}${match[2]}>${content}</${tag}>`,
      position: blocks.length
    });
  }

  if (blocks.length === 0) {
    for (const paragraph of splitParagraphs(htmlToText(html))) {
      blocks.push({ type: "paragraph", text: paragraph, position: blocks.length });
    }
  }

  return blocks;
}

function imageDescription(html) {
  if (!/<img\b/i.test(html)) return "";
  const altText = [...html.matchAll(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)]
    .map((match) => cleanText(match[1] || match[2] || ""))
    .filter(Boolean)
    .join(" ");
  return altText || "图片";
}

function splitParagraphs(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(cleanText)
    .filter(Boolean);
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/(p|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function blockType(tag) {
  if (tag.startsWith("h")) return "heading";
  if (tag === "table") return "table";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "blockquote") return "quote";
  if (tag === "pre") return "code";
  return "paragraph";
}

function sanitizeLayoutDocument(html) {
  const cssSanitizedHtml = String(html || "").replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (_match, css) => `<style>${sanitizeCss(css)}</style>`
  );

  const sanitized = sanitizeHtml(cssSanitizedHtml, {
    // Styles render only inside a script-disabled sandboxed iframe.
    allowVulnerableTags: true,
    allowedTags: [
      "html", "head", "body", "meta", "title", "style",
      "main", "article", "section", "header", "footer", "nav",
      "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "blockquote", "ul", "ol", "li", "strong", "em", "b", "i",
      "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot",
      "tr", "th", "td", "br", "hr", "pre", "code", "a", "img",
      "del", "sub", "sup", "small", "mark"
    ],
    allowedAttributes: {
      "*": ["class", "id", "role", "aria-label"],
      meta: ["charset", "name", "content"],
      a: ["href", "title", "class", "id"],
      img: ["src", "alt", "title", "width", "height", "class", "id"],
      th: ["colspan", "rowspan", "scope", "class", "id"],
      td: ["colspan", "rowspan", "class", "id"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer"
      }, true)
    },
    disallowedTagsMode: "discard"
  });

  return sanitized.includes("<html")
    ? sanitized
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${sanitized}</body></html>`;
}

function sanitizeCss(css) {
  return String(css || "")
    .replace(/@import[\s\S]*?;/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:behavior|-moz-binding)\s*:[^;}]+;?/gi, "");
}

function cleanText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function firstHeading(blocks) {
  return blocks.find((block) => block.type === "heading")?.text;
}

function titleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(htmlToText(match[1])) : "";
}
