import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

const VENDOR_FILES = Object.freeze({
  "/vendor/marked.min.js": ["marked", "lib", "marked.umd.js"],
  "/vendor/purify.min.js": ["dompurify", "dist", "purify.min.js"],
  "/vendor/jszip.min.js": ["jszip", "dist", "jszip.min.js"],
  "/vendor/docx-preview.min.js": [
    "docx-preview",
    "dist",
    "docx-preview.min.js"
  ]
});

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
});

const DESKTOP_CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "origin",
  "referer",
  "cookie",
  "authorization",
  "x-wenche-session"
]);

export function registerAppScheme() {
  const { protocol } = require("electron");
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true
      }
    }
  ]);
}

export async function installAppProtocol({
  session,
  appRoot,
  backendOrigin,
  sessionToken
}) {
  const { net } = require("electron");
  const handler = createProtocolHandler({
    appRoot,
    backendOrigin,
    sessionToken,
    fetchImpl: (url, init) => net.fetch(url, init)
  });
  session.protocol.handle("app", handler);
  return () => {
    session.protocol.unhandle("app");
  };
}

export function uninstallAppProtocol({ session }) {
  session.protocol.unhandle("app");
}

export function createProtocolHandler({
  appRoot,
  backendOrigin,
  sessionToken,
  fetchImpl
}) {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "app:" || url.host !== "wenche") {
        return new Response("Not Found", { status: 404 });
      }
      const pathname = decodePathname(url.pathname);

      if (pathname === "/desktop-error.html") {
        return await serveFile(path.join(appRoot, "desktop", "error.html"));
      }
      if (pathname === "/desktop-error.js") {
        return await serveFile(path.join(appRoot, "desktop", "error.js"));
      }
      if (pathname.startsWith("/api/")) {
        return await proxyApi(request, url, pathname, {
          backendOrigin,
          sessionToken,
          fetchImpl
        });
      }
      if (pathname.startsWith("/vendor/")) {
        const relative = VENDOR_FILES[pathname];
        if (!relative) return new Response("Not Found", { status: 404 });
        return await serveFile(path.join(appRoot, "node_modules", ...relative));
      }
      return await servePublic(appRoot, pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
  };
}

function decodePathname(rawPathname) {
  const decoded = decodeURIComponent(rawPathname);
  if (!decoded.startsWith("/")) throw new Error("invalid path");
  if (/[\u0000\\]/.test(decoded)) throw new Error("invalid path");
  if (/^[a-zA-Z]:/.test(decoded)) throw new Error("invalid path");
  const segments = decoded.split("/");
  if (
    segments.includes("..") ||
    segments.some((segment) => segment.includes("%"))
  ) {
    throw new Error("invalid path");
  }
  return decoded;
}

function resolveWithin(root, relative) {
  const target = path.resolve(root, "." + relative);
  const relativeToRoot = path.relative(root, target);
  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("outside root");
  }
  return target;
}

async function servePublic(appRoot, pathname) {
  const relative = pathname === "/" ? "/index.html" : pathname;
  return serveFile(resolveWithin(path.join(appRoot, "public"), relative));
}

async function serveFile(filePath) {
  let content;
  try {
    content = await readFile(filePath);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    "content-type": MIME_TYPES[extension] || "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  };
  if (extension === ".html") headers["content-security-policy"] = DESKTOP_CSP;
  return new Response(content, { status: 200, headers });
}

async function proxyApi(request, url, pathname, { backendOrigin, sessionToken, fetchImpl }) {
  if (!backendOrigin) return new Response("Service Unavailable", { status: 503 });
  const target = `${backendOrigin}${pathname}${url.search}`;
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower) || lower.startsWith("proxy-")) {
      continue;
    }
    headers.append(key, value);
  }
  headers.set("x-wenche-session", sessionToken);
  const init = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  try {
    return await fetchImpl(target, init);
  } catch {
    return new Response("Service Unavailable", { status: 503 });
  }
}
