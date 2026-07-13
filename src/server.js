import express from "express";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

export function createApp(options = {}) {
  const dataDir = options.dataDir || path.join(projectRoot, "data");
  const uploadDir = options.uploadDir || path.join(projectRoot, "uploads");
  const storage = options.storage || new Storage({ dataDir });
  const aiProvider = options.aiProvider || createAiProvider(options.aiProviderConfig);

  const app = express();
  app.locals.storage = storage;
  app.use(express.json({ limit: "120mb" }));
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

      const created = [];
      const errors = [];
      for (const item of documents) {
        try {
          created.push(
            await saveUploadedDocument({ item, category, storage, uploadDir })
          );
        } catch (error) {
          errors.push({ name: item?.name || "unknown", error: error.message });
        }
      }

      return res.status(201).json({ documents: created, errors });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents", async (req, res) => {
    try {
      const document = await saveUploadedDocument({
        item: req.body,
        category: req.body?.category,
        storage,
        uploadDir
      });

      return res.status(201).json(document);
    } catch (error) {
      return res.status(500).json({ error: error.message });
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
    return handleAiRequest({ req, res, storage, aiProvider, defaultMode: "direct" });
  });

  app.get("/api/ai/status", (req, res) => {
    if (typeof aiProvider.getStatus === "function") {
      return res.json(aiProvider.getStatus());
    }
    return res.json({ provider: aiProvider.name || "unknown", configured: false });
  });

  app.post("/api/ai/ask", async (req, res) => {
    return handleAiRequest({ req, res, storage, aiProvider, defaultMode: "custom" });
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

async function saveUploadedDocument({ item, category, storage, uploadDir }) {
  const { name, mimeType, contentBase64 } = item || {};
  if (!name || !contentBase64) {
    throw new Error("name and contentBase64 are required");
  }
  if (!isSupportedFile(name)) {
    throw new Error("Unsupported file type");
  }

  const buffer = Buffer.from(contentBase64, "base64");
  const parsed = await parseDocumentBuffer({ originalName: name, buffer });
  const safeName = `${Date.now()}-${name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")}`;
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

async function handleAiRequest({ req, res, storage, aiProvider, defaultMode }) {
  const controller = new AbortController();
  const abortProvider = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", abortProvider);
  try {
    const { documentId, mode = defaultMode, selection = {}, question = "" } = req.body || {};
    const document = storage.getDocument(Number(documentId));
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    const selectedText = selection.text || "";
    const hasSelection = selectedText.trim() || selection.blockIds?.length;
    const context = mode === "custom" && !hasSelection
      ? buildDocumentContext({
          blocks: document.blocks,
          question,
          maxChars: 12000
        })
      : buildSelectionContext({
          blocks: document.blocks,
          selection,
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
    if (controller.signal.aborted || res.destroyed) return;
    return res.status(500).json({ error: error.message });
  } finally {
    res.off("close", abortProvider);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFile(path.join(projectRoot, ".env"));
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`AI deep reader running at http://localhost:${port}`);
  });
}
