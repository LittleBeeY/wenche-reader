import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Storage } from "../src/lib/storage.js";

test("relocateUploads rewrites document and RSS snapshot paths", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-relocate-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const storage = new Storage({ dataDir: path.join(root, "data") });
  const oldUploads = path.join(root, "old", "uploads");
  const newUploads = path.join(root, "new", "uploads");

  const uploaded = storage.createDocument({
    title: "uploaded.txt",
    originalName: "uploaded.txt",
    mimeType: "text/plain",
    filePath: path.join(oldUploads, "uploaded.txt"),
    blocks: [{ position: 0, type: "paragraph", text: "正文" }]
  });
  const snapshot = storage.createDocument({
    title: "rss snapshot",
    originalName: "rss-entry-1.html",
    mimeType: "text/html",
    filePath: path.join(oldUploads, "rss", "rss-entry-1.html"),
    sourceType: "rss",
    blocks: [{ position: 0, type: "paragraph", text: "快照正文" }]
  });
  const outside = storage.createDocument({
    title: "outside.txt",
    originalName: "outside.txt",
    mimeType: "text/plain",
    filePath: path.join(root, "elsewhere", "keep.txt"),
    blocks: [{ position: 0, type: "paragraph", text: "不应改写" }]
  });

  const result = storage.relocateUploads(oldUploads, newUploads);
  assert.equal(result.rewritten, 2);
  assert.equal(
    storage.getDocument(uploaded.id).filePath,
    path.join(newUploads, "uploaded.txt")
  );
  assert.equal(
    storage.getDocument(snapshot.id).filePath,
    path.join(newUploads, "rss", "rss-entry-1.html")
  );
  assert.equal(
    storage.getDocument(outside.id).filePath,
    path.join(root, "elsewhere", "keep.txt")
  );
  storage.close();
});

test("relocateUploads is idempotent and ignores unrelated prefixes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-relocate-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const storage = new Storage({ dataDir: path.join(root, "data") });
  const oldUploads = path.join(root, "old", "uploads");
  const newUploads = path.join(root, "new", "uploads");
  storage.createDocument({
    title: "a.txt",
    originalName: "a.txt",
    filePath: path.join(oldUploads, "a.txt"),
    blocks: []
  });
  storage.relocateUploads(oldUploads, newUploads);
  const second = storage.relocateUploads(oldUploads, newUploads);
  assert.equal(second.rewritten, 0);
  storage.close();
});
