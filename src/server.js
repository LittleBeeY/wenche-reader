import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAnswerCitations } from "./lib/answerCitations.js";
import { APP_INFO } from "./lib/appInfo.js";
import { createAiProvider } from "./lib/aiProvider.js";
import { isSupportedFile, parseDocumentBuffer } from "./lib/documentParser.js";
import { loadEnvFile } from "./lib/env.js";
import { buildReadingMarkdown } from "./lib/markdownExport.js";
import { registerRssRoutes } from "./lib/rss/rssRoutes.js";
import { RssImageCache } from "./lib/rss/imageProxy.js";
import { RssScheduler } from "./lib/rss/rssScheduler.js";
import { RssService } from "./lib/rss/rssService.js";
import { buildContextBundle } from "./lib/selectionContext.js";
import { CURRENT_DOCUMENT_FORMAT_VERSION, Storage } from "./lib/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_UPLOAD_LIMITS = Object.freeze({
  maxFilesPerBatch: 50,
  maxFileBytes: 25 * 1024 * 1024,
  maxBatchBytes: 60 * 1024 * 1024
});

const MAX_QUESTION_CHARS = 6000;
const MAX_SELECTION_CHARS = 50000;
const MAX_NOTE_CHARS = 20000;
const MAX_BACKUP_BYTES = 150 * 1024 * 1024;
const VALID_AI_MODES = new Set(["direct", "deep", "custom"]);
const VALID_AI_SCOPES = new Set(["selection", "page", "section", "document"]);
const MAX_SELECTION_ANCHORS = 100;
const AI_CONTEXT_BUDGETS = Object.freeze({
  direct: Object.freeze({ selection: 6000, page: 8000, section: 9000, document: 9000 }),
  deep: Object.freeze({ selection: 12000, page: 14000, section: 16000, document: 16000 }),
  custom: Object.freeze({ selection: 9000, page: 12000, section: 15000, document: 16000 })
});
const VALID_ANNOTATION_KINDS = new Set(["highlight", "note", "bookmark"]);
const VALID_HIGHLIGHT_COLORS = new Set(["yellow", "green", "blue", "rose"]);

export function createApp(options = {}) {
  const dataDir = options.dataDir || path.join(projectRoot, "data");
  const uploadDir = options.uploadDir || path.join(projectRoot, "uploads");
  const storage = options.storage || new Storage({ dataDir });
  const aiProvider = options.aiProvider || createAiProvider(options.aiProviderConfig);
  const aiRequestTimeoutMs = options.aiRequestTimeoutMs || 120000;
  const uploadLimits = { ...DEFAULT_UPLOAD_LIMITS, ...options.uploadLimits };

  const rssService = options.rssService || new RssService({
    storage,
    aiProvider,
    uploadDir,
    allowPrivateHosts: Boolean(options.rss?.allowPrivateHosts),
    fetchImpl: options.rss?.fetchImpl,
    extractImpl: options.rss?.extractImpl
  });
  const rssImageCache = options.rssImageCache || new RssImageCache({
    cacheDir: path.join(dataDir, "rss-image-cache"),
    allowPrivateHosts: Boolean(options.rss?.allowPrivateHosts),
    fetchImpl: options.rss?.imageFetchImpl
  });

  const app = express();
  app.locals.storage = storage;
  app.locals.rssService = rssService;
  app.locals.rssImageCache = rssImageCache;
  app.disable("x-powered-by");
  app.use(setSecurityHeaders);
  app.use(express.json({ limit: "220mb" }));
  app.use(express.static(path.join(projectRoot, "public")));
  app.get("/vendor/marked.min.js", (req, res) => {
    res.sendFile(path.join(projectRoot, "node_modules", "marked", "lib", "marked.umd.js"));
  });
  app.get("/vendor/purify.min.js", (req, res) => {
    res.sendFile(path.join(projectRoot, "node_modules", "dompurify", "dist", "purify.min.js"));
  });
  app.get("/vendor/jszip.min.js", (req, res) => {
    res.sendFile(path.join(projectRoot, "node_modules", "jszip", "dist", "jszip.min.js"));
  });
  app.get("/vendor/docx-preview.min.js", (req, res) => {
    res.sendFile(path.join(projectRoot, "node_modules", "docx-preview", "dist", "docx-preview.min.js"));
  });

  app.get("/api/documents", (req, res) => {
    return res.json({ documents: storage.listDocuments() });
  });

  app.get("/api/health", (req, res) => {
    return res.json({ ...APP_INFO, status: "ok" });
  });

  app.get("/api/archives", (req, res) => {
    return res.json({ archives: storage.listArchiveCategories() });
  });

  app.post("/api/archives", (req, res) => {
    try {
      const name = normalizeRequiredCategory(req.body?.name);
      if (!name || name === "未分类") {
        return res.status(400).json({ error: "archive name is required" });
      }
      return res.status(201).json(storage.createArchiveCategory(name));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/archives/:id", (req, res) => {
    try {
      const name = normalizeRequiredCategory(req.body?.name);
      if (!name || name === "未分类") {
        return res.status(400).json({ error: "archive name is required" });
      }
      const archive = storage.renameArchiveCategory(Number(req.params.id), name);
      if (!archive) return res.status(404).json({ error: "Archive not found" });
      return res.json(archive);
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint")) {
        return res.status(409).json({ error: "Archive name already exists" });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/archives/:id", (req, res) => {
    try {
      const result = storage.deleteArchiveCategory(Number(req.params.id));
      if (!result) return res.status(404).json({ error: "Archive not found" });
      if (!result.deleted) {
        return res.status(409).json({ error: "Archive must be empty before deletion" });
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/annotations", (req, res) => {
    try {
      const annotation = normalizeAnnotationInput(req.body, storage);
      return res.status(201).json(storage.createAnnotation(annotation));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.patch("/api/annotations/:id", (req, res) => {
    try {
      const existing = storage.getAnnotation(Number(req.params.id));
      if (!existing) return res.status(404).json({ error: "Annotation not found" });
      const note = normalizeBoundedText(req.body?.note, MAX_NOTE_CHARS, "note");
      const color = normalizeHighlightColor(req.body?.color || existing.color);
      return res.json(storage.updateAnnotation(existing.id, { note, color }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete("/api/annotations/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!storage.deleteAnnotation(id)) {
        return res.status(404).json({ error: "Annotation not found" });
      }
      return res.json({ deleted: true, id });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/ai/records/:id", (req, res) => {
    try {
      const existing = storage.getAiRecord(Number(req.params.id));
      if (!existing) return res.status(404).json({ error: "AI record not found" });
      const saved = Boolean(req.body?.saved);
      const title = normalizeBoundedText(
        req.body?.title || existing.savedTitle || modeTitle(existing.mode),
        160,
        "title"
      );
      const note = normalizeBoundedText(req.body?.note ?? existing.savedNote, MAX_NOTE_CHARS, "note");
      return res.json(storage.updateAiRecord(existing.id, { saved, title, note }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/knowledge", (req, res) => {
    return res.json({ items: storage.listKnowledgeItems() });
  });

  app.get("/api/export/markdown", (req, res) => {
    try {
      const requestedDocumentId = req.query.documentId
        ? Number(req.query.documentId)
        : null;
      const snapshot = storage.getBackupData();
      const documents = requestedDocumentId
        ? snapshot.documents.filter((document) => Number(document.id) === requestedDocumentId)
        : snapshot.documents;
      if (requestedDocumentId && documents.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }
      const documentIds = new Set(documents.map((document) => Number(document.id)));
      const markdown = buildReadingMarkdown({
        documents,
        annotations: snapshot.annotations.filter((item) => documentIds.has(Number(item.documentId))),
        aiRecords: snapshot.aiRecords.filter((item) => documentIds.has(Number(item.documentId))),
        createdAt: new Date().toISOString()
      });
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="wenche-notes-${date}.md"`);
      return res.send(markdown);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/backup", async (req, res) => {
    try {
      const includeRssCache = req.query.includeRssCache === "1";
      const snapshot = storage.getBackupData();
      const documents = [];
      for (const document of snapshot.documents) {
        let originalFileBase64 = "";
        try {
          originalFileBase64 = (await readFile(document.filePath)).toString("base64");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const { filePath, ...metadata } = document;
        documents.push({ ...metadata, originalFileBase64 });
      }
      const backup = {
        format: "wenche-reader-backup",
        version: 2,
        createdAt: new Date().toISOString(),
        archives: snapshot.archives,
        documents,
        blocks: snapshot.blocks,
        aiRecords: snapshot.aiRecords,
        annotations: snapshot.annotations,
        rss: storage.getRssBackupData({ includeCache: includeRssCache })
      };
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="wenche-backup-${date}.json"`);
      return res.send(JSON.stringify(backup));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/backup/restore", async (req, res) => {
    const createdPaths = [];
    let restored = false;
    try {
      const snapshot = validateBackup(req.body);
      const oldDocuments = storage.getBackupData().documents;
      const filePaths = new Map();
      let totalBytes = 0;
      await mkdir(uploadDir, { recursive: true });

      for (const document of snapshot.documents) {
        const buffer = document.originalFileBase64
          ? decodeUpload(document.originalFileBase64, DEFAULT_UPLOAD_LIMITS.maxFileBytes)
          : Buffer.alloc(0);
        totalBytes += buffer.length;
        if (totalBytes > MAX_BACKUP_BYTES) {
          throw new HttpError(413, "Backup files exceed the restore size limit");
        }
        if (buffer.length > 0) validateFileSignature(document.originalName, buffer);
        const safeName = `${randomUUID()}-${document.originalName.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")}`;
        const filePath = path.join(uploadDir, safeName);
        await writeFile(filePath, buffer);
        createdPaths.push(filePath);
        filePaths.set(Number(document.id), filePath);
      }

      storage.restoreBackupData(snapshot, filePaths);
      restored = true;
      for (const document of oldDocuments) {
        try {
          await deleteUploadedFile(document.filePath, uploadDir);
        } catch {}
      }
      return res.json({ restored: true, documentCount: snapshot.documents.length });
    } catch (error) {
      if (!restored) {
        for (const filePath of createdPaths) {
          try {
            await unlink(filePath);
          } catch {}
        }
      }
      return sendError(res, error);
    }
  });

  app.post("/api/documents/batch", async (req, res) => {
    try {
      const { documents, category } = req.body || {};
      if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: "documents must be a non-empty array" });
      }
      validateUploadBatch(documents, uploadLimits);

      const created = [];
      const errors = [];
      for (const item of documents) {
        try {
          created.push(
            await saveUploadedDocument({
              item,
              category,
              storage,
              uploadDir,
              uploadLimits
            })
          );
        } catch (error) {
          errors.push({ name: item?.name || "unknown", error: error.message });
        }
      }

      return res.status(201).json({ documents: created, errors });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/documents", async (req, res) => {
    try {
      const document = await saveUploadedDocument({
        item: req.body,
        category: req.body?.category,
        storage,
        uploadDir,
        uploadLimits
      });

      return res.status(201).json(document);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/documents/batch-delete", async (req, res) => {
    try {
      const ids = normalizeDocumentIds(req.body?.ids);
      if (ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }

      const documents = ids.map((id) => storage.getDocument(id));
      if (documents.some((document) => !document)) {
        return res.status(404).json({ error: "Document not found" });
      }

      for (const document of documents) {
        await deleteUploadedFile(document.filePath, uploadDir);
      }

      const count = storage.deleteDocuments(ids);
      return res.json({ deleted: true, ids, count });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/documents/batch-category", (req, res) => {
    try {
      const ids = normalizeDocumentIds(req.body?.ids);
      const category = normalizeRequiredCategory(req.body?.category);
      if (ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      if (!category) {
        return res.status(400).json({ error: "category is required" });
      }

      const documents = ids.map((id) => storage.getDocument(id));
      if (documents.some((document) => !document)) {
        return res.status(404).json({ error: "Document not found" });
      }

      const count = storage.updateDocumentsCategory(ids, category);
      return res.json({ updated: true, ids, category, count });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      let document = storage.getDocument(Number(req.params.id));
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      if (document.formatVersion < CURRENT_DOCUMENT_FORMAT_VERSION) {
        document = await upgradeDocumentFormatting(document, storage);
      }
      return res.json(document);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/:id/source", (req, res) => {
    try {
      const document = storage.getDocument(Number(req.params.id));
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      const sourcePath = resolveUploadedFilePath(document.filePath, uploadDir, "access");
      res.type(path.extname(document.originalName));
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      return res.sendFile(sourcePath);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const document = storage.getDocument(Number(req.params.id));
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      await deleteUploadedFile(document.filePath, uploadDir);
      storage.deleteDocument(document.id);
      return res.json({ deleted: true, id: document.id });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/explain", async (req, res) => {
    return handleAiRequest({
      req,
      res,
      storage,
      aiProvider,
      defaultMode: "direct",
      timeoutMs: aiRequestTimeoutMs
    });
  });

  app.get("/api/ai/status", (req, res) => {
    if (typeof aiProvider.getStatus === "function") {
      return res.json(aiProvider.getStatus());
    }
    return res.json({ provider: aiProvider.name || "unknown", configured: false });
  });

  app.post("/api/ai/ask", async (req, res) => {
    return handleAiRequest({
      req,
      res,
      storage,
      aiProvider,
      defaultMode: "custom",
      timeoutMs: aiRequestTimeoutMs
    });
  });

  registerRssRoutes(app, { rssService, storage, rssImageCache });

  app.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body exceeds the local size limit" });
    }
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ error: "Request body must be valid JSON" });
    }
    return next(error);
  });

  return app;
}

async function upgradeDocumentFormatting(document, storage) {
  try {
    const buffer = await readFile(document.filePath);
    const parsed = await parseDocumentBuffer({
      originalName: document.originalName,
      buffer
    });
    storage.replaceDocumentContent({
      documentId: document.id,
      title: parsed.title,
      renderHtml: parsed.renderHtml || "",
      blocks: parsed.blocks
    });
    return storage.getDocument(document.id);
  } catch {
    return document;
  }
}

async function saveUploadedDocument({
  item,
  category,
  storage,
  uploadDir,
  uploadLimits = DEFAULT_UPLOAD_LIMITS
}) {
  const { name, mimeType, contentBase64 } = item || {};
  if (typeof name !== "string" || !name || typeof contentBase64 !== "string" || !contentBase64) {
    throw new HttpError(400, "name and contentBase64 are required");
  }
  if (name.length > 240 || path.basename(name) !== name) {
    throw new HttpError(400, "File name is invalid or too long");
  }
  if (!isSupportedFile(name)) {
    throw new HttpError(400, "Unsupported file type");
  }

  const buffer = decodeUpload(contentBase64, uploadLimits.maxFileBytes);
  validateFileSignature(name, buffer);
  let parsed;
  try {
    parsed = await parseDocumentBuffer({ originalName: name, buffer });
  } catch (error) {
    throw new HttpError(400, `Could not parse ${name}: ${error.message}`);
  }
  const safeName = `${randomUUID()}-${name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")}`;
  await mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, safeName);
  await writeFile(filePath, buffer);

  return storage.createDocument({
    title: parsed.title,
    originalName: name,
    mimeType,
    filePath,
    category: normalizeCategory(category),
    renderHtml: parsed.renderHtml || "",
    blocks: parsed.blocks
  });
}

function normalizeCategory(category) {
  return typeof category === "string" && category.trim()
    ? category.trim().slice(0, 80)
    : "未分类";
}

function normalizeRequiredCategory(category) {
  return typeof category === "string" && category.trim()
    ? category.trim().slice(0, 80)
    : "";
}

function normalizeDocumentIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => Number(id)))].filter(
    (id) => Number.isInteger(id) && id > 0
  );
}

function normalizeAnnotationInput(input, storage) {
  const documentId = Number(input?.documentId);
  if (!Number.isInteger(documentId) || !storage.getDocument(documentId)) {
    throw new HttpError(404, "Document not found");
  }
  const kind = String(input?.kind || "");
  if (!VALID_ANNOTATION_KINDS.has(kind)) {
    throw new HttpError(400, "Invalid annotation kind");
  }
  const pageIndex = Number(input?.pageIndex || 0);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new HttpError(400, "pageIndex must be a non-negative integer");
  }
  const selectedText = normalizeBoundedText(input?.selectedText, MAX_SELECTION_CHARS, "selectedText");
  const note = normalizeBoundedText(input?.note, MAX_NOTE_CHARS, "note");
  if (kind !== "bookmark" && !selectedText.trim()) {
    throw new HttpError(400, "Selected text is required for highlights and notes");
  }
  const blockIds = normalizeDocumentIds(input?.blockIds);
  return {
    documentId,
    kind,
    pageIndex,
    selectedText,
    blockIds,
    note,
    color: normalizeHighlightColor(input?.color)
  };
}

function normalizeBoundedText(value, maxChars, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxChars) {
    throw new HttpError(400, `${field} must not exceed ${maxChars} characters`);
  }
  return text;
}

function normalizeHighlightColor(value) {
  const color = typeof value === "string" && value ? value : "yellow";
  if (!VALID_HIGHLIGHT_COLORS.has(color)) {
    throw new HttpError(400, "Invalid highlight color");
  }
  return color;
}

function modeTitle(mode) {
  return mode === "deep" ? "深入解析" : mode === "custom" ? "自定义提问" : "解析";
}

function validateBackup(snapshot) {
  if (snapshot?.format !== "wenche-reader-backup" || ![1, 2].includes(snapshot?.version)) {
    throw new HttpError(400, "Unsupported backup file");
  }
  for (const key of ["archives", "documents", "blocks", "aiRecords", "annotations"]) {
    if (!Array.isArray(snapshot[key])) {
      throw new HttpError(400, `Backup field ${key} must be an array`);
    }
  }
  if (snapshot.documents.length > 5000) {
    throw new HttpError(413, "Backup contains too many documents");
  }
  const documentIds = new Set();
  for (const document of snapshot.documents) {
    const id = Number(document.id);
    if (!Number.isInteger(id) || id <= 0 || documentIds.has(id)) {
      throw new HttpError(400, "Backup contains invalid document ids");
    }
    if (
      typeof document.originalName !== "string" ||
      !document.originalName ||
      path.basename(document.originalName) !== document.originalName ||
      !isSupportedFile(document.originalName)
    ) {
      throw new HttpError(400, "Backup contains an invalid document name");
    }
    documentIds.add(id);
  }
  for (const collection of [snapshot.blocks, snapshot.aiRecords, snapshot.annotations]) {
    if (collection.some((item) => !documentIds.has(Number(item.documentId)))) {
      throw new HttpError(400, "Backup contains orphaned records");
    }
  }
  return snapshot;
}

async function deleteUploadedFile(filePath, uploadDir) {
  const resolvedFile = resolveUploadedFilePath(filePath, uploadDir, "delete");

  try {
    await unlink(resolvedFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function resolveUploadedFilePath(filePath, uploadDir, action) {
  const uploadRoot = path.resolve(uploadDir);
  const resolvedFile = path.resolve(filePath);
  const relativePath = path.relative(uploadRoot, resolvedFile);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to ${action} a file outside the upload directory`);
  }
  return resolvedFile;
}

function resolveAiScope({ requestedScope, mode, selection }) {
  if (VALID_AI_SCOPES.has(requestedScope)) return requestedScope;
  const hasSelection =
    Boolean(selection.text.trim()) ||
    selection.blockIds.length > 0 ||
    selection.anchors.length > 0;
  if (hasSelection) return "selection";
  return mode === "custom" ? "document" : "page";
}

function normalizeAiSelection(selection, blocks) {
  const blockById = new Map((blocks || []).map((block) => [Number(block.id), block]));
  const blockIds = [
    ...(Array.isArray(selection.blockIds) ? selection.blockIds : []),
    ...(Array.isArray(selection.anchors)
      ? selection.anchors.map((anchor) => anchor?.blockId)
      : [])
  ]
    .map((id) => Number(id))
    .filter((id, index, ids) => blockById.has(id) && ids.indexOf(id) === index);

  const rawAnchors = Array.isArray(selection.anchors)
    ? selection.anchors.slice(0, MAX_SELECTION_ANCHORS)
    : [];
  const anchors = rawAnchors.flatMap((anchor) => {
    const blockId = Number(anchor?.blockId);
    const block = blockById.get(blockId);
    const startOffset = Number(anchor?.startOffset);
    const endOffset = Number(anchor?.endOffset);
    if (
      !block ||
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      startOffset < 0 ||
      endOffset < startOffset
    ) {
      return [];
    }
    return [{
      blockId,
      startOffset: Math.min(startOffset, block.text.length),
      endOffset: Math.min(endOffset, block.text.length)
    }];
  });

  return {
    text: selection.text.trim(),
    blockIds,
    anchors,
    pageIndex:
      Number.isInteger(selection.pageIndex) && selection.pageIndex >= 0
        ? selection.pageIndex
        : null
  };
}

async function handleAiRequest({
  req,
  res,
  storage,
  aiProvider,
  defaultMode,
  timeoutMs
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortProvider = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", abortProvider);
  try {
    const {
      documentId,
      mode = defaultMode,
      scope: requestedScope,
      selection = {},
      question = ""
    } = req.body || {};
    const normalizedSelection = selection && typeof selection === "object"
      ? { ...selection, text: selection.text ?? "" }
      : { text: "", blockIds: [], anchors: [] };
    if (!VALID_AI_MODES.has(mode)) {
      return res.status(400).json({ error: "Invalid AI mode" });
    }
    if (typeof question !== "string" || question.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `Question must not exceed ${MAX_QUESTION_CHARS} characters` });
    }
    if (
      typeof normalizedSelection.text !== "string" ||
      normalizedSelection.text.length > MAX_SELECTION_CHARS
    ) {
      return res.status(400).json({ error: `Selection must not exceed ${MAX_SELECTION_CHARS} characters` });
    }
    const document = storage.getDocument(Number(documentId));
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    const safeSelection = normalizeAiSelection(normalizedSelection, document.blocks);
    const selectedText = safeSelection.text;
    const scope = resolveAiScope({
      requestedScope,
      mode,
      selection: safeSelection
    });
    const searchBlockIds = scope === "document"
      ? storage.searchDocumentBlocks(document.id, question || selectedText, 14)
      : [];
    const contextBundle = buildContextBundle({
      blocks: document.blocks,
      selection: safeSelection,
      scope,
      question,
      radius: mode === "deep" ? 2 : 1,
      maxChars: AI_CONTEXT_BUDGETS[mode][scope],
      searchBlockIds
    });
    const context = contextBundle.text;
    const aiInput = {
      mode,
      selectedText,
      context,
      question,
      documentTitle: document.title,
      signal: controller.signal
    };
    const wantsStream = req.get("accept")?.includes("text/event-stream") &&
      typeof aiProvider.streamExplain === "function";
    let result;
    if (wantsStream) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      writeSse(res, "start", {
        mode,
        scope,
        sources: contextBundle.sources
      });
      result = await aiProvider.streamExplain(aiInput, async (delta) => {
        if (!res.destroyed) writeSse(res, "delta", { delta });
      });
    } else {
      result = await aiProvider.explain(aiInput);
    }

    if (result.finishReason === "length") {
      const message = "AI 回答达到长度上限，未完整生成，请重试。";
      if (wantsStream) {
        writeSse(res, "error", { error: message });
        return res.end();
      }
      return res.status(502).json({ error: message });
    }

    const citations = validateAnswerCitations(result.answer, contextBundle.sources);
    result.answer = citations.answer;
    const usage = result.usage || {};
    const recordId = storage.addAiRecord({
      documentId: document.id,
      mode,
      scope,
      question,
      selectedText,
      selectionAnchors: safeSelection.anchors,
      context,
      contextBlockIds: contextBundle.blockIds,
      contextSources: contextBundle.sources,
      answer: result.answer,
      provider: result.provider,
      model: result.model || "",
      promptVersion: result.promptVersion || "",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: result.latencyMs,
      firstTokenMs: result.firstTokenMs,
      contextChars: context.length
    });

    if (wantsStream) {
      writeSse(res, "done", {
        ...result,
        recordId,
        scope,
        sources: contextBundle.sources,
        citedSourceIds: citations.citedSourceIds,
        invalidCitationCount: citations.invalidCitationCount
      });
      return res.end();
    }
    return res.json({
      ...result,
      recordId,
      scope,
      sources: contextBundle.sources,
      citedSourceIds: citations.citedSourceIds,
      invalidCitationCount: citations.invalidCitationCount
    });
  } catch (error) {
    if (timedOut && !res.destroyed) {
      if (res.headersSent) {
        writeSse(res, "error", { error: "AI provider request timed out" });
        return res.end();
      }
      return res.status(504).json({ error: "AI provider request timed out" });
    }
    if (controller.signal.aborted || res.destroyed) return;
    if (res.headersSent) {
      writeSse(res, "error", { error: error.message });
      return res.end();
    }
    return res.status(500).json({ error: error.message });
  } finally {
    clearTimeout(timeoutId);
    res.off("close", abortProvider);
  }
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function setSecurityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", [
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
  ].join("; "));
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}

function validateUploadBatch(documents, limits) {
  if (documents.length > limits.maxFilesPerBatch) {
    throw new HttpError(413, `A batch may contain at most ${limits.maxFilesPerBatch} files`);
  }

  let totalBytes = 0;
  for (const item of documents) {
    if (
      typeof item?.name !== "string" ||
      !item.name ||
      typeof item?.contentBase64 !== "string" ||
      !item.contentBase64
    ) {
      throw new HttpError(400, "Each document requires name and contentBase64");
    }
    if (item.name.length > 240 || path.basename(item.name) !== item.name) {
      throw new HttpError(400, "File name is invalid or too long");
    }
    if (!isSupportedFile(item.name)) {
      throw new HttpError(400, `Unsupported file type: ${item.name}`);
    }
    const decodedBytes = estimateBase64Bytes(item.contentBase64, limits.maxFileBytes);
    totalBytes += decodedBytes;
    if (totalBytes > limits.maxBatchBytes) {
      throw new HttpError(413, "Upload batch exceeds the total size limit");
    }
  }
}

function decodeUpload(contentBase64, maxFileBytes) {
  const decodedBytes = estimateBase64Bytes(contentBase64, maxFileBytes);
  const normalized = contentBase64.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new HttpError(400, "contentBase64 must be valid Base64 data");
  }

  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length !== decodedBytes) {
    throw new HttpError(400, "contentBase64 must be valid Base64 data");
  }
  return buffer;
}

function estimateBase64Bytes(contentBase64, maxFileBytes) {
  if (typeof contentBase64 !== "string" || !contentBase64) {
    throw new HttpError(400, "contentBase64 must be a non-empty string");
  }
  const normalized = contentBase64.replace(/\s/g, "");
  const normalizedLength = normalized.length;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const decodedBytes = Math.floor((normalizedLength * 3) / 4) - padding;
  if (decodedBytes > maxFileBytes) {
    throw new HttpError(413, "File exceeds the 25 MB size limit");
  }
  return decodedBytes;
}

function validateFileSignature(name, buffer) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".pdf" && !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new HttpError(400, "File content does not match the PDF extension");
  }
  if ([".docx", ".epub"].includes(extension)) {
    const signature = buffer.subarray(0, 4).toString("hex");
    if (!["504b0304", "504b0506", "504b0708"].includes(signature)) {
      throw new HttpError(400, `File content does not match the ${extension} extension`);
    }
  }
}

function sendError(res, error) {
  return res.status(error?.statusCode || 500).json({ error: error.message });
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFile(path.join(projectRoot, ".env"));
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`${APP_INFO.name} V${APP_INFO.version} running at http://${host}:${port}`);
    const scheduler = new RssScheduler({ rssService: app.locals.rssService });
    scheduler.start();
  });
}
