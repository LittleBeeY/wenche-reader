import { MIN_FETCH_INTERVAL_MINUTES, RssError } from "./rssService.js";

const VALID_READ_STATES = new Set(["unread", "read"]);
const VALID_FULL_TEXT_MODES = new Set(["feed", "extract_on_open"]);
const VALID_REMOTE_IMAGE_MODES = new Set(["always", "lazy", "never"]);

export function registerRssRoutes(app, { rssService, storage }) {
  const sendError = (res, error) => {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({ error: error.message });
  };

  // ---------- 订阅与分组 ----------

  app.get("/api/rss/feeds", (req, res) => {
    return res.json(rssService.getNav());
  });

  app.post("/api/rss/discover", async (req, res) => {
    try {
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      if (!url) return res.status(400).json({ error: "请输入 Feed 或网站地址" });
      return res.json(await rssService.discover(url));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/feeds", async (req, res) => {
    try {
      const feedUrl = typeof req.body?.feedUrl === "string" ? req.body.feedUrl.trim() : "";
      if (!feedUrl) return res.status(400).json({ error: "feedUrl is required" });
      const result = await rssService.addFeed({
        feedUrl,
        title: normalizeShortText(req.body?.title, 160),
        folderId: normalizeNullableId(req.body?.folderId),
        fetchIntervalMinutes: req.body?.fetchIntervalMinutes,
        priority: normalizePriority(req.body?.priority),
        fullTextMode: VALID_FULL_TEXT_MODES.has(req.body?.fullTextMode) ? req.body.fullTextMode : "feed"
      });
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.patch("/api/rss/feeds/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!storage.getRssFeed(id)) return res.status(404).json({ error: "订阅不存在" });
      const patch = {};
      if (req.body?.title !== undefined) patch.title = normalizeShortText(req.body.title, 160);
      if (req.body?.folderId !== undefined) patch.folderId = normalizeNullableId(req.body.folderId);
      if (req.body?.priority !== undefined) patch.priority = normalizePriority(req.body.priority);
      if (req.body?.fetchIntervalMinutes !== undefined) {
        patch.fetchIntervalMinutes = Math.max(MIN_FETCH_INTERVAL_MINUTES, Number(req.body.fetchIntervalMinutes) || 60);
      }
      if (req.body?.disabled !== undefined) patch.disabled = Boolean(req.body.disabled);
      if (req.body?.aiExcluded !== undefined) patch.aiExcluded = Boolean(req.body.aiExcluded);
      if (req.body?.fullTextMode !== undefined) {
        if (!VALID_FULL_TEXT_MODES.has(req.body.fullTextMode)) {
          return res.status(400).json({ error: "fullTextMode 无效" });
        }
        patch.fullTextMode = req.body.fullTextMode;
      }
      return res.json(rssService.storage.updateRssFeed(id, patch));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete("/api/rss/feeds/:id", (req, res) => {
    const id = Number(req.params.id);
    const feed = storage.getRssFeed(id);
    if (!feed) return res.status(404).json({ error: "订阅不存在" });
    const updated = storage.updateRssFeed(id, { deletedAt: new Date().toISOString() });
    return res.json({ deleted: true, feed: updated });
  });

  app.post("/api/rss/feeds/:id/refresh", async (req, res) => {
    try {
      return res.json(await rssService.refreshFeed(Number(req.params.id)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/refresh", async (req, res) => {
    try {
      return res.json(await rssService.refreshDueFeeds());
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/rss/status", (req, res) => {
    return res.json(rssService.getRefreshStatus());
  });

  app.get("/api/rss/folders", (req, res) => {
    return res.json({ folders: storage.listRssFolders() });
  });

  app.post("/api/rss/folders", (req, res) => {
    try {
      const name = normalizeShortText(req.body?.name, 80);
      if (!name) return res.status(400).json({ error: "分组名称不能为空" });
      return res.status(201).json(storage.createRssFolder(name));
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint")) {
        return res.status(409).json({ error: "分组名称已存在" });
      }
      return sendError(res, error);
    }
  });

  app.patch("/api/rss/folders/:id", (req, res) => {
    try {
      const name = normalizeShortText(req.body?.name, 80);
      if (!name) return res.status(400).json({ error: "分组名称不能为空" });
      const folder = storage.renameRssFolder(Number(req.params.id), name);
      if (!folder) return res.status(404).json({ error: "分组不存在" });
      return res.json(folder);
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint")) {
        return res.status(409).json({ error: "分组名称已存在" });
      }
      return sendError(res, error);
    }
  });

  app.delete("/api/rss/folders/:id", (req, res) => {
    const result = storage.deleteRssFolder(Number(req.params.id));
    if (!result) return res.status(404).json({ error: "分组不存在" });
    if (!result.deleted) return res.status(409).json({ error: "分组内仍有订阅，无法删除" });
    return res.json(result);
  });

  // ---------- OPML ----------

  app.post("/api/rss/opml/preview", (req, res) => {
    try {
      const content = normalizeOpmlPayload(req.body);
      return res.json(rssService.previewOpml(content));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/opml/import", async (req, res) => {
    try {
      const content = normalizeOpmlPayload(req.body);
      return res.json(await rssService.importOpml(content));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/rss/opml/export", (req, res) => {
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/x-opml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="wenche-subscriptions-${date}.opml"`);
    return res.send(rssService.exportOpml());
  });

  // ---------- 资讯列表与状态 ----------

  app.get("/api/rss/entries", (req, res) => {
    try {
      const scope = String(req.query.scope || "inbox");
      if (scope === "today") {
        const brief = rssService.getTodayBrief();
        if (!brief) return res.json({ entries: [], nextCursor: null, brief: null });
        return res.json({ entries: brief.entries.map((item) => item.entry), nextCursor: null, brief });
      }
      const cursor = decodeCursor(req.query.cursor);
      const result = rssService.listEntries({
        scope: ["inbox", "later", "starred", "feed", "folder"].includes(scope) ? scope : "inbox",
        scopeId: req.query.scopeId ? Number(req.query.scopeId) : null,
        read: ["unread", "all", "read"].includes(req.query.read) ? req.query.read : "unread",
        sort: ["smart", "newest", "oldest"].includes(req.query.sort) ? req.query.sort : "newest",
        query: String(req.query.query || "").slice(0, 200),
        cursor,
        limit: Math.min(100, Math.max(1, Number(req.query.limit) || 40)),
        includeHidden: req.query.includeHidden === "1"
      });
      return res.json({
        entries: result.entries,
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/rss/entries/:id", (req, res) => {
    try {
      return res.json(rssService.getEntry(Number(req.params.id)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.patch("/api/rss/entries/:id/state", (req, res) => {
    try {
      const patch = normalizeEntryStatePatch(req.body);
      return res.json(rssService.updateEntryState(Number(req.params.id), patch));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/entries/batch-state", (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length === 0 || ids.length > 500) {
        return res.status(400).json({ error: "ids 必须为 1-500 个条目" });
      }
      const patch = normalizeEntryStatePatch(req.body?.state || {});
      const updated = storage.batchUpdateRssEntryState(ids, patch);
      return res.json({ updated });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/entries/:id/extract", async (req, res) => {
    try {
      return res.json(await rssService.extractEntry(Number(req.params.id)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/entries/:id/open", async (req, res) => {
    try {
      return res.json(await rssService.openEntry(Number(req.params.id)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/rss/entries/:id/save-to-library", async (req, res) => {
    try {
      const category = normalizeShortText(req.body?.category, 80) || "未分类";
      return res.json(await rssService.saveEntryToLibrary(Number(req.params.id), { category }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  // ---------- AI 与简报 ----------

  app.post("/api/rss/entries/:id/analyze", async (req, res) => {
    try {
      return res.json(await rssService.analyzeEntry(Number(req.params.id), { force: true }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/rss/briefs/today", (req, res) => {
    const brief = rssService.getTodayBrief();
    if (!brief) return res.status(404).json({ error: "今天还没有生成精选" });
    return res.json(brief);
  });

  app.post("/api/rss/briefs/today", async (req, res) => {
    try {
      return res.json(await rssService.generateTodayBrief({ force: Boolean(req.body?.force) }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/rss/preferences", (req, res) => {
    return res.json(rssService.getPreferences());
  });

  app.patch("/api/rss/preferences", (req, res) => {
    try {
      return res.json(rssService.updatePreferences(normalizePreferencesPatch(req.body)));
    } catch (error) {
      return sendError(res, error);
    }
  });
}

function normalizeEntryStatePatch(body) {
  const patch = {};
  if (body?.readState !== undefined) {
    if (!VALID_READ_STATES.has(body.readState)) throw new RssError("readState 无效", 400);
    patch.readState = body.readState;
  }
  if (body?.starred !== undefined) patch.starred = Boolean(body.starred);
  if (body?.readLater !== undefined) patch.readLater = Boolean(body.readLater);
  if (body?.hidden !== undefined) patch.hidden = Boolean(body.hidden);
  if (body?.readProgress !== undefined) {
    const progress = Number(body.readProgress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new RssError("readProgress 必须在 0 到 1 之间", 400);
    }
    patch.readProgress = progress;
  }
  return patch;
}

function normalizePreferencesPatch(body) {
  const patch = {};
  if (Array.isArray(body?.topics)) {
    patch.topics = body.topics
      .map((topic) => {
        if (typeof topic === "string") return { name: topic.trim().slice(0, 40), weight: 0.8 };
        return {
          name: String(topic?.name || "").trim().slice(0, 40),
          weight: Math.max(0.1, Math.min(1, Number(topic?.weight) || 0.8))
        };
      })
      .filter((topic) => topic.name)
      .slice(0, 50);
  }
  if (Array.isArray(body?.blockedTopics)) {
    patch.blockedTopics = body.blockedTopics.map((topic) => String(topic).trim().slice(0, 40)).filter(Boolean).slice(0, 100);
  }
  if (Array.isArray(body?.blockedFeedIds)) {
    patch.blockedFeedIds = body.blockedFeedIds.map(Number).filter(Number.isInteger).slice(0, 500);
  }
  if (Array.isArray(body?.preferredLanguages)) {
    patch.preferredLanguages = body.preferredLanguages.map((lang) => String(lang).slice(0, 12)).slice(0, 10);
  }
  for (const key of ["prefersLongForm", "showUnreadCounts", "autoAiAnalysis", "exploreItem"]) {
    if (body?.[key] !== undefined) patch[key] = Boolean(body[key]);
  }
  if (body?.dailyBriefCount !== undefined) {
    patch.dailyBriefCount = Math.max(3, Math.min(30, Number(body.dailyBriefCount) || 10));
  }
  if (body?.fetchIntervalMinutes !== undefined) {
    patch.fetchIntervalMinutes = Math.max(MIN_FETCH_INTERVAL_MINUTES, Number(body.fetchIntervalMinutes) || 60);
  }
  if (body?.remoteImages !== undefined) {
    if (!VALID_REMOTE_IMAGE_MODES.has(body.remoteImages)) throw new RssError("remoteImages 无效", 400);
    patch.remoteImages = body.remoteImages;
  }
  if (body?.aiDailyBudget !== undefined) {
    patch.aiDailyBudget = Math.max(0, Math.min(1000, Number(body.aiDailyBudget) || 60));
  }
  if (body?.retentionDaysRead !== undefined) {
    patch.retentionDaysRead = Math.max(1, Math.min(365, Number(body.retentionDaysRead) || 30));
  }
  if (body?.retentionDaysMetadata !== undefined) {
    patch.retentionDaysMetadata = Math.max(7, Math.min(3650, Number(body.retentionDaysMetadata) || 180));
  }
  return patch;
}

function normalizeOpmlPayload(body) {
  const content = typeof body?.opml === "string" ? body.opml : "";
  if (!content.trim()) throw new RssError("请提供 OPML 内容", 400);
  if (content.length > 2 * 1024 * 1024) throw new RssError("OPML 文件超过大小限制", 413);
  return content;
}

function normalizeShortText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeNullableId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizePriority(value) {
  const priority = Number(value);
  if (priority >= 1) return 1;
  if (priority <= -1) return -1;
  return 0;
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return Array.isArray(parsed) && parsed.length === 2 ? parsed : null;
  } catch {
    return null;
  }
}
