import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchRemote, FETCH_LIMITS } from "./feedFetcher.js";

const PROXY_PATH = "/api/rss/images";
const IMAGE_TYPES = Object.freeze([
  { extension: ".jpg", contentType: "image/jpeg", matches: isJpeg },
  { extension: ".png", contentType: "image/png", matches: isPng },
  { extension: ".gif", contentType: "image/gif", matches: isGif },
  { extension: ".webp", contentType: "image/webp", matches: isWebp },
  { extension: ".avif", contentType: "image/avif", matches: isAvif },
  { extension: ".bmp", contentType: "image/bmp", matches: isBmp },
  { extension: ".ico", contentType: "image/x-icon", matches: isIcon }
]);

export function toRssImageProxyPath(value, { baseUrl = "" } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith(`${PROXY_PATH}?`)) return raw;
  if (/^data:image\//i.test(raw)) return raw;

  try {
    const resolved = new URL(raw, baseUrl || undefined);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return "";
    return `${PROXY_PATH}?url=${encodeURIComponent(resolved.toString())}`;
  } catch {
    return "";
  }
}

export function hasBrokenArticleImages(html) {
  return [...String(html || "").matchAll(/<img\b[^>]*>/gi)]
    .some((match) => !/\bsrc\s*=\s*["'][^"']+["']/i.test(match[0]));
}

export class RssImageCache {
  constructor({
    cacheDir,
    fetchImpl = fetchRemote,
    allowPrivateHosts = false
  }) {
    this.cacheDir = path.resolve(cacheDir);
    this.fetchImpl = fetchImpl;
    this.allowPrivateHosts = allowPrivateHosts;
    this.pending = new Map();
  }

  async get(remoteUrl) {
    let url;
    try {
      url = new URL(String(remoteUrl || "").trim());
    } catch {
      throw new ImageProxyError("图片地址格式无效", 400);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ImageProxyError("图片地址仅支持 http 或 https", 400);
    }
    const key = createHash("sha256").update(url.toString()).digest("hex");
    const cached = await this.findCached(key);
    if (cached) return cached;
    if (this.pending.has(key)) return this.pending.get(key);

    const task = this.fetchAndCache(url.toString(), key).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, task);
    return task;
  }

  async findCached(key) {
    for (const type of IMAGE_TYPES) {
      const filePath = path.join(this.cacheDir, `${key}${type.extension}`);
      try {
        await access(filePath);
        return { filePath, contentType: type.contentType, cached: true };
      } catch {
        // 继续检查其他受支持格式
      }
    }
    return null;
  }

  async fetchAndCache(url, key) {
    let response;
    try {
      response = await this.fetchImpl({
        url,
        maxBytes: FETCH_LIMITS.maxImageBytes,
        allowPrivateHosts: this.allowPrivateHosts,
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/x-icon"
      });
    } catch (error) {
      throw new ImageProxyError(error.message, error.statusCode || 502);
    }
    if (response.status >= 400) {
      throw new ImageProxyError(`远程图片返回错误（HTTP ${response.status}）`, 502);
    }

    const type = IMAGE_TYPES.find((candidate) => candidate.matches(response.body));
    if (!type) {
      throw new ImageProxyError("远程资源不是受支持的图片格式", 415);
    }

    await mkdir(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, `${key}${type.extension}`);
    await writeFile(filePath, response.body);
    return { filePath, contentType: type.contentType, cached: false };
  }
}

export class ImageProxyError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "ImageProxyError";
    this.statusCode = statusCode;
  }
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isGif(buffer) {
  return buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
}

function isWebp(buffer) {
  return buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function isAvif(buffer) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buffer.subarray(8, 12).toString("ascii");
  return brand === "avif" || brand === "avis";
}

function isBmp(buffer) {
  return buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM";
}

function isIcon(buffer) {
  return buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    (buffer[2] === 0x01 || buffer[2] === 0x02) &&
    buffer[3] === 0x00;
}
