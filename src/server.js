import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_INFO } from "./lib/appInfo.js";
import { createAiProvider } from "./lib/aiProvider.js";
import { isSupportedFile, parseDocumentBuffer } from "./lib/documentParser.js";
import { loadEnvFile } from "./lib/env.js";
import {
  buildDocumentContext,
  buildSelectionContext
} from "./lib/selectionContext.js";
import { Storage } from "./lib/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_UPLOAD_LIMITS = Object.freeze({
  maxFilesPerBatch: 50,
  maxFileBytes: 25 * 1024 * 1024,
  maxBatchBytes: 60 * 1024 * 1024
});

const MAX_QUESTION_CHARS = 6000;
const MAX_SELECTION_CHARS = 50000;
const VALID_AI_MODES = new Set(["direct", "deep", "custom"]);

export function createApp(options = {}) {
  const dataDir = options.dataDir || path.join(projectRoot, "data");
  const uploadDir = options.uploadDir || path.join(projectRoot, "uploads");
  const storage = options.storage || new Storage({ dataDir });
  const aiProvider = options.aiProvider || createAiProvider(options.aiProviderConfig);
  const aiRequestTimeoutMs = options.aiRequestTimeoutMs || 120000;
  const uploadLimits = { ...DEFAULT_UPLOAD_LIMITS, ...options.uploadLimits };

  const app = express();
  app.locals.storage = storage;
  app.disable("x-powered-by");
  app.use(setSecurityHeaders);
  app.use(express.json({ limit: "82mb" }));
  app.use(express.static(path.join(projectRoot, "public")));
  app.get("/vendor/marked.min.js", (req, res) => {
    res.sendFile(path.join(projectRoot, "node_modules", "marked", "lib", "marked.umd.js"));
  });
  app.get("/vendor/purify.min.js", (req, res) => {
    res.sendFile(path.join(projectRoot, "node_modules", "dompurify", "dist", "purify.min.js"));
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
      if (document.formatVersion < 3) {
        document = await upgradeDocumentFormatting(document, storage);
      }
      return res.json(document);
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

  app.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Upload request exceeds the 60 MB batch limit" });
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

async function deleteUploadedFile(filePath, uploadDir) {
  const uploadRoot = path.resolve(uploadDir);
  const resolvedFile = path.resolve(filePath);
  const relativePath = path.relative(uploadRoot, resolvedFile);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Refusing to delete a file outside the upload directory");
  }

  try {
    await unlink(resolvedFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
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
    const { documentId, mode = defaultMode, selection = {}, question = "" } = req.body || {};
    const normalizedSelection = selection && typeof selection === "object"
      ? { ...selection, text: selection.text ?? "" }
      : { text: "", blockIds: [] };
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

    const selectedText = normalizedSelection.text;
    const hasSelection = selectedText.trim() || normalizedSelection.blockIds?.length;
    const context = mode === "custom" && !hasSelection
      ? buildDocumentContext({
          blocks: document.blocks,
          question,
          maxChars: 12000
        })
      : buildSelectionContext({
          blocks: document.blocks,
          selection: normalizedSelection,
          radius: mode === "deep" ? 2 : 1
        });
    const result = await aiProvider.explain({
      mode,
      selectedText,
      context,
      question,
      documentTitle: document.title,
      signal: controller.signal
    });

    storage.addAiRecord({
      documentId: document.id,
      mode,
      question,
      selectedText,
      context,
      answer: result.answer,
      provider: result.provider
    });

    return res.json(result);
  } catch (error) {
    if (timedOut && !res.destroyed) {
      return res.status(504).json({ error: "AI provider request timed out" });
    }
    if (controller.signal.aborted || res.destroyed) return;
    return res.status(500).json({ error: error.message });
  } finally {
    clearTimeout(timeoutId);
    res.off("close", abortProvider);
  }
}

function setSecurityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
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
  createApp().listen(port, host, () => {
    console.log(`${APP_INFO.name} V${APP_INFO.version} running at http://${host}:${port}`);
  });
}
