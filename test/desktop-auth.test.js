import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/server.js";

const TOKEN = randomBytes(32).toString("base64url");

async function withDesktopServer(t) {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-auth-"));
  const app = createApp({
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    envPath: path.join(root, ".env"),
    aiProviderConfig: { provider: "mock" },
    desktopSessionToken: TOKEN
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(async () => {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function rawRequest(url, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({ status: response.statusCode, body })
      );
    });
    request.on("error", reject);
    request.end();
  });
}

test("rejects every route without the session token", async (t) => {
  const baseUrl = await withDesktopServer(t);
  for (const target of [
    "/api/health",
    "/api/documents",
    "/vendor/marked.min.js",
    "/"
  ]) {
    const response = await fetch(`${baseUrl}${target}`);
    assert.equal(response.status, 401, target);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
});

test("rejects missing, empty, short, long and prefix-similar tokens", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const variants = [
    "",
    "wrong",
    TOKEN.slice(0, 20) + "x" + TOKEN.slice(21),
    TOKEN + "x",
    TOKEN.slice(1)
  ];
  for (const token of variants) {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { "x-wenche-session": token }
    });
    assert.equal(response.status, 401, JSON.stringify(token));
  }
});

test("rejects duplicate session headers", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const headers = new Headers();
  headers.append("x-wenche-session", TOKEN);
  headers.append("x-wenche-session", TOKEN);
  const response = await fetch(`${baseUrl}/api/health`, { headers });
  assert.equal(response.status, 401);
});

test("accepts the correct token for health and vendor assets", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const health = await fetch(`${baseUrl}/api/health`, {
    headers: { "x-wenche-session": TOKEN }
  });
  assert.equal(health.status, 200);
  const vendor = await fetch(`${baseUrl}/vendor/marked.min.js`, {
    headers: { "x-wenche-session": TOKEN }
  });
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers.get("content-type"), /javascript/);
});

test("rejects non-loopback Host headers", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const response = await rawRequest(`${baseUrl}/api/health`, {
    headers: {
      host: "evil.example",
      "x-wenche-session": TOKEN
    }
  });
  assert.equal(response.status, 401);
});

test("does not grant CORS to external origins", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: {
      "x-wenche-session": TOKEN,
      origin: "http://evil.example"
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("covers uploads, source ranges, SSE and backups with the token", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const headers = { "x-wenche-session": TOKEN };
  const upload = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      name: "desktop-auth.txt",
      contentBase64: Buffer.from("桌面鉴权测试正文内容足够用于分页与划词。", "utf8").toString("base64")
    })
  });
  assert.equal(upload.status, 201);
  const document = await upload.json();
  assert.ok(document.id > 0);

  const source = await fetch(
    `${baseUrl}/api/documents/${document.id}/source`,
    { headers: { ...headers, range: "bytes=0-3" } }
  );
  assert.equal(source.status, 206);

  const backup = await fetch(`${baseUrl}/api/backup`, { headers });
  assert.equal(backup.status, 200);
  assert.equal((await backup.json()).format, "wenche-reader-backup");

  const stream = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: {
      ...headers,
      accept: "text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      documentId: document.id,
      mode: "direct",
      scope: "document"
    })
  });
  assert.equal(stream.status, 200);
  const text = await stream.text();
  assert.match(text, /event: start/);
  assert.ok((text.match(/event: delta/g) || []).length >= 2);
  assert.match(text, /event: done/);
});

test("still rejects uploads without the token", async (t) => {
  const baseUrl = await withDesktopServer(t);
  const response = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "x.txt",
      contentBase64: Buffer.from("x").toString("base64")
    })
  });
  assert.equal(response.status, 401);
});
