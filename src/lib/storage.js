import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const CURRENT_DOCUMENT_FORMAT_VERSION = 4;

export class Storage {
  constructor({ dataDir }) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "reader.sqlite"));
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        file_path TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '未分类',
        format_version INTEGER NOT NULL DEFAULT ${CURRENT_DOCUMENT_FORMAT_VERSION},
        render_html TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        html TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        mode TEXT NOT NULL,
        question TEXT,
        selected_text TEXT,
        context TEXT NOT NULL,
        answer TEXT NOT NULL,
        provider TEXT NOT NULL,
        saved INTEGER NOT NULL DEFAULT 0,
        saved_title TEXT NOT NULL DEFAULT '',
        saved_note TEXT NOT NULL DEFAULT '',
        saved_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        page_index INTEGER NOT NULL DEFAULT 0,
        selected_text TEXT NOT NULL DEFAULT '',
        block_ids TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'yellow',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS archive_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `);

    const documentColumns = this.db.prepare("PRAGMA table_info(documents)").all();
    if (!documentColumns.some((column) => column.name === "category")) {
      this.db.exec(
        "ALTER TABLE documents ADD COLUMN category TEXT NOT NULL DEFAULT '未分类'"
      );
    }
    if (!documentColumns.some((column) => column.name === "format_version")) {
      this.db.exec(
        "ALTER TABLE documents ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1"
      );
    }
    if (!documentColumns.some((column) => column.name === "render_html")) {
      this.db.exec(
        "ALTER TABLE documents ADD COLUMN render_html TEXT NOT NULL DEFAULT ''"
      );
    }

    const blockColumns = this.db.prepare("PRAGMA table_info(blocks)").all();
    if (!blockColumns.some((column) => column.name === "html")) {
      this.db.exec(
        "ALTER TABLE blocks ADD COLUMN html TEXT NOT NULL DEFAULT ''"
      );
    }

    const aiColumns = this.db.prepare("PRAGMA table_info(ai_records)").all();
    const aiColumnMigrations = [
      ["saved", "INTEGER NOT NULL DEFAULT 0"],
      ["saved_title", "TEXT NOT NULL DEFAULT ''"],
      ["saved_note", "TEXT NOT NULL DEFAULT ''"],
      ["saved_at", "TEXT"]
    ];
    for (const [name, definition] of aiColumnMigrations) {
      if (!aiColumns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE ai_records ADD COLUMN ${name} ${definition}`);
      }
    }

    this.db.exec(`
      INSERT OR IGNORE INTO archive_categories (name, created_at)
      SELECT category, MIN(created_at)
      FROM documents
      WHERE category <> '未分类' AND TRIM(category) <> ''
      GROUP BY category
    `);
  }

  createDocument({
    title,
    originalName,
    mimeType,
    filePath,
    category = "未分类",
    renderHtml = "",
    blocks
  }) {
    this.ensureArchiveCategory(category);
    const insertDocument = this.db.prepare(`
      INSERT INTO documents (title, original_name, mime_type, file_path, category, format_version, render_html, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insertDocument.run(
      title,
      originalName,
      mimeType || "",
      filePath,
      category,
      CURRENT_DOCUMENT_FORMAT_VERSION,
      renderHtml,
      new Date().toISOString()
    );
    const documentId = Number(result.lastInsertRowid);

    const insertBlock = this.db.prepare(`
      INSERT INTO blocks (document_id, position, type, text, html)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const block of blocks) {
      insertBlock.run(documentId, block.position, block.type, block.text, block.html || "");
    }

    return this.getDocument(documentId);
  }

  listDocuments() {
    return this.db
      .prepare(`
        SELECT
          documents.id,
          documents.title,
          documents.original_name AS originalName,
          documents.mime_type AS mimeType,
          documents.category,
          documents.created_at AS createdAt,
          COUNT(blocks.id) AS blockCount
        FROM documents
        LEFT JOIN blocks ON blocks.document_id = documents.id
        GROUP BY documents.id
        ORDER BY documents.id DESC
      `)
      .all();
  }

  getDocument(id) {
    const document = this.db
      .prepare("SELECT id, title, original_name AS originalName, mime_type AS mimeType, file_path AS filePath, category, format_version AS formatVersion, render_html AS renderHtml, created_at AS createdAt FROM documents WHERE id = ?")
      .get(id);

    if (!document) return null;

    const blocks = this.db
      .prepare("SELECT id, position, type, text, html FROM blocks WHERE document_id = ? ORDER BY position ASC")
      .all(id);
    const aiRecords = this.db
      .prepare(`
        SELECT id, mode, question, selected_text AS selectedText, context, answer, provider,
          saved, saved_title AS savedTitle, saved_note AS savedNote,
          saved_at AS savedAt, created_at AS createdAt
        FROM ai_records
        WHERE document_id = ?
        ORDER BY id DESC
      `)
      .all(id)
      .map(normalizeAiRecord);
    const annotations = this.db
      .prepare(`
        SELECT id, document_id AS documentId, kind, page_index AS pageIndex,
          selected_text AS selectedText, block_ids AS blockIds, note, color,
          created_at AS createdAt, updated_at AS updatedAt
        FROM annotations
        WHERE document_id = ?
        ORDER BY id DESC
      `)
      .all(id)
      .map(normalizeAnnotation);

    return { ...document, blocks, aiRecords, annotations };
  }

  replaceDocumentContent({ documentId, title, renderHtml = "", blocks }) {
    const insertBlock = this.db.prepare(`
      INSERT INTO blocks (document_id, position, type, text, html)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM blocks WHERE document_id = ?").run(documentId);
      for (const block of blocks) {
        insertBlock.run(
          documentId,
          block.position,
          block.type,
          block.text,
          block.html || ""
        );
      }
      this.db
        .prepare("UPDATE documents SET title = ?, format_version = ?, render_html = ? WHERE id = ?")
        .run(title, CURRENT_DOCUMENT_FORMAT_VERSION, renderHtml, documentId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  addAiRecord({ documentId, mode, question, selectedText, context, answer, provider }) {
    const result = this.db
      .prepare(`
        INSERT INTO ai_records (document_id, mode, question, selected_text, context, answer, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        documentId,
        mode,
        question || "",
        selectedText || "",
        context,
        answer,
        provider,
        new Date().toISOString()
      );

    return Number(result.lastInsertRowid);
  }

  updateAiRecord(id, { saved, title, note }) {
    const record = this.getAiRecord(id);
    if (!record) return null;
    const isSaved = Boolean(saved);
    this.db
      .prepare(`
        UPDATE ai_records
        SET saved = ?, saved_title = ?, saved_note = ?, saved_at = ?
        WHERE id = ?
      `)
      .run(
        isSaved ? 1 : 0,
        isSaved ? title : "",
        isSaved ? note : "",
        isSaved ? record.savedAt || new Date().toISOString() : null,
        id
      );
    return this.getAiRecord(id);
  }

  getAiRecord(id) {
    const record = this.db
      .prepare(`
        SELECT id, document_id AS documentId, mode, question,
          selected_text AS selectedText, context, answer, provider,
          saved, saved_title AS savedTitle, saved_note AS savedNote,
          saved_at AS savedAt, created_at AS createdAt
        FROM ai_records
        WHERE id = ?
      `)
      .get(id);
    return record ? normalizeAiRecord(record) : null;
  }

  listKnowledgeItems() {
    return this.db
      .prepare(`
        SELECT ai_records.id, ai_records.document_id AS documentId,
          documents.title AS documentTitle, ai_records.mode, ai_records.question,
          ai_records.selected_text AS selectedText, ai_records.context, ai_records.answer,
          ai_records.provider, ai_records.saved,
          ai_records.saved_title AS savedTitle, ai_records.saved_note AS savedNote,
          ai_records.saved_at AS savedAt, ai_records.created_at AS createdAt
        FROM ai_records
        JOIN documents ON documents.id = ai_records.document_id
        WHERE ai_records.saved = 1
        ORDER BY ai_records.saved_at DESC, ai_records.id DESC
      `)
      .all()
      .map(normalizeAiRecord);
  }

  createAnnotation({
    documentId,
    kind,
    pageIndex,
    selectedText,
    blockIds,
    note,
    color
  }) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        INSERT INTO annotations (
          document_id, kind, page_index, selected_text, block_ids,
          note, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        documentId,
        kind,
        pageIndex,
        selectedText,
        JSON.stringify(blockIds),
        note,
        color,
        now,
        now
      );
    return this.getAnnotation(Number(result.lastInsertRowid));
  }

  getAnnotation(id) {
    const annotation = this.db
      .prepare(`
        SELECT id, document_id AS documentId, kind, page_index AS pageIndex,
          selected_text AS selectedText, block_ids AS blockIds, note, color,
          created_at AS createdAt, updated_at AS updatedAt
        FROM annotations
        WHERE id = ?
      `)
      .get(id);
    return annotation ? normalizeAnnotation(annotation) : null;
  }

  updateAnnotation(id, { note, color }) {
    if (!this.getAnnotation(id)) return null;
    this.db
      .prepare("UPDATE annotations SET note = ?, color = ?, updated_at = ? WHERE id = ?")
      .run(note, color, new Date().toISOString(), id);
    return this.getAnnotation(id);
  }

  deleteAnnotation(id) {
    return this.db.prepare("DELETE FROM annotations WHERE id = ?").run(id).changes > 0;
  }

  getBackupData() {
    return {
      archives: this.db
        .prepare("SELECT id, name, created_at AS createdAt FROM archive_categories ORDER BY id")
        .all(),
      documents: this.db
        .prepare(`
          SELECT id, title, original_name AS originalName, mime_type AS mimeType,
            file_path AS filePath, category, format_version AS formatVersion,
            render_html AS renderHtml, created_at AS createdAt
          FROM documents ORDER BY id
        `)
        .all(),
      blocks: this.db
        .prepare(`
          SELECT id, document_id AS documentId, position, type, text, html
          FROM blocks ORDER BY id
        `)
        .all(),
      aiRecords: this.db
        .prepare(`
          SELECT id, document_id AS documentId, mode, question,
            selected_text AS selectedText, context, answer, provider,
            saved, saved_title AS savedTitle, saved_note AS savedNote,
            saved_at AS savedAt, created_at AS createdAt
          FROM ai_records ORDER BY id
        `)
        .all()
        .map(normalizeAiRecord),
      annotations: this.db
        .prepare(`
          SELECT id, document_id AS documentId, kind, page_index AS pageIndex,
            selected_text AS selectedText, block_ids AS blockIds, note, color,
            created_at AS createdAt, updated_at AS updatedAt
          FROM annotations ORDER BY id
        `)
        .all()
        .map(normalizeAnnotation)
    };
  }

  restoreBackupData(snapshot, filePaths) {
    const insertArchive = this.db.prepare(`
      INSERT INTO archive_categories (id, name, created_at) VALUES (?, ?, ?)
    `);
    const insertDocument = this.db.prepare(`
      INSERT INTO documents (
        id, title, original_name, mime_type, file_path, category,
        format_version, render_html, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBlock = this.db.prepare(`
      INSERT INTO blocks (id, document_id, position, type, text, html)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertAiRecord = this.db.prepare(`
      INSERT INTO ai_records (
        id, document_id, mode, question, selected_text, context, answer,
        provider, saved, saved_title, saved_note, saved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAnnotation = this.db.prepare(`
      INSERT INTO annotations (
        id, document_id, kind, page_index, selected_text, block_ids,
        note, color, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      this.db.exec(`
        DELETE FROM annotations;
        DELETE FROM ai_records;
        DELETE FROM blocks;
        DELETE FROM documents;
        DELETE FROM archive_categories;
      `);
      for (const archive of snapshot.archives) {
        insertArchive.run(archive.id, archive.name, archive.createdAt);
      }
      for (const document of snapshot.documents) {
        insertDocument.run(
          document.id,
          document.title,
          document.originalName,
          document.mimeType || "",
          filePaths.get(Number(document.id)),
          document.category,
          document.formatVersion,
          document.renderHtml || "",
          document.createdAt
        );
      }
      for (const block of snapshot.blocks) {
        insertBlock.run(
          block.id,
          block.documentId,
          block.position,
          block.type,
          block.text,
          block.html || ""
        );
      }
      for (const record of snapshot.aiRecords) {
        insertAiRecord.run(
          record.id,
          record.documentId,
          record.mode,
          record.question || "",
          record.selectedText || "",
          record.context,
          record.answer,
          record.provider,
          record.saved ? 1 : 0,
          record.savedTitle || "",
          record.savedNote || "",
          record.savedAt || null,
          record.createdAt
        );
      }
      for (const annotation of snapshot.annotations) {
        insertAnnotation.run(
          annotation.id,
          annotation.documentId,
          annotation.kind,
          annotation.pageIndex,
          annotation.selectedText || "",
          JSON.stringify(annotation.blockIds || []),
          annotation.note || "",
          annotation.color || "yellow",
          annotation.createdAt,
          annotation.updatedAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateDocumentsCategory(ids, category) {
    const documentIds = [...new Set((ids || []).map((id) => Number(id)))].filter(
      Number.isInteger
    );
    if (documentIds.length === 0) return 0;

    this.ensureArchiveCategory(category);
    const placeholders = documentIds.map(() => "?").join(", ");
    const result = this.db
      .prepare(`UPDATE documents SET category = ? WHERE id IN (${placeholders})`)
      .run(category, ...documentIds);
    return result.changes;
  }

  createArchiveCategory(name) {
    this.ensureArchiveCategory(name);
    return this.db
      .prepare(`
        SELECT
          archive_categories.id,
          archive_categories.name,
          archive_categories.created_at AS createdAt,
          COUNT(documents.id) AS documentCount
        FROM archive_categories
        LEFT JOIN documents ON documents.category = archive_categories.name
        WHERE archive_categories.name = ?
        GROUP BY archive_categories.id
      `)
      .get(name);
  }

  listArchiveCategories() {
    return this.db
      .prepare(`
        SELECT
          archive_categories.id,
          archive_categories.name,
          archive_categories.created_at AS createdAt,
          COUNT(documents.id) AS documentCount
        FROM archive_categories
        LEFT JOIN documents ON documents.category = archive_categories.name
        GROUP BY archive_categories.id
        ORDER BY archive_categories.id ASC
      `)
      .all();
  }

  renameArchiveCategory(id, name) {
    const archive = this.db
      .prepare("SELECT id, name FROM archive_categories WHERE id = ?")
      .get(id);
    if (!archive) return null;

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("UPDATE documents SET category = ? WHERE category = ?")
        .run(name, archive.name);
      this.db
        .prepare("UPDATE archive_categories SET name = ? WHERE id = ?")
        .run(name, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listArchiveCategories().find(
      (category) => Number(category.id) === Number(id)
    );
  }

  deleteArchiveCategory(id) {
    const archive = this.listArchiveCategories().find(
      (category) => Number(category.id) === Number(id)
    );
    if (!archive) return null;
    if (archive.documentCount > 0) return { deleted: false, archive };

    this.db.prepare("DELETE FROM archive_categories WHERE id = ?").run(id);
    return { deleted: true, archive };
  }

  ensureArchiveCategory(name) {
    if (!name || name === "未分类") return;
    this.db
      .prepare(`
        INSERT OR IGNORE INTO archive_categories (name, created_at)
        VALUES (?, ?)
      `)
      .run(name, new Date().toISOString());
  }

  deleteDocument(id) {
    return this.deleteDocuments([id]) === 1;
  }

  deleteDocuments(ids) {
    const documentIds = [...new Set((ids || []).map((id) => Number(id)))].filter(
      Number.isInteger
    );
    if (documentIds.length === 0) return 0;

    const placeholders = documentIds.map(() => "?").join(", ");
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`DELETE FROM annotations WHERE document_id IN (${placeholders})`)
        .run(...documentIds);
      this.db
        .prepare(`DELETE FROM ai_records WHERE document_id IN (${placeholders})`)
        .run(...documentIds);
      this.db
        .prepare(`DELETE FROM blocks WHERE document_id IN (${placeholders})`)
        .run(...documentIds);
      const result = this.db
        .prepare(`DELETE FROM documents WHERE id IN (${placeholders})`)
        .run(...documentIds);
      this.db.exec("COMMIT");
      return result.changes;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

function normalizeAiRecord(record) {
  return { ...record, saved: Boolean(record.saved) };
}

function normalizeAnnotation(annotation) {
  let blockIds = [];
  try {
    blockIds = JSON.parse(annotation.blockIds || "[]")
      .map((id) => Number(id))
      .filter(Number.isInteger);
  } catch {
    blockIds = [];
  }
  return { ...annotation, blockIds };
}
