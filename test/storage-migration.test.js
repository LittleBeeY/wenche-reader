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
    INSERT INTO documents (title, original_name, mime_type, file_path, created_at)
    VALUES ('Legacy', 'legacy.html', 'text/html', 'legacy.html', '2026-01-01');
    INSERT INTO blocks (document_id, position, type, text)
    VALUES (1, 0, 'paragraph', 'Legacy body');
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

  const aiColumns = storage.db.prepare("PRAGMA table_info(ai_records)").all();
  assert.ok(aiColumns.some((column) => column.name === "saved"));
  assert.ok(aiColumns.some((column) => column.name === "saved_title"));
  assert.ok(aiColumns.some((column) => column.name === "saved_note"));
  assert.ok(aiColumns.some((column) => column.name === "saved_at"));
  assert.ok(
    storage.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'annotations'")
      .get()
  );
});
