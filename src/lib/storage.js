import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const CURRENT_DOCUMENT_FORMAT_VERSION = 4;

export const RSS_DEFAULT_PREFERENCES = Object.freeze({
  topics: [],
  blockedTopics: [],
  blockedFeedIds: [],
  preferredLanguages: [],
  prefersLongForm: false,
  dailyBriefCount: 10,
  fetchIntervalMinutes: 60,
  remoteImages: "lazy",
  showUnreadCounts: true,
  autoAiAnalysis: true,
  aiDailyBudget: 60,
  retentionDaysRead: 30,
  retentionDaysMetadata: 180,
  exploreItem: true
});

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

      CREATE TABLE IF NOT EXISTS rss_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rss_feeds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER,
        title TEXT NOT NULL,
        feed_url TEXT NOT NULL UNIQUE,
        site_url TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        icon_url TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
        etag TEXT NOT NULL DEFAULT '',
        last_modified TEXT NOT NULL DEFAULT '',
        last_fetched_at TEXT,
        next_fetch_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        disabled INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        full_text_mode TEXT NOT NULL DEFAULT 'feed',
        ai_excluded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (folder_id) REFERENCES rss_folders(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS rss_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feed_id INTEGER NOT NULL,
        guid TEXT NOT NULL DEFAULT '',
        dedupe_key TEXT NOT NULL,
        canonical_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        published_at TEXT,
        received_at TEXT NOT NULL,
        summary_html TEXT NOT NULL DEFAULT '',
        content_html TEXT NOT NULL DEFAULT '',
        content_text TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        thumbnail_url TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        estimated_read_minutes INTEGER NOT NULL DEFAULT 1,
        read_state TEXT NOT NULL DEFAULT 'unread',
        starred INTEGER NOT NULL DEFAULT 0,
        read_later INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        read_progress REAL NOT NULL DEFAULT 0,
        document_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (feed_id, dedupe_key),
        FOREIGN KEY (feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rss_entries_feed_published
        ON rss_entries (feed_id, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_entries_read_state
        ON rss_entries (read_state, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_entries_starred
        ON rss_entries (starred, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_entries_read_later
        ON rss_entries (read_later, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_entries_canonical_url
        ON rss_entries (canonical_url);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_entries_document
        ON rss_entries (document_id) WHERE document_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS rss_entry_analysis (
        entry_id INTEGER PRIMARY KEY,
        summary TEXT NOT NULL DEFAULT '',
        key_points_json TEXT NOT NULL DEFAULT '[]',
        topics_json TEXT NOT NULL DEFAULT '[]',
        entities_json TEXT NOT NULL DEFAULT '[]',
        quality_json TEXT NOT NULL DEFAULT '{}',
        relevance_score REAL NOT NULL DEFAULT 0,
        priority_score REAL NOT NULL DEFAULT 0,
        recommendation_reason TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT '',
        prompt_version TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        analyzed_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (entry_id) REFERENCES rss_entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rss_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_date TEXT NOT NULL UNIQUE,
        generated_at TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'auto',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready'
      );

      CREATE TABLE IF NOT EXISTS rss_brief_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_id INTEGER NOT NULL,
        entry_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        section TEXT NOT NULL DEFAULT 'picked',
        reason TEXT NOT NULL DEFAULT '',
        score REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (brief_id) REFERENCES rss_briefs(id) ON DELETE CASCADE,
        FOREIGN KEY (entry_id) REFERENCES rss_entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rss_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
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
    const documentRssMigrations = [
      ["source_type", "TEXT NOT NULL DEFAULT 'upload'"],
      ["source_url", "TEXT NOT NULL DEFAULT ''"],
      ["is_library_visible", "INTEGER NOT NULL DEFAULT 1"],
      ["content_hash", "TEXT NOT NULL DEFAULT ''"]
    ];
    for (const [name, definition] of documentRssMigrations) {
      if (!documentColumns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`);
      }
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
    sourceType = "upload",
    sourceUrl = "",
    isLibraryVisible = true,
    contentHash = "",
    blocks
  }) {
    this.ensureArchiveCategory(category);
    const insertDocument = this.db.prepare(`
      INSERT INTO documents (title, original_name, mime_type, file_path, category, format_version, render_html, source_type, source_url, is_library_visible, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insertDocument.run(
      title,
      originalName,
      mimeType || "",
      filePath,
      category,
      CURRENT_DOCUMENT_FORMAT_VERSION,
      renderHtml,
      sourceType,
      sourceUrl,
      isLibraryVisible ? 1 : 0,
      contentHash,
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
        WHERE documents.is_library_visible = 1
        GROUP BY documents.id
        ORDER BY documents.id DESC
      `)
      .all();
  }

  getDocument(id) {
    const document = this.db
      .prepare("SELECT id, title, original_name AS originalName, mime_type AS mimeType, file_path AS filePath, category, format_version AS formatVersion, render_html AS renderHtml, source_type AS sourceType, source_url AS sourceUrl, is_library_visible AS isLibraryVisible, content_hash AS contentHash, created_at AS createdAt FROM documents WHERE id = ?")
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
            render_html AS renderHtml, source_type AS sourceType, source_url AS sourceUrl,
            is_library_visible AS isLibraryVisible, content_hash AS contentHash,
            created_at AS createdAt
          FROM documents ORDER BY id
        `)
        .all()
        .map((document) => ({ ...document, isLibraryVisible: Boolean(document.isLibraryVisible) })),
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
        .map(normalizeAnnotation),
      rss: this.getRssBackupData({ includeCache: true })
    };
  }

  restoreBackupData(snapshot, filePaths) {
    const insertArchive = this.db.prepare(`
      INSERT INTO archive_categories (id, name, created_at) VALUES (?, ?, ?)
    `);
    const insertDocument = this.db.prepare(`
      INSERT INTO documents (
        id, title, original_name, mime_type, file_path, category,
        format_version, render_html, source_type, source_url, is_library_visible,
        content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        DELETE FROM rss_brief_entries;
        DELETE FROM rss_briefs;
        DELETE FROM rss_entry_analysis;
        DELETE FROM rss_entries;
        DELETE FROM rss_feeds;
        DELETE FROM rss_folders;
        DELETE FROM rss_preferences;
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
          document.sourceType || "upload",
          document.sourceUrl || "",
          document.isLibraryVisible === false ? 0 : 1,
          document.contentHash || "",
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
      if (snapshot.rss && typeof snapshot.rss === "object") {
        this.restoreRssBackupData(snapshot.rss);
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
        .prepare(`UPDATE rss_entries SET document_id = NULL WHERE document_id IN (${placeholders})`)
        .run(...documentIds);
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

  markDocumentLibraryVisible(documentId, category = "未分类") {
    this.ensureArchiveCategory(category);
    this.db
      .prepare("UPDATE documents SET is_library_visible = 1, category = ? WHERE id = ?")
      .run(category, documentId);
    return this.getDocument(documentId);
  }

  // ---------- RSS: folders ----------

  createRssFolder(name) {
    const now = new Date().toISOString();
    const maxPosition = this.db
      .prepare("SELECT COALESCE(MAX(position), 0) AS maxPosition FROM rss_folders")
      .get().maxPosition;
    const result = this.db
      .prepare("INSERT INTO rss_folders (name, position, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(name, maxPosition + 1, now, now);
    return this.getRssFolder(Number(result.lastInsertRowid));
  }

  getRssFolder(id) {
    return this.db
      .prepare("SELECT id, name, position, created_at AS createdAt, updated_at AS updatedAt FROM rss_folders WHERE id = ?")
      .get(id) || null;
  }

  listRssFolders() {
    return this.db
      .prepare(`
        SELECT f.id, f.name, f.position, f.created_at AS createdAt, f.updated_at AS updatedAt,
          COUNT(DISTINCT feeds.id) AS feedCount,
          COALESCE(SUM(CASE WHEN e.read_state = 'unread' AND e.hidden = 0 THEN 1 ELSE 0 END), 0) AS unreadCount
        FROM rss_folders f
        LEFT JOIN rss_feeds feeds ON feeds.folder_id = f.id AND feeds.deleted_at IS NULL
        LEFT JOIN rss_entries e ON e.feed_id = feeds.id
        GROUP BY f.id
        ORDER BY f.position ASC, f.id ASC
      `)
      .all();
  }

  renameRssFolder(id, name) {
    const folder = this.getRssFolder(id);
    if (!folder) return null;
    this.db
      .prepare("UPDATE rss_folders SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, new Date().toISOString(), id);
    return this.getRssFolder(id);
  }

  deleteRssFolder(id) {
    const folder = this.getRssFolder(id);
    if (!folder) return null;
    const feedCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM rss_feeds WHERE folder_id = ? AND deleted_at IS NULL")
      .get(id).count;
    if (feedCount > 0) return { deleted: false, folder };
    this.db.prepare("UPDATE rss_feeds SET folder_id = NULL WHERE folder_id = ?").run(id);
    this.db.prepare("DELETE FROM rss_folders WHERE id = ?").run(id);
    return { deleted: true, folder };
  }

  // ---------- RSS: feeds ----------

  createRssFeed({
    folderId = null,
    title,
    feedUrl,
    siteUrl = "",
    description = "",
    iconUrl = "",
    language = "",
    priority = 0,
    fetchIntervalMinutes = 60,
    fullTextMode = "feed"
  }) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        INSERT INTO rss_feeds (
          folder_id, title, feed_url, site_url, description, icon_url, language,
          priority, fetch_interval_minutes, next_fetch_at, full_text_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        folderId,
        title,
        feedUrl,
        siteUrl,
        description,
        iconUrl,
        language,
        priority,
        fetchIntervalMinutes,
        now,
        fullTextMode,
        now,
        now
      );
    return this.getRssFeed(Number(result.lastInsertRowid));
  }

  getRssFeed(id) {
    const feed = this.db
      .prepare(`
        SELECT id, folder_id AS folderId, title, feed_url AS feedUrl, site_url AS siteUrl,
          description, icon_url AS iconUrl, language, priority,
          fetch_interval_minutes AS fetchIntervalMinutes, etag, last_modified AS lastModified,
          last_fetched_at AS lastFetchedAt, next_fetch_at AS nextFetchAt,
          consecutive_failures AS consecutiveFailures, last_error AS lastError,
          disabled, deleted_at AS deletedAt, full_text_mode AS fullTextMode,
          ai_excluded AS aiExcluded, created_at AS createdAt, updated_at AS updatedAt
        FROM rss_feeds WHERE id = ?
      `)
      .get(id);
    return feed ? normalizeRssFeed(feed) : null;
  }

  getRssFeedByUrl(feedUrl) {
    const feed = this.db
      .prepare(`
        SELECT id, folder_id AS folderId, title, feed_url AS feedUrl, site_url AS siteUrl,
          description, icon_url AS iconUrl, language, priority,
          fetch_interval_minutes AS fetchIntervalMinutes, etag, last_modified AS lastModified,
          last_fetched_at AS lastFetchedAt, next_fetch_at AS nextFetchAt,
          consecutive_failures AS consecutiveFailures, last_error AS lastError,
          disabled, deleted_at AS deletedAt, full_text_mode AS fullTextMode,
          ai_excluded AS aiExcluded, created_at AS createdAt, updated_at AS updatedAt
        FROM rss_feeds WHERE feed_url = ?
      `)
      .get(feedUrl);
    return feed ? normalizeRssFeed(feed) : null;
  }

  listRssFeeds({ includeDeleted = false } = {}) {
    const rows = this.db
      .prepare(`
        SELECT f.id, f.folder_id AS folderId, f.title, f.feed_url AS feedUrl, f.site_url AS siteUrl,
          f.description, f.icon_url AS iconUrl, f.language, f.priority,
          f.fetch_interval_minutes AS fetchIntervalMinutes, f.etag, f.last_modified AS lastModified,
          f.last_fetched_at AS lastFetchedAt, f.next_fetch_at AS nextFetchAt,
          f.consecutive_failures AS consecutiveFailures, f.last_error AS lastError,
          f.disabled, f.deleted_at AS deletedAt, f.full_text_mode AS fullTextMode,
          f.ai_excluded AS aiExcluded, f.created_at AS createdAt, f.updated_at AS updatedAt,
          COALESCE(SUM(CASE WHEN e.read_state = 'unread' AND e.hidden = 0 THEN 1 ELSE 0 END), 0) AS unreadCount,
          COUNT(e.id) AS entryCount
        FROM rss_feeds f
        LEFT JOIN rss_entries e ON e.feed_id = f.id
        ${includeDeleted ? "" : "WHERE f.deleted_at IS NULL"}
        GROUP BY f.id
        ORDER BY f.title COLLATE NOCASE ASC
      `)
      .all();
    return rows.map(normalizeRssFeed);
  }

  updateRssFeed(id, patch) {
    const feed = this.getRssFeed(id);
    if (!feed) return null;
    const columns = {
      folderId: "folder_id",
      title: "title",
      description: "description",
      iconUrl: "icon_url",
      language: "language",
      priority: "priority",
      fetchIntervalMinutes: "fetch_interval_minutes",
      disabled: "disabled",
      fullTextMode: "full_text_mode",
      aiExcluded: "ai_excluded",
      deletedAt: "deleted_at"
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      sets.push(`${column} = ?`);
      const value = patch[key];
      values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return feed;
    sets.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE rss_feeds SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getRssFeed(id);
  }

  updateRssFeedFetch(id, { etag, lastModified, lastFetchedAt, nextFetchAt, consecutiveFailures, lastError }) {
    const sets = ["last_fetched_at = ?", "next_fetch_at = ?", "consecutive_failures = ?", "last_error = ?", "updated_at = ?"];
    const values = [lastFetchedAt, nextFetchAt, consecutiveFailures, lastError || "", new Date().toISOString()];
    if (etag !== undefined) {
      sets.push("etag = ?");
      values.push(etag || "");
    }
    if (lastModified !== undefined) {
      sets.push("last_modified = ?");
      values.push(lastModified || "");
    }
    values.push(id);
    this.db.prepare(`UPDATE rss_feeds SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getRssFeed(id);
  }

  listDueRssFeeds(nowIso, limit = 100) {
    return this.db
      .prepare(`
        SELECT id, folder_id AS folderId, title, feed_url AS feedUrl, site_url AS siteUrl,
          description, icon_url AS iconUrl, language, priority,
          fetch_interval_minutes AS fetchIntervalMinutes, etag, last_modified AS lastModified,
          last_fetched_at AS lastFetchedAt, next_fetch_at AS nextFetchAt,
          consecutive_failures AS consecutiveFailures, last_error AS lastError,
          disabled, deleted_at AS deletedAt, full_text_mode AS fullTextMode,
          ai_excluded AS aiExcluded, created_at AS createdAt, updated_at AS updatedAt
        FROM rss_feeds
        WHERE deleted_at IS NULL AND disabled = 0
          AND (next_fetch_at IS NULL OR next_fetch_at <= ?)
        ORDER BY next_fetch_at ASC
        LIMIT ?
      `)
      .all(nowIso, limit)
      .map(normalizeRssFeed);
  }

  // ---------- RSS: entries ----------

  insertRssEntry(entry) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO rss_entries (
          feed_id, guid, dedupe_key, canonical_url, title, author, published_at, received_at,
          summary_html, content_html, content_text, content_hash, thumbnail_url, language,
          estimated_read_minutes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.feedId,
        entry.guid || "",
        entry.dedupeKey,
        entry.canonicalUrl || "",
        entry.title,
        entry.author || "",
        entry.publishedAt || null,
        now,
        entry.summaryHtml || "",
        entry.contentHtml || "",
        entry.contentText || "",
        entry.contentHash || "",
        entry.thumbnailUrl || "",
        entry.language || "",
        entry.estimatedReadMinutes || 1,
        now,
        now
      );
    if (result.changes === 0) return { created: false, id: null };
    return { created: true, id: Number(result.lastInsertRowid) };
  }

  getRssEntry(id) {
    const entry = this.db
      .prepare(`
        SELECT e.id, e.feed_id AS feedId, f.title AS feedTitle, f.priority AS feedPriority,
          f.site_url AS feedSiteUrl, f.icon_url AS feedIconUrl, f.full_text_mode AS feedFullTextMode,
          f.ai_excluded AS feedAiExcluded, f.deleted_at AS feedDeletedAt,
          e.guid, e.canonical_url AS canonicalUrl, e.title, e.author,
          e.published_at AS publishedAt, e.received_at AS receivedAt,
          e.summary_html AS summaryHtml, e.content_html AS contentHtml, e.content_text AS contentText,
          e.content_hash AS contentHash, e.thumbnail_url AS thumbnailUrl, e.language,
          e.estimated_read_minutes AS estimatedReadMinutes,
          e.read_state AS readState, e.starred, e.read_later AS readLater, e.hidden,
          e.read_progress AS readProgress, e.document_id AS documentId,
          e.created_at AS createdAt, e.updated_at AS updatedAt
        FROM rss_entries e
        JOIN rss_feeds f ON f.id = e.feed_id
        WHERE e.id = ?
      `)
      .get(id);
    if (!entry) return null;
    return { ...normalizeRssEntry(entry), analysis: this.getRssEntryAnalysis(id) };
  }

  listRssEntries({
    scope = "inbox",
    scopeId = null,
    read = "unread",
    sort = "newest",
    query = "",
    cursor = null,
    limit = 40,
    includeHidden = false
  } = {}) {
    const conditions = [];
    const values = [];

    if (!includeHidden) conditions.push("e.hidden = 0");
    if (scope === "later") {
      conditions.push("e.read_later = 1");
    } else if (scope === "starred") {
      conditions.push("e.starred = 1");
    } else if (scope === "feed" && scopeId) {
      conditions.push("e.feed_id = ?");
      values.push(Number(scopeId));
    } else if (scope === "folder" && scopeId) {
      conditions.push("f.folder_id = ?");
      values.push(Number(scopeId));
    }
    conditions.push("f.deleted_at IS NULL");

    if (read === "unread") conditions.push("e.read_state = 'unread'");
    if (read === "read") conditions.push("e.read_state = 'read'");

    if (query) {
      conditions.push("(e.title LIKE ? OR e.content_text LIKE ?)");
      const like = `%${query}%`;
      values.push(like, like);
    }

    const sortKey = "COALESCE(e.published_at, e.received_at)";
    if (cursor && Array.isArray(cursor)) {
      conditions.push(`(${sortKey} < ? OR (${sortKey} = ? AND e.id < ?))`);
      values.push(cursor[0], cursor[0], Number(cursor[1]));
    }

    const orderBy = sort === "oldest"
      ? `${sortKey} ASC, e.id ASC`
      : sort === "smart"
        ? `CASE WHEN e.read_state = 'unread' THEN 0 ELSE 1 END ASC, COALESCE(a.priority_score, 0) DESC, ${sortKey} DESC, e.id DESC`
        : `${sortKey} DESC, e.id DESC`;

    const rows = this.db
      .prepare(`
        SELECT e.id, e.feed_id AS feedId, f.title AS feedTitle, f.priority AS feedPriority,
          f.icon_url AS feedIconUrl,
          e.guid, e.canonical_url AS canonicalUrl, e.title, e.author,
          e.published_at AS publishedAt, e.received_at AS receivedAt,
          e.summary_html AS summaryHtml, e.thumbnail_url AS thumbnailUrl, e.language,
          e.estimated_read_minutes AS estimatedReadMinutes,
          e.read_state AS readState, e.starred, e.read_later AS readLater, e.hidden,
          e.read_progress AS readProgress, e.document_id AS documentId,
          e.created_at AS createdAt, e.updated_at AS updatedAt,
          a.summary AS analysisSummary, a.recommendation_reason AS recommendationReason,
          a.priority_score AS priorityScore
        FROM rss_entries e
        JOIN rss_feeds f ON f.id = e.feed_id
        LEFT JOIN rss_entry_analysis a ON a.entry_id = e.id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY ${orderBy}
        LIMIT ?
      `)
      .all(...values, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last
      ? [last.publishedAt || last.receivedAt, last.id]
      : null;
    return {
      entries: pageRows.map(normalizeRssEntry),
      nextCursor
    };
  }

  listRssEntriesByIds(ids) {
    const entryIds = [...new Set((ids || []).map((id) => Number(id)))].filter(Number.isInteger);
    if (entryIds.length === 0) return [];
    const placeholders = entryIds.map(() => "?").join(", ");
    return this.db
      .prepare(`
        SELECT e.id, e.feed_id AS feedId, f.title AS feedTitle, f.priority AS feedPriority,
          f.icon_url AS feedIconUrl,
          e.guid, e.canonical_url AS canonicalUrl, e.title, e.author,
          e.published_at AS publishedAt, e.received_at AS receivedAt,
          e.summary_html AS summaryHtml, e.thumbnail_url AS thumbnailUrl, e.language,
          e.estimated_read_minutes AS estimatedReadMinutes,
          e.read_state AS readState, e.starred, e.read_later AS readLater, e.hidden,
          e.read_progress AS readProgress, e.document_id AS documentId,
          e.created_at AS createdAt, e.updated_at AS updatedAt,
          a.summary AS analysisSummary, a.recommendation_reason AS recommendationReason,
          a.priority_score AS priorityScore
        FROM rss_entries e
        JOIN rss_feeds f ON f.id = e.feed_id
        LEFT JOIN rss_entry_analysis a ON a.entry_id = e.id
        WHERE e.id IN (${placeholders})
      `)
      .all(...entryIds)
      .map(normalizeRssEntry);
  }

  updateRssEntryState(id, patch) {
    const entry = this.db.prepare("SELECT id FROM rss_entries WHERE id = ?").get(id);
    if (!entry) return null;
    const columns = {
      readState: "read_state",
      starred: "starred",
      readLater: "read_later",
      hidden: "hidden",
      readProgress: "read_progress"
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      sets.push(`${column} = ?`);
      const value = patch[key];
      values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return this.getRssEntry(id);
    sets.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE rss_entries SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getRssEntry(id);
  }

  batchUpdateRssEntryState(ids, patch) {
    const entryIds = [...new Set((ids || []).map((id) => Number(id)))].filter(Number.isInteger);
    if (entryIds.length === 0) return 0;
    const placeholders = entryIds.map(() => "?").join(", ");
    const columns = {
      readState: "read_state",
      starred: "starred",
      readLater: "read_later",
      hidden: "hidden"
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      sets.push(`${column} = ?`);
      const value = patch[key];
      values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return 0;
    sets.push("updated_at = ?");
    const result = this.db
      .prepare(`UPDATE rss_entries SET ${sets.join(", ")} WHERE id IN (${placeholders})`)
      .run(...values, new Date().toISOString(), ...entryIds);
    return result.changes;
  }

  setRssEntryContent(id, { contentHtml, contentText, contentHash, estimatedReadMinutes }) {
    this.db
      .prepare(`
        UPDATE rss_entries
        SET content_html = ?, content_text = ?, content_hash = ?, estimated_read_minutes = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        contentHtml || "",
        contentText || "",
        contentHash || "",
        estimatedReadMinutes || 1,
        new Date().toISOString(),
        id
      );
    return this.getRssEntry(id);
  }

  setRssEntryDocument(id, documentId) {
    this.db
      .prepare("UPDATE rss_entries SET document_id = ?, updated_at = ? WHERE id = ?")
      .run(documentId, new Date().toISOString(), id);
    return this.getRssEntry(id);
  }

  countRssEntries({ unreadOnly = false } = {}) {
    return this.db
      .prepare(`
        SELECT COUNT(*) AS count FROM rss_entries e
        JOIN rss_feeds f ON f.id = e.feed_id
        WHERE e.hidden = 0 AND f.deleted_at IS NULL
        ${unreadOnly ? "AND e.read_state = 'unread'" : ""}
      `)
      .get().count;
  }

  listRssAnalysisCandidates({ sinceIso, limit = 50 } = {}) {
    return this.db
      .prepare(`
        SELECT e.id, e.feed_id AS feedId, f.title AS feedTitle, f.priority AS feedPriority,
          e.title, e.content_text AS contentText, e.content_hash AS contentHash,
          e.published_at AS publishedAt, e.received_at AS receivedAt, e.language
        FROM rss_entries e
        JOIN rss_feeds f ON f.id = e.feed_id
        LEFT JOIN rss_entry_analysis a ON a.entry_id = e.id
        WHERE e.hidden = 0 AND f.deleted_at IS NULL AND f.ai_excluded = 0
          AND COALESCE(e.published_at, e.received_at) >= ?
          AND (a.entry_id IS NULL OR a.content_hash <> e.content_hash)
        ORDER BY f.priority DESC, COALESCE(e.published_at, e.received_at) DESC
        LIMIT ?
      `)
      .all(sinceIso, limit);
  }

  // ---------- RSS: analysis ----------

  saveRssEntryAnalysis(entryId, analysis) {
    this.db
      .prepare(`
        INSERT INTO rss_entry_analysis (
          entry_id, summary, key_points_json, topics_json, entities_json, quality_json,
          relevance_score, priority_score, recommendation_reason, confidence,
          model, prompt_version, content_hash, analyzed_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET
          summary = excluded.summary,
          key_points_json = excluded.key_points_json,
          topics_json = excluded.topics_json,
          entities_json = excluded.entities_json,
          quality_json = excluded.quality_json,
          relevance_score = excluded.relevance_score,
          priority_score = excluded.priority_score,
          recommendation_reason = excluded.recommendation_reason,
          confidence = excluded.confidence,
          model = excluded.model,
          prompt_version = excluded.prompt_version,
          content_hash = excluded.content_hash,
          analyzed_at = excluded.analyzed_at,
          last_error = excluded.last_error
      `)
      .run(
        entryId,
        analysis.summary || "",
        JSON.stringify(analysis.keyPoints || []),
        JSON.stringify(analysis.topics || []),
        JSON.stringify(analysis.entities || []),
        JSON.stringify(analysis.qualitySignals || {}),
        analysis.relevanceScore || 0,
        analysis.priorityScore || 0,
        analysis.recommendationReason || "",
        analysis.confidence || 0,
        analysis.model || "",
        analysis.promptVersion || "",
        analysis.contentHash || "",
        analysis.analyzedAt || new Date().toISOString(),
        analysis.lastError || ""
      );
    return this.getRssEntryAnalysis(entryId);
  }

  countRssAnalysesSince(iso) {
    return this.db
      .prepare("SELECT COUNT(*) AS count FROM rss_entry_analysis WHERE analyzed_at >= ? AND last_error = ''")
      .get(iso).count;
  }

  getRssEntryAnalysis(entryId) {
    const row = this.db
      .prepare(`
        SELECT entry_id AS entryId, summary, key_points_json AS keyPoints,
          topics_json AS topics, entities_json AS entities, quality_json AS qualitySignals,
          relevance_score AS relevanceScore, priority_score AS priorityScore,
          recommendation_reason AS recommendationReason, confidence, model,
          prompt_version AS promptVersion, content_hash AS contentHash,
          analyzed_at AS analyzedAt, last_error AS lastError
        FROM rss_entry_analysis WHERE entry_id = ?
      `)
      .get(entryId);
    if (!row) return null;
    return {
      ...row,
      keyPoints: parseJsonArray(row.keyPoints),
      topics: parseJsonArray(row.topics),
      entities: parseJsonArray(row.entities),
      qualitySignals: parseJsonObject(row.qualitySignals)
    };
  }

  // ---------- RSS: briefs ----------

  saveRssBrief({ briefDate, generatedAt, scope = "auto", model = "", status = "ready", entries = [] }) {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`
          INSERT INTO rss_briefs (brief_date, generated_at, scope, model, status)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(brief_date) DO UPDATE SET
            generated_at = excluded.generated_at,
            scope = excluded.scope,
            model = excluded.model,
            status = excluded.status
        `)
        .run(briefDate, generatedAt, scope, model, status);
      const brief = this.db
        .prepare("SELECT id FROM rss_briefs WHERE brief_date = ?")
        .get(briefDate);
      this.db.prepare("DELETE FROM rss_brief_entries WHERE brief_id = ?").run(brief.id);
      const insert = this.db.prepare(`
        INSERT INTO rss_brief_entries (brief_id, entry_id, position, section, reason, score)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      entries.forEach((item, index) => {
        insert.run(brief.id, item.entryId, index, item.section || "picked", item.reason || "", item.score || 0);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getRssBrief(briefDate);
  }

  getRssBrief(briefDate) {
    const brief = this.db
      .prepare(`
        SELECT id, brief_date AS briefDate, generated_at AS generatedAt,
          scope, model, status
        FROM rss_briefs WHERE brief_date = ?
      `)
      .get(briefDate);
    if (!brief) return null;
    const items = this.db
      .prepare(`
        SELECT b.entry_id AS entryId, b.position, b.section, b.reason, b.score
        FROM rss_brief_entries b
        WHERE b.brief_id = ?
        ORDER BY b.position ASC
      `)
      .all(brief.id);
    const entriesById = new Map(
      this.listRssEntriesByIds(items.map((item) => item.entryId)).map((entry) => [entry.id, entry])
    );
    return {
      ...brief,
      entries: items
        .filter((item) => entriesById.has(item.entryId))
        .map((item) => ({
          ...item,
          entry: entriesById.get(item.entryId)
        }))
    };
  }

  // ---------- RSS: preferences ----------

  getRssPreferences() {
    const row = this.db
      .prepare("SELECT config_json AS configJson FROM rss_preferences WHERE id = 1")
      .get();
    const stored = row ? parseJsonObject(row.configJson) : {};
    return { ...RSS_DEFAULT_PREFERENCES, ...stored };
  }

  setRssPreferences(patch) {
    const next = { ...this.getRssPreferences(), ...patch };
    this.db
      .prepare(`
        INSERT INTO rss_preferences (id, config_json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
      `)
      .run(JSON.stringify(next), new Date().toISOString());
    return next;
  }

  // ---------- RSS: maintenance & backup ----------

  cleanupRssEntries({ retentionDaysRead = 30, retentionDaysMetadata = 180 } = {}) {
    const contentCutoff = new Date(Date.now() - retentionDaysRead * 86400000).toISOString();
    const metadataCutoff = new Date(Date.now() - retentionDaysMetadata * 86400000).toISOString();
    this.db.exec("BEGIN");
    try {
      // 已读且无互动的正文缓存过期后清空正文，仅留元数据
      this.db
        .prepare(`
          UPDATE rss_entries
          SET content_html = '', content_text = '', updated_at = ?
          WHERE read_state = 'read' AND starred = 0 AND read_later = 0 AND document_id IS NULL
            AND COALESCE(published_at, received_at) < ?
            AND (content_html <> '' OR content_text <> '')
        `)
        .run(new Date().toISOString(), contentCutoff);
      // 元数据也过期且无互动的条目物理删除（同时清掉无资产隐藏快照）
      this.db
        .prepare(`
          DELETE FROM documents
          WHERE is_library_visible = 0 AND source_type = 'rss'
            AND id IN (
              SELECT document_id FROM rss_entries
              WHERE document_id IS NOT NULL
                AND read_state = 'read' AND starred = 0 AND read_later = 0
                AND COALESCE(published_at, received_at) < ?
              AND NOT EXISTS (SELECT 1 FROM annotations WHERE annotations.document_id = rss_entries.document_id)
              AND NOT EXISTS (SELECT 1 FROM ai_records WHERE ai_records.document_id = rss_entries.document_id)
          )
        `)
        .run(metadataCutoff);
      const result = this.db
        .prepare(`
          DELETE FROM rss_entries
          WHERE read_state = 'read' AND starred = 0 AND read_later = 0 AND document_id IS NULL
            AND COALESCE(published_at, received_at) < ?
        `)
        .run(metadataCutoff);
      this.db.exec("COMMIT");
      return result.changes;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getRssBackupData({ includeCache = false } = {}) {
    const folders = this.db
      .prepare("SELECT id, name, position, created_at AS createdAt, updated_at AS updatedAt FROM rss_folders ORDER BY id")
      .all();
    const feeds = this.db
      .prepare(`
        SELECT id, folder_id AS folderId, title, feed_url AS feedUrl, site_url AS siteUrl,
          description, icon_url AS iconUrl, language, priority,
          fetch_interval_minutes AS fetchIntervalMinutes, etag, last_modified AS lastModified,
          last_fetched_at AS lastFetchedAt, next_fetch_at AS nextFetchAt,
          consecutive_failures AS consecutiveFailures, last_error AS lastError,
          disabled, deleted_at AS deletedAt, full_text_mode AS fullTextMode,
          ai_excluded AS aiExcluded, created_at AS createdAt, updated_at AS updatedAt
        FROM rss_feeds ORDER BY id
      `)
      .all()
      .map(normalizeRssFeed);
    const entryRows = this.db
      .prepare(`
        SELECT e.id, e.feed_id AS feedId, e.guid, e.dedupe_key AS dedupeKey,
          e.canonical_url AS canonicalUrl, e.title, e.author,
          e.published_at AS publishedAt, e.received_at AS receivedAt,
          e.summary_html AS summaryHtml, e.content_html AS contentHtml, e.content_text AS contentText,
          e.content_hash AS contentHash, e.thumbnail_url AS thumbnailUrl, e.language,
          e.estimated_read_minutes AS estimatedReadMinutes,
          e.read_state AS readState, e.starred, e.read_later AS readLater, e.hidden,
          e.read_progress AS readProgress, e.document_id AS documentId,
          e.created_at AS createdAt, e.updated_at AS updatedAt
        FROM rss_entries e ORDER BY e.id
      `)
      .all();
    const keepContent = (entry) =>
      includeCache || entry.starred || entry.read_later || entry.documentId;
    const entries = entryRows.map((row) => {
      const entry = normalizeRssEntry(row);
      if (keepContent(entry)) return entry;
      return { ...entry, summaryHtml: "", contentHtml: "", contentText: "" };
    });
    const analyses = this.db
      .prepare("SELECT entry_id AS entryId FROM rss_entry_analysis")
      .all()
      .map((row) => this.getRssEntryAnalysis(row.entryId));
    const briefs = this.db
      .prepare("SELECT brief_date AS briefDate FROM rss_briefs ORDER BY brief_date DESC")
      .all()
      .map((row) => this.getRssBrief(row.briefDate));
    return {
      folders,
      feeds,
      entries,
      analyses,
      briefs,
      preferences: this.getRssPreferences()
    };
  }

  restoreRssBackupData(rss) {
    const insertFolder = this.db.prepare(`
      INSERT INTO rss_folders (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    `);
    const insertFeed = this.db.prepare(`
      INSERT INTO rss_feeds (
        id, folder_id, title, feed_url, site_url, description, icon_url, language,
        priority, fetch_interval_minutes, etag, last_modified, last_fetched_at, next_fetch_at,
        consecutive_failures, last_error, disabled, deleted_at, full_text_mode, ai_excluded,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEntry = this.db.prepare(`
      INSERT INTO rss_entries (
        id, feed_id, guid, dedupe_key, canonical_url, title, author, published_at, received_at,
        summary_html, content_html, content_text, content_hash, thumbnail_url, language,
        estimated_read_minutes, read_state, starred, read_later, hidden, read_progress,
        document_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBrief = this.db.prepare(`
      INSERT INTO rss_briefs (id, brief_date, generated_at, scope, model, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertBriefEntry = this.db.prepare(`
      INSERT INTO rss_brief_entries (brief_id, entry_id, position, section, reason, score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const folder of rss.folders || []) {
      insertFolder.run(folder.id, folder.name, folder.position || 0, folder.createdAt, folder.updatedAt || folder.createdAt);
    }
    for (const feed of rss.feeds || []) {
      insertFeed.run(
        feed.id, feed.folderId ?? null, feed.title, feed.feedUrl, feed.siteUrl || "",
        feed.description || "", feed.iconUrl || "", feed.language || "", feed.priority || 0,
        feed.fetchIntervalMinutes || 60, feed.etag || "", feed.lastModified || "",
        feed.lastFetchedAt || null, feed.nextFetchAt || null, feed.consecutiveFailures || 0,
        feed.lastError || "", feed.disabled ? 1 : 0, feed.deletedAt || null,
        feed.fullTextMode || "feed", feed.aiExcluded ? 1 : 0,
        feed.createdAt, feed.updatedAt || feed.createdAt
      );
    }
    for (const entry of rss.entries || []) {
      insertEntry.run(
        entry.id, entry.feedId, entry.guid || "", entry.dedupeKey || `restored:${entry.id}`,
        entry.canonicalUrl || "", entry.title, entry.author || "", entry.publishedAt || null,
        entry.receivedAt || entry.createdAt, entry.summaryHtml || "", entry.contentHtml || "",
        entry.contentText || "", entry.contentHash || "", entry.thumbnailUrl || "",
        entry.language || "", entry.estimatedReadMinutes || 1, entry.readState || "unread",
        entry.starred ? 1 : 0, entry.readLater ? 1 : 0, entry.hidden ? 1 : 0,
        entry.readProgress || 0, entry.documentId ?? null,
        entry.createdAt, entry.updatedAt || entry.createdAt
      );
    }
    for (const analysis of rss.analyses || []) {
      if (!analysis) continue;
      this.saveRssEntryAnalysis(analysis.entryId, analysis);
    }
    for (const brief of rss.briefs || []) {
      if (!brief) continue;
      insertBrief.run(brief.id, brief.briefDate, brief.generatedAt, brief.scope || "auto", brief.model || "", brief.status || "ready");
      for (const item of brief.entries || []) {
        insertBriefEntry.run(brief.id, item.entryId, item.position, item.section || "picked", item.reason || "", item.score || 0);
      }
    }
    if (rss.preferences && typeof rss.preferences === "object") {
      this.setRssPreferences(rss.preferences);
    }
  }

  close() {
    this.db.close();
  }
}

function normalizeAiRecord(record) {
  return { ...record, saved: Boolean(record.saved) };
}

function normalizeRssFeed(feed) {
  return {
    ...feed,
    disabled: Boolean(feed.disabled),
    aiExcluded: Boolean(feed.aiExcluded),
    unreadCount: Number(feed.unreadCount || 0),
    entryCount: Number(feed.entryCount || 0)
  };
}

function normalizeRssEntry(entry) {
  return {
    ...entry,
    starred: Boolean(entry.starred),
    readLater: Boolean(entry.readLater),
    hidden: Boolean(entry.hidden),
    feedAiExcluded: entry.feedAiExcluded === undefined ? undefined : Boolean(entry.feedAiExcluded),
    readProgress: Number(entry.readProgress || 0),
    analysisSummary: entry.analysisSummary || null,
    recommendationReason: entry.recommendationReason || null,
    priorityScore: entry.priorityScore ?? null
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
