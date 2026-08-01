import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Storage } from "../src/lib/storage.js";

test("migrates existing documents into the unclassified category", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ai-reader-migration-"));

  const databasePath = path.join(dataDir, "reader.sqlite");
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE ai_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      question TEXT,
      selected_text TEXT,
      context TEXT NOT NULL,
      answer TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO documents (title, original_name, mime_type, file_path, created_at)
    VALUES ('Legacy', 'legacy.html', 'text/html', 'legacy.html', '2026-01-01');
    INSERT INTO blocks (document_id, position, type, text)
    VALUES (1, 0, 'paragraph', 'Legacy body');
    INSERT INTO ai_records (
      document_id, mode, question, selected_text, context, answer, provider, created_at
    ) VALUES (
      1, 'direct', '', 'Legacy', 'Legacy body', 'Legacy answer', 'mock', '2026-01-01'
    );
  `);
  legacyDatabase.close();

  const storage = new Storage({ dataDir });
  t.after(async () => {
    storage.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal(storage.listDocuments()[0].category, "未分类");
  const document = storage.getDocument(1);
  assert.equal(document.formatVersion, 1);
  assert.equal(document.renderHtml, "");
  assert.equal(document.blocks[0].html, "");
  assert.deepEqual(document.annotations, []);
  assert.equal(document.aiRecords[0].scope, "selection");
  assert.deepEqual(document.aiRecords[0].selectionAnchors, []);
  assert.equal(document.aiRecords[0].promptVersion, "");

  const aiColumns = storage.db.prepare("PRAGMA table_info(ai_records)").all();
  assert.ok(aiColumns.some((column) => column.name === "saved"));
  assert.ok(aiColumns.some((column) => column.name === "saved_title"));
  assert.ok(aiColumns.some((column) => column.name === "saved_note"));
  assert.ok(aiColumns.some((column) => column.name === "saved_at"));
  assert.ok(aiColumns.some((column) => column.name === "selection_anchors"));
  assert.ok(aiColumns.some((column) => column.name === "context_sources"));
  assert.ok(aiColumns.some((column) => column.name === "prompt_version"));
  assert.ok(aiColumns.some((column) => column.name === "latency_ms"));
  assert.deepEqual(storage.searchDocumentBlocks(1, "Legacy body"), [1]);
  assert.ok(
    storage.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'annotations'")
      .get()
  );
});

test("adds the rss content source column without losing existing entries", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "wenche-rss-migration-"));
  let storage = new Storage({ dataDir });
  const feed = storage.createRssFeed({
    title: "Legacy RSS",
    feedUrl: "https://example.com/feed.xml"
  });
  const inserted = storage.insertRssEntry({
    feedId: feed.id,
    dedupeKey: "guid:legacy",
    guid: "legacy",
    title: "Legacy entry",
    contentText: "Legacy body",
    contentHash: "legacy-hash"
  });
  storage.db.exec("ALTER TABLE rss_entries DROP COLUMN content_source");
  storage.close();

  storage = new Storage({ dataDir });
  t.after(async () => {
    storage.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const entry = storage.getRssEntry(inserted.id);
  assert.equal(entry.title, "Legacy entry");
  assert.equal(entry.contentSource, "feed");
});
