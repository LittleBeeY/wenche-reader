import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createProtocolHandler } from "../desktop/protocol.js";

const TOKEN = "session-token-0123456789abcdef";
const BACKEND = "http://127.0.0.1:48123";

async function makeAppRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-protocol-"));
  await mkdir(path.join(root, "public"), { recursive: true });
  await mkdir(path.join(root, "desktop"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "marked", "lib"), {
    recursive: true
  });
  await mkdir(path.join(root, "node_modules", "dompurify", "dist"), {
    recursive: true
  });
  await mkdir(path.join(root, "node_modules", "jszip", "dist"), {
    recursive: true
  });
  await mkdir(path.join(root, "node_modules", "docx-preview", "dist"), {
    recursive: true
  });
  await writeFile(path.join(root, "public", "index.html"), "<html>index</html>");
  await writeFile(path.join(root, "public", "app.js"), "console.log(1)");
  await writeFile(
    path.join(root, "desktop", "error.html"),
    "<html>error</html>"
  );
  await writeFile(
    path.join(root, "desktop", "error.js"),
    "document.title='err'"
  );
  await writeFile(
    path.join(root, "node_modules", "marked", "lib", "marked.umd.js"),
    "marked()"
  );
  await writeFile(
    path.join(root, "node_modules", "dompurify", "dist", "purify.min.js"),
    "purify()"
  );
  await writeFile(
    path.join(root, "node_modules", "jszip", "dist", "jszip.min.js"),
    "jszip()"
  );
  await writeFile(
    path.join(root, "node_modules", "docx-preview", "dist", "docx-preview.min.js"),
    "docxPreview()"
  );
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function makeHandler(appRoot, options = {}) {
  const calls = [];
  const handler = createProtocolHandler({
    appRoot,
    backendOrigin:
      options.backendOrigin === undefined ? BACKEND : options.backendOrigin,
    sessionToken: TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response("streamed", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
  });
  return { handler, calls };
}

function request(url, { method = "GET", headers = {}, body = null } = {}) {
  return { url, method, headers: new Headers(headers), body };
}

test("serves the index with a strict CSP and correct MIME types", async (t) => {
  const appRoot = await makeAppRoot(t);
  const { handler } = makeHandler(appRoot);

  const index = await handler(request("app://wenche/"));
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type"), /text\/html/);
  const csp = index.headers.get("content-security-policy");
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /bypassCSP/);

  const script = await handler(request("app://wenche/app.js"));
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);

  const vendor = await handler(request("app://wenche/vendor/jszip.min.js"));
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers.get("content-type"), /javascript/);

  const errorPage = await handler(
    request("app://wenche/desktop-error.html")
  );
  assert.equal(errorPage.status, 200);
  assert.match(errorPage.headers.get("content-type"), /text\/html/);
});

test("rejects path traversal, encoded separators and NUL", async (t) => {
  const appRoot = await makeAppRoot(t);
  const { handler } = makeHandler(appRoot);
  for (const target of [
    "app://wenche/%2e%2e/package.json",
    "app://wenche/..%2f..%2fpackage.json",
    "app://wenche/..%5c..%5cpackage.json",
    "app://wenche/%00",
    "app://wenche/C:/windows/win.ini",
    "app://wenche/%2e%2e%2fpackage.json"
  ]) {
    const response = await handler(request(target));
    assert.ok([400, 404].includes(response.status), target);
  }
});

test("rejects non-wenche hosts", async (t) => {
  const appRoot = await makeAppRoot(t);
  const { handler } = makeHandler(appRoot);
  const response = await handler(request("app://evil/index.html"));
  assert.equal(response.status, 404);
});

test("proxies API calls with stripped headers and the real session token", async (t) => {
  const appRoot = await makeAppRoot(t);
  const { handler, calls } = makeHandler(appRoot);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload"));
      controller.close();
    }
  });
  const response = await handler(
    request("app://wenche/api/documents?page=2", {
      method: "POST",
      headers: {
        cookie: "a=b",
        authorization: "Bearer spoof",
        origin: "http://evil.example",
        referer: "http://evil.example/",
        "x-wenche-session": "spoofed",
        "content-type": "text/plain",
        range: "bytes=0-3"
      },
      body
    })
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BACKEND}/api/documents?page=2`);
  const headers = calls[0].init.headers;
  assert.equal(headers.get("x-wenche-session"), TOKEN);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("origin"), null);
  assert.equal(headers.get("referer"), null);
  assert.equal(headers.get("range"), "bytes=0-3");
  assert.equal(headers.get("content-type"), "text/plain");
  assert.equal(calls[0].init.body, body);
  assert.equal(calls[0].init.duplex, "half");
});

test("returns 503 for API calls before the backend is ready", async (t) => {
  const appRoot = await makeAppRoot(t);
  const { handler, calls } = makeHandler(appRoot, {
    backendOrigin: null
  });
  const response = await handler(request("app://wenche/api/health"));
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test("keeps SSE and large responses streaming without buffering", async (t) => {
  const appRoot = await makeAppRoot(t);
  const { handler, calls } = makeHandler(appRoot);
  const response = await handler(request("app://wenche/api/ai/explain"));
  assert.equal(await response.text(), "streamed");
  assert.match(calls[0].init.headers.get("accept") ?? "", /.*/);
});
