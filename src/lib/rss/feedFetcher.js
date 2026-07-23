import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { createSafeLookup, validateRemoteUrl } from "./ssrfGuard.js";

export const FETCH_LIMITS = Object.freeze({
  maxFeedBytes: 5 * 1024 * 1024,
  maxPageBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
  timeoutMs: 15000
});

const USER_AGENT = "WencheReader/1.1 (+local RSS reader)";

/**
 * 抓取远程资源。每次重定向都重新执行 SSRF 校验，
 * 通过自定义 lookup 在连接层拒绝私有 IP，限制大小与超时。
 */
export async function fetchRemote({
  url,
  etag = "",
  lastModified = "",
  maxBytes = FETCH_LIMITS.maxFeedBytes,
  timeoutMs = FETCH_LIMITS.timeoutMs,
  allowPrivateHosts = false,
  accept = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
}) {
  let currentUrl = validateRemoteUrl(url, { allowPrivateHosts }).toString();
  const visited = [];
  for (let redirectCount = 0; redirectCount <= FETCH_LIMITS.maxRedirects; redirectCount += 1) {
    const response = await requestOnce({
      url: currentUrl,
      etag,
      lastModified,
      maxBytes,
      timeoutMs,
      allowPrivateHosts,
      accept
    });
    visited.push(currentUrl);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      const next = new URL(response.headers.location, currentUrl).toString();
      currentUrl = validateRemoteUrl(next, { allowPrivateHosts }).toString();
      continue;
    }
    return { ...response, finalUrl: currentUrl, redirectedFrom: visited.slice(0, -1) };
  }
  throw new FetchError("重定向次数过多", 400);
}

function requestOnce({ url, etag, lastModified, maxBytes, timeoutMs, allowPrivateHosts, accept }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const headers = {
      "user-agent": USER_AGENT,
      accept,
      "accept-encoding": "gzip, deflate, br"
    };
    if (etag) headers["if-none-match"] = etag;
    if (lastModified) headers["if-modified-since"] = lastModified;

    const request = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers,
        lookup: createSafeLookup({ allowPrivateHosts }),
        timeout: timeoutMs
      },
      (response) => {
        const chunks = [];
        let received = 0;
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          response.destroy();
          reject(error);
        };

        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            fail(new FetchError("响应内容超过大小限制", 413));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          const raw = Buffer.concat(chunks);
          let body;
          try {
            body = decompress(raw, response.headers["content-encoding"], maxBytes);
          } catch (error) {
            reject(error);
            return;
          }
          resolve({
            status: response.statusCode,
            headers: normalizeHeaders(response.headers),
            body,
            text: () => body.toString("utf8")
          });
        });
        response.on("error", fail);
      }
    );
    request.on("timeout", () => {
      request.destroy(new FetchError("请求超时", 504));
    });
    request.on("error", (error) => {
      reject(error instanceof FetchError ? error : new FetchError(`网络请求失败：${error.message}`, 502));
    });
    request.end();
  });
}

function decompress(buffer, encoding, maxBytes) {
  const mode = String(encoding || "").toLowerCase();
  const options = { maxOutputLength: maxBytes + 1 };
  let result;
  try {
    if (mode.includes("br")) {
      result = zlib.brotliDecompressSync(buffer, options);
    } else if (mode.includes("gzip")) {
      result = zlib.gunzipSync(buffer, options);
    } else if (mode.includes("deflate")) {
      result = zlib.inflateSync(buffer, options);
    } else {
      result = buffer;
    }
  } catch (error) {
    if (String(error?.message || "").match(/max|large|length|unexpected end/i)) {
      throw new FetchError("解压后内容超过大小限制", 413);
    }
    throw new FetchError(`压缩内容解压失败：${error.message}`, 502);
  }
  if (result.length > maxBytes) {
    throw new FetchError("解压后内容超过大小限制", 413);
  }
  return result;
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
}

export class FetchError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "FetchError";
    this.statusCode = statusCode;
  }
}
