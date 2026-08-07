import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAnswerCitations } from "./lib/answerCitations.js";
import { APP_INFO } from "./lib/appInfo.js";
import {
  createAiProvider,
  normalizeBaseUrl,
  PROVIDER_PRESETS,
  resolveAiProviderConfig
} from "./lib/aiProvider.js";
import { EnvAiSettingsStore } from "./lib/aiSettingsStore.js";
import { isSupportedFile, parseDocumentBuffer } from "./lib/documentParser.js";
import { buildReadingMarkdown } from "./lib/markdownExport.js";
import { registerRssRoutes } from "./lib/rss/rssRoutes.js";
import { RssImageCache } from "./lib/rss/imageProxy.js";
import { RssService } from "./lib/rss/rssService.js";
import { createSafeLookup, validateRemoteUrl } from "./lib/rss/ssrfGuard.js";
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
  const envPath = options.envPath || path.join(projectRoot, ".env");
  const staticRoot = options.staticRoot || path.join(projectRoot, "public");
  const rssImageCacheDir =
    options.rssImageCacheDir || path.join(dataDir, "rss-image-cache");
  const settingsStore =
    options.settingsStore || new EnvAiSettingsStore({ envPath });
  const desktopSessionToken = options.desktopSessionToken || "";
  const storage = options.storage || new Storage({ dataDir });
  let aiProvider = options.aiProvider || createAiProvider(options.aiProviderConfig);
  const aiRequestTimeoutMs = options.aiRequestTimeoutMs || 120000;
  const uploadLimits = { ...DEFAULT_UPLOAD_LIMITS, ...options.uploadLimits };
  // AI 连接测试的请求实现，默认使用带 DNS rebinding 防护的安全实现；测试可注入 mock。
  const aiTestRequestImpl = options.aiTestRequestImpl || requestWithLookup;

  const rssService = options.rssService || new RssService({
    storage,
    aiProvider,
    uploadDir,
    allowPrivateHosts: Boolean(options.rss?.allowPrivateHosts),
    fetchImpl: options.rss?.fetchImpl,
    extractImpl: options.rss?.extractImpl
  });

  /** 应用内保存 AI 配置后重建 provider 实例，让路由和 RSS 服务立即使用新配置。 */
  function reloadAiProvider(config) {
    aiProvider = createAiProvider(config);
    if (rssService && typeof rssService.setAiProvider === "function") {
      rssService.setAiProvider(aiProvider);
    }
    return aiProvider;
  }
  const rssImageCache = options.rssImageCache || new RssImageCache({
    cacheDir: rssImageCacheDir,
    allowPrivateHosts: Boolean(options.rss?.allowPrivateHosts),
    fetchImpl: options.rss?.imageFetchImpl
  });

  const app = express();
  app.locals.storage = storage;
  app.locals.rssService = rssService;
  app.locals.rssImageCache = rssImageCache;
  app.disable("x-powered-by");
  app.use(setSecurityHeaders);
  if (desktopSessionToken) {
    app.use(createDesktopSessionGuard(desktopSessionToken));
  }
  app.use(express.json({ limit: "220mb" }));
  app.use(express.static(staticRoot));
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

  app.get("/api/ai/settings", async (req, res) => {
    try {
      const stored = await settingsStore.read();
      return res.json({
        provider: stored.provider || "mock",
        baseUrl: stored.baseUrl || "",
        model: stored.model || "",
        hasApiKey: Boolean(stored.apiKey),
        providers: listProviderOptions()
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/settings", async (req, res) => {
    try {
      const input = normalizeAiSettingsInput(req.body);
      const current = await settingsStore.read();
      const fullConfig = resolveFullAiConfig(input, current);
      const saved = await settingsStore.write(fullConfig);
      const reloaded = reloadAiProvider(saved.config);
      const status = reloaded.getStatus();
      return res.json({ ok: true, ...status, hasApiKey: Boolean(saved.apiKey) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/ai/settings/test", async (req, res) => {
    try {
      const input = normalizeAiSettingsInput(req.body);
      const current = await settingsStore.read();
      const fullConfig = resolveFullAiConfig(input, current);
      const result = await testAiConnection(fullConfig, {
        requestImpl: aiTestRequestImpl
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
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

const PROVIDER_LABELS = Object.freeze({
  deepseek: "DeepSeek",
  openai: "OpenAI",
  kimi: "Moonshot Kimi",
  zhipu: "智谱 GLM",
  qwen: "通义千问 Qwen",
  ollama: "Ollama（本地）",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  "openai-compatible": "OpenAI-compatible（任意兼容服务）",
  mock: "Mock（试用）"
});

const PROVIDER_DESCRIPTIONS = Object.freeze({
  deepseek: "DeepSeek 官方 OpenAI 兼容接口，默认地址 https://api.deepseek.com。",
  openai: "OpenAI 官方接口，默认地址 https://api.openai.com/v1。",
  kimi: "月之暗面 Kimi，OpenAI 兼容，默认地址 https://api.moonshot.cn/v1。",
  zhipu: "智谱 GLM，OpenAI 兼容，默认地址 https://open.bigmodel.cn/api/paas/v4。",
  qwen: "通义千问 Qwen 的 OpenAI 兼容模式（DashScope compatible-mode）。",
  ollama: "本地 Ollama 服务的 OpenAI 兼容端点（默认 http://127.0.0.1:11434/v1），无需 API Key。",
  anthropic: "Anthropic Claude 原生 Messages 协议。",
  gemini: "Google Gemini 原生 generateContent 协议。",
  "openai-compatible":
    "任意实现 OpenAI Chat Completions API（/chat/completions）的服务都可使用此项：填入服务根地址和模型即可，例如 SiliconFlow、Together、Groq、自建代理等。",
  mock: "本地 Mock 模式，不调用真实模型，仅用于流程试用。"
});

const VALID_AI_PROVIDERS = new Set([
  "mock",
  "openai-compatible",
  ...Object.keys(PROVIDER_PRESETS)
]);

function listProviderOptions() {
  const options = Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({
    key,
    label: PROVIDER_LABELS[key] || key,
    description: PROVIDER_DESCRIPTIONS[key] || "",
    type: preset.type,
    baseUrl: preset.baseUrl,
    model: preset.model,
    requiresKey: preset.requiresKey
  }));
  options.push({
    key: "openai-compatible",
    label: PROVIDER_LABELS["openai-compatible"],
    description: PROVIDER_DESCRIPTIONS["openai-compatible"],
    type: "openai-compatible",
    baseUrl: "",
    model: "",
    requiresKey: true
  });
  options.push({
    key: "mock",
    label: PROVIDER_LABELS.mock,
    description: PROVIDER_DESCRIPTIONS.mock,
    type: "mock",
    baseUrl: "",
    model: "",
    requiresKey: false
  });
  return options;
}

/** 剔除换行与控制字符，防止通过 .env 写入注入新的键。 */
function sanitizeEnvValue(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

function normalizeAiSettingsInput(body) {
  const provider = String(body?.provider ?? "").trim().toLowerCase();
  if (!VALID_AI_PROVIDERS.has(provider)) {
    throw new HttpError(400, `Unknown AI provider: ${provider}`);
  }
  return {
    provider,
    apiKey: sanitizeEnvValue(body?.apiKey),
    baseUrl: sanitizeEnvValue(body?.baseUrl),
    model: sanitizeEnvValue(body?.model),
    clearKey: body?.clearKey === true
  };
}

function resolveFullAiConfig(input, current) {
  if (input.provider === "mock") {
    return {
      provider: "mock",
      apiKey: input.clearKey ? "" : input.apiKey || current.apiKey || "",
      baseUrl: input.baseUrl || current.baseUrl || "",
      model: input.model || current.model || "",
      clearKey: input.clearKey
    };
  }
  const resolved = resolveAiProviderConfig(aiSettingsToProviderConfig(input, current));
  if (!resolved.model) {
    throw new HttpError(400, "该接口需要填写模型名称（AI_MODEL）");
  }
  return {
    provider: resolved.provider,
    apiKey: input.clearKey ? "" : resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    clearKey: input.clearKey
  };
}

/** 桌面会话鉴权：只接受回环 Host + 固定长度随机令牌，拒绝一切未认证访问。 */
function createDesktopSessionGuard(token) {
  const expected = Buffer.from(token, "utf8");
  return (req, res, next) => {
    if (!isLoopbackHost(req.headers.host, req.socket.localPort)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const header = req.headers["x-wenche-session"];
    if (
      typeof header !== "string" ||
      header.length !== expected.length ||
      !timingSafeEqual(Buffer.from(header, "utf8"), expected)
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  };
}

function isLoopbackHost(host, localPort) {
  if (typeof host !== "string" || !host) return false;
  const match = host
    .toLowerCase()
    .match(/^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/);
  if (!match) return false;
  const port = match[2];
  return port === undefined || Number(port) === Number(localPort);
}

function buildTestRequest(resolved) {
  if (resolved.provider === "ollama") {
    const root = normalizeBaseUrl(resolved.baseUrl).replace(/\/v1$/, "");
    return { uri: `${root}/api/tags`, headers: {} };
  }
  if (resolved.type === "anthropic") {
    const root = normalizeBaseUrl(resolved.baseUrl).replace(/\/v1$/, "");
    return {
      uri: `${root}/v1/models`,
      headers: { "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" }
    };
  }
  if (resolved.type === "gemini") {
    const root = normalizeBaseUrl(resolved.baseUrl).replace(/\/v1beta$/, "");
    return { uri: `${root}/v1beta/models`, headers: { "x-goog-api-key": resolved.apiKey } };
  }
  const headers = resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {};
  return { uri: `${normalizeBaseUrl(resolved.baseUrl)}/models`, headers };
}

function providerTestErrorMessage(text) {
  const truncated = String(text || "").slice(0, 300);
  try {
    const payload = JSON.parse(truncated);
    return String(payload?.error?.message || payload?.message || "request failed").slice(0, 200);
  } catch {
    return truncated || "request failed";
  }
}

/** 表单中的空字符串视为「使用预设/环境默认」，避免空值覆盖预设默认地址。 */
function aiSettingsToProviderConfig(input, current = {}) {
  return {
    provider: input.provider,
    apiKey: input.apiKey || current.apiKey || "",
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.model ? { model: input.model } : {})
  };
}

/** 带 DNS rebinding 防护的 GET 请求：解析出的内网/回环地址会被 createSafeLookup 拒绝。 */
async function requestWithLookup(url, { headers, allowPrivateHosts, signal, maxBytes = 64 * 1024 }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("无效的 API 地址"));
      return;
    }
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      parsed,
      { method: "GET", headers, lookup: createSafeLookup({ allowPrivateHosts }) },
      (response) => {
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy(new Error("响应体过大"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("error", reject);
    if (signal) {
      signal.addEventListener("abort", () => req.destroy(new Error("连接超时。")), { once: true });
    }
    req.end();
  });
}

async function testAiConnection(input, { requestImpl } = {}) {
  const request = requestImpl || requestWithLookup;
  if (input.provider === "mock") {
    return { ok: true, message: "Mock 模式无需连接检查。" };
  }
  const resolved = resolveAiProviderConfig(aiSettingsToProviderConfig(input));
  if (resolved.requiresKey && !resolved.apiKey) {
    return { ok: false, message: "需要提供 API Key 才能测试连接。" };
  }

  // 与 RSS 抓取一致的安全基线：字面地址校验 + DNS 解析层防护。
  // Ollama 预设指向本机回环，属于合法本地场景，字面校验放行且允许私网解析。
  const allowPrivateHosts = resolved.provider === "ollama";
  if (!allowPrivateHosts) {
    try {
      validateRemoteUrl(resolved.baseUrl);
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  const { uri, headers } = buildTestRequest(resolved);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await request(uri, {
      headers,
      signal: controller.signal,
      allowPrivateHosts
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        message: `连接失败（HTTP ${response.status}）：${providerTestErrorMessage(response.text)}`
      };
    }
    let payload = null;
    try {
      payload = JSON.parse(response.text);
    } catch {
      // 忽略无法解析的响应体
    }
    const models = Array.isArray(payload?.data)
      ? payload.data.map((item) => item?.id).filter(Boolean)
      : [];
    if (models.length && resolved.model && !models.includes(resolved.model)) {
      return { ok: true, message: `连接成功，但模型列表中没有 ${resolved.model}，请核对模型名称。`, models };
    }
    return { ok: true, message: "连接成功。", models };
  } catch (error) {
    const message = error.message === "连接超时。" || error.name === "AbortError"
      ? "连接超时。"
      : `连接失败：${error.message}`;
    return { ok: false, message };
  } finally {
    clearTimeout(timeoutId);
  }
}

