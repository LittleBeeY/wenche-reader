import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArticleDocument, sanitizeArticleHtml } from "../documentParser.js";
import { analyzeEntry as analyzeEntryWithAi } from "./rssAnalysis.js";
import { fetchRemote, FETCH_LIMITS } from "./feedFetcher.js";
import {
  buildDedupeKey,
  FeedParseError,
  hashContent,
  parseFeed,
  stripHtml
} from "./feedParser.js";
import { buildOpml, classifyOpmlItems, normalizeFeedUrl, parseOpml } from "./opml.js";
import { buildBriefSelection, hasSubstantialContent, scoreEntry } from "./rssRanking.js";
import { extractFullText } from "./webExtractor.js";
import { hasBrokenArticleImages } from "./imageProxy.js";

export const MIN_FETCH_INTERVAL_MINUTES = 15;
const ANALYSIS_WINDOW_HOURS = 48;
const MAX_DISCOVER_CANDIDATES = 5;
const MAX_ENTRIES_PER_FETCH = 200;

export class RssService {
  constructor({
    storage,
    aiProvider = null,
    uploadDir,
    fetchImpl = fetchRemote,
    extractImpl = extractFullText,
    allowPrivateHosts = false,
    random = Math.random
  }) {
    this.storage = storage;
    this.aiProvider = aiProvider;
    this.uploadDir = uploadDir;
    this.fetchImpl = fetchImpl;
    this.extractImpl = extractImpl;
    this.allowPrivateHosts = allowPrivateHosts;
    this.random = random;
    this.refreshState = { running: false, lastRunAt: null, lastResult: null };
  }

  /** 应用内修改 AI 配置后，让本服务切换到新的 provider 实例。 */
  setAiProvider(aiProvider) {
    this.aiProvider = aiProvider;
  }

  // ---------- 发现与添加 ----------

  async discover(url) {
    const target = normalizeFeedUrl(url);
    const response = await this.fetchImpl({
      url: target,
      maxBytes: FETCH_LIMITS.maxPageBytes,
      allowPrivateHosts: this.allowPrivateHosts
    });
    if (response.status >= 400) {
      throw new RssError(`无法访问该地址（HTTP ${response.status}）`, 502);
    }
    const text = response.text();

    const directFeed = tryParseFeed(text, response.finalUrl);
    if (directFeed) {
      return {
        site: { title: directFeed.title, url: directFeed.siteUrl || response.finalUrl },
        candidates: [buildCandidate(directFeed, response.finalUrl)]
      };
    }

    const alternates = findAlternateFeeds(text, response.finalUrl).slice(0, MAX_DISCOVER_CANDIDATES);
    if (alternates.length === 0) {
      throw new RssError("未发现可订阅的 RSS 或 Atom 地址。", 404);
    }
    const siteTitle = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || response.finalUrl;
    const candidates = [];
    for (const alternate of alternates) {
      try {
        const feedResponse = await this.fetchImpl({
          url: alternate.href,
          maxBytes: FETCH_LIMITS.maxFeedBytes,
          allowPrivateHosts: this.allowPrivateHosts
        });
        if (feedResponse.status >= 400) continue;
        const parsed = tryParseFeed(feedResponse.text(), feedResponse.finalUrl);
        if (parsed) {
          candidates.push(buildCandidate(parsed, feedResponse.finalUrl, alternate.title));
        }
      } catch {
        // 单个候选失败不阻断其他候选
      }
    }
    if (candidates.length === 0) {
      throw new RssError("未发现可订阅的 RSS 或 Atom 地址。", 404);
    }
    return { site: { title: siteTitle, url: response.finalUrl }, candidates };
  }

  async addFeed({ feedUrl, title, folderId = null, fetchIntervalMinutes, priority = 0, fullTextMode = "feed" }) {
    const normalizedUrl = normalizeFeedUrl(feedUrl);
    const existing = this.storage.getRssFeedByUrl(normalizedUrl);
    if (existing && !existing.deletedAt) {
      throw new RssError("该订阅已存在", 409);
    }

    const defaultInterval = this.storage.getRssPreferences().fetchIntervalMinutes || 60;
    const interval = Math.max(MIN_FETCH_INTERVAL_MINUTES, Number(fetchIntervalMinutes) || defaultInterval);
    const response = await this.fetchImpl({
      url: normalizedUrl,
      maxBytes: FETCH_LIMITS.maxFeedBytes,
      allowPrivateHosts: this.allowPrivateHosts
    });
    if (response.status >= 400) {
      throw new RssError(`订阅源暂时无法访问（HTTP ${response.status}）`, 502);
    }
    const parsed = parseFeed(response.text(), { feedUrl: response.finalUrl });

    let feed;
    if (existing?.deletedAt) {
      feed = this.storage.updateRssFeed(existing.id, {
        title: title || parsed.title,
        folderId,
        siteUrl: parsed.siteUrl,
        description: parsed.description,
        iconUrl: parsed.iconUrl,
        language: parsed.language,
        priority,
        fetchIntervalMinutes: interval,
        fullTextMode,
        disabled: false,
        deletedAt: null
      });
    } else {
      feed = this.storage.createRssFeed({
        folderId,
        title: title || parsed.title,
        feedUrl: normalizedUrl,
        siteUrl: parsed.siteUrl,
        description: parsed.description,
        iconUrl: parsed.iconUrl,
        language: parsed.language,
        priority,
        fetchIntervalMinutes: interval,
        fullTextMode
      });
    }

    const changes = this.insertEntries(feed.id, parsed.entries);
    this.storage.updateRssFeedFetch(feed.id, {
      etag: response.headers.etag || "",
      lastModified: response.headers["last-modified"] || "",
      lastFetchedAt: new Date().toISOString(),
      nextFetchAt: this.nextFetchTime(interval, 0),
      consecutiveFailures: 0,
      lastError: ""
    });
    return { feed: this.storage.getRssFeed(feed.id), ...changes };
  }

  // ---------- 刷新 ----------

  async refreshFeed(id, { trigger = "manual" } = {}) {
    const feed = this.storage.getRssFeed(id);
    if (!feed || feed.deletedAt) {
      throw new RssError("订阅不存在", 404);
    }
    const attemptedAt = new Date().toISOString();
    try {
      const response = await this.fetchImpl({
        url: feed.feedUrl,
        etag: feed.etag,
        lastModified: feed.lastModified,
        maxBytes: FETCH_LIMITS.maxFeedBytes,
        allowPrivateHosts: this.allowPrivateHosts
      });

      if (response.status === 304) {
        this.storage.updateRssFeedFetch(feed.id, {
          lastFetchedAt: attemptedAt,
          nextFetchAt: this.nextFetchTime(feed.fetchIntervalMinutes, 0),
          consecutiveFailures: 0,
          lastError: ""
        });
        return { feedId: feed.id, status: "not_modified", inserted: 0 };
      }
      if (response.status >= 400) {
        throw new RssError(`订阅源返回错误（HTTP ${response.status}）`, 502);
      }

      const parsed = parseFeed(response.text(), { feedUrl: response.finalUrl });
      const changes = this.insertEntries(feed.id, parsed.entries);
      this.storage.updateRssFeedFetch(feed.id, {
        etag: response.headers.etag || feed.etag,
        lastModified: response.headers["last-modified"] || feed.lastModified,
        lastFetchedAt: attemptedAt,
        nextFetchAt: this.nextFetchTime(feed.fetchIntervalMinutes, 0),
        consecutiveFailures: 0,
        lastError: ""
      });
      return { feedId: feed.id, status: "success", ...changes, trigger };
    } catch (error) {
      const failures = feed.consecutiveFailures + 1;
      this.storage.updateRssFeedFetch(feed.id, {
        lastFetchedAt: feed.lastFetchedAt,
        nextFetchAt: this.nextFetchTime(feed.fetchIntervalMinutes, failures),
        consecutiveFailures: failures,
        lastError: userReadableFetchError(error)
      });
      if (error instanceof RssError) throw error;
      throw new RssError(userReadableFetchError(error), 502);
    }
  }

  async refreshDueFeeds({ concurrency = 4, onlyFeedIds = null, force = false } = {}) {
    const due = (force
      ? this.storage.listRssFeeds().filter((feed) => !feed.disabled)
      : this.storage.listDueRssFeeds(new Date().toISOString(), 100))
      .filter((feed) => !onlyFeedIds || onlyFeedIds.includes(feed.id));
    this.refreshState = { running: true, lastRunAt: new Date().toISOString(), lastResult: null };
    const results = [];
    let index = 0;
    const worker = async () => {
      while (index < due.length) {
        const feed = due[index];
        index += 1;
        try {
          results.push(await this.refreshFeed(feed.id, { trigger: "auto" }));
        } catch (error) {
          results.push({ feedId: feed.id, status: "failed", error: error.message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, due.length || 1) }, worker));
    const summary = {
      total: due.length,
      success: results.filter((result) => result.status === "success").length,
      notModified: results.filter((result) => result.status === "not_modified").length,
      failed: results.filter((result) => result.status === "failed").length,
      inserted: results.reduce((sum, result) => sum + (result.inserted || 0), 0),
      updated: results.reduce((sum, result) => sum + (result.updated || 0), 0)
    };
    this.refreshState = { running: false, lastRunAt: new Date().toISOString(), lastResult: summary };
    return { ...summary, results };
  }

  getRefreshStatus() {
    const feeds = this.storage.listRssFeeds();
    const lastFetched = feeds
      .map((feed) => feed.lastFetchedAt)
      .filter(Boolean)
      .sort()
      .pop() || null;
    return {
      ...this.refreshState,
      lastFetchedAt: lastFetched,
      failedFeeds: feeds
        .filter((feed) => feed.consecutiveFailures > 0)
        .map((feed) => ({ id: feed.id, title: feed.title, error: feed.lastError })),
      unreadCount: this.storage.countRssEntries({ unreadOnly: true })
    };
  }

  insertEntries(feedId, parsedEntries) {
    let inserted = 0;
    let updated = 0;
    const feed = this.storage.getRssFeed(feedId);
    for (const entry of parsedEntries.slice(0, MAX_ENTRIES_PER_FETCH)) {
      const baseUrl = entry.canonicalUrl || feed?.siteUrl || feed?.feedUrl || "";
      const contentHtml = sanitizeArticleHtml(entry.contentHtml || entry.summaryHtml || "", { baseUrl });
      const summaryHtml = sanitizeArticleHtml(entry.summaryHtml || "", { baseUrl });
      const contentText = stripHtml(contentHtml || summaryHtml);
      const dedupeKey = buildDedupeKey({
        guid: entry.guid,
        canonicalUrl: entry.canonicalUrl,
        title: entry.title,
        publishedAt: entry.publishedAt,
        contentText
      });
      const result = this.storage.insertRssEntry({
        feedId,
        guid: entry.guid,
        dedupeKey,
        canonicalUrl: entry.canonicalUrl,
        title: entry.title,
        author: entry.author,
        publishedAt: entry.publishedAt,
        summaryHtml,
        contentHtml,
        contentText,
        contentHash: hashContent(`${contentText}\n${contentHtml}`),
        thumbnailUrl: entry.thumbnailUrl,
        language: entry.language,
        estimatedReadMinutes: entry.estimatedReadMinutes
      });
      if (result.created) inserted += 1;
      else if (result.updated) updated += 1;
    }
    return { inserted, updated };
  }

  nextFetchTime(intervalMinutes, consecutiveFailures) {
    const jitter = Math.floor(this.random() * intervalMinutes * 0.2 * 60000);
    const base = Number(intervalMinutes) || 60;
    const backoff = consecutiveFailures > 0
      ? Math.min(base * 2 ** consecutiveFailures, 24 * 60)
      : base;
    return new Date(Date.now() + backoff * 60000 + jitter).toISOString();
  }

  // ---------- 条目与状态 ----------

  listEntries(params) {
    return this.storage.listRssEntries(params);
  }

  getEntry(id) {
    const entry = this.storage.getRssEntry(id);
    if (!entry) throw new RssError("资讯不存在", 404);
    return entry;
  }

  updateEntryState(id, patch) {
    const entry = this.storage.updateRssEntryState(id, patch);
    if (!entry) throw new RssError("资讯不存在", 404);
    return entry;
  }

  async extractEntry(id) {
    const entry = this.getEntry(id);
    if (!entry.canonicalUrl) {
      throw new RssError("该资讯没有原文链接，无法提取全文", 400);
    }
    const extracted = await this.extractImpl(entry.canonicalUrl, {
      allowPrivateHosts: this.allowPrivateHosts
    });
    const contentText = stripHtml(extracted.contentHtml);
    const updated = this.storage.setRssEntryContent(entry.id, {
      contentHtml: extracted.contentHtml,
      contentText,
      contentHash: hashContent(`${contentText}\n${extracted.contentHtml}`),
      estimatedReadMinutes: Math.max(1, Math.round(contentText.length / 400)),
      contentSource: "extracted"
    });
    const snapshot = await this.syncSnapshotIfSafe(updated);
    return { entry: this.getEntry(id), snapshot };
  }

  // ---------- 阅读快照 ----------

  async openEntry(id) {
    let entry = this.getEntry(id);
    if (
      entry.canonicalUrl &&
      (
        (
          entry.feedFullTextMode === "extract_on_open" &&
          entry.contentSource !== "extracted"
        ) ||
        hasBrokenArticleImages(entry.contentHtml || entry.summaryHtml)
      )
    ) {
      try {
        const extracted = await this.extractEntry(id);
        entry = extracted.entry;
      } catch {
        // 默认提取失败时保留 Feed 已有内容，阅读流程不能被阻断
      }
    }
    let documentId = entry.documentId;
    let sourceUpdated = false;

    if (documentId) {
      const document = this.storage.getDocument(documentId);
      if (document) {
        if (!hasReadableSnapshotBody(document)) {
          const repaired = await this.syncSnapshotIfSafe(entry, { force: true });
          sourceUpdated = repaired.updated;
        } else {
          sourceUpdated = Boolean(document.contentHash) && document.contentHash !== entry.contentHash;
        }
      } else {
        documentId = null;
      }
    }

    if (!documentId) {
      const document = await this.createSnapshot(entry);
      documentId = document.id;
      this.storage.setRssEntryDocument(entry.id, documentId);
    }

    if (entry.readState !== "read") {
      this.storage.updateRssEntryState(entry.id, { readState: "read" });
    }
    return { documentId, entry: this.getEntry(id), sourceUpdated };
  }

  async createSnapshot(entry) {
    const { parsed, fileHtml } = buildSnapshot(entry);
    const snapshotName = `rss-entry-${entry.id}-${randomUUID()}.html`;
    const snapshotDir = path.join(this.uploadDir, "rss");
    await mkdir(snapshotDir, { recursive: true });
    const filePath = path.join(snapshotDir, snapshotName);
    await writeFile(filePath, fileHtml, "utf8");

    return this.storage.createDocument({
      title: entry.title,
      originalName: snapshotName,
      mimeType: "text/html",
      filePath,
      category: "未分类",
      renderHtml: "",
      sourceType: "rss",
      sourceUrl: entry.canonicalUrl || "",
      isLibraryVisible: false,
      contentHash: entry.contentHash || hashContent(parsed.sanitizedHtml),
      blocks: parsed.blocks
    });
  }

  async syncSnapshotIfSafe(entry, { force = false } = {}) {
    if (!entry.documentId) return { updated: false, reason: "not_created" };
    const document = this.storage.getDocument(entry.documentId);
    if (!document) return { updated: false, reason: "missing" };
    if (!force && document.contentHash === entry.contentHash) {
      return { updated: false, reason: "current" };
    }

    const relativePath = path.relative(path.resolve(this.uploadDir), path.resolve(document.filePath));
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new RssError("阅读快照路径不在 uploads 目录内", 400);
    }

    const { parsed, fileHtml } = buildSnapshot(entry);
    const result = this.storage.replaceRssDocumentSnapshot(document.id, {
      title: entry.title,
      contentHash: entry.contentHash,
      blocks: parsed.blocks
    });
    if (!result?.updated) {
      const imageRepair = result?.protected
        ? this.storage.repairRssDocumentImages(document.id, parsed.blocks)
        : null;
      if (imageRepair?.updated) {
        await repairSnapshotFileImages(document.filePath, parsed.blocks);
      }
      return {
        updated: false,
        reason: result?.protected ? "protected" : "missing",
        assets: result?.assets || null,
        imagesRepaired: imageRepair?.updated ? imageRepair.count : 0
      };
    }
    await writeFile(document.filePath, fileHtml, "utf8");
    return { updated: true, reason: "replaced" };
  }

  async saveEntryToLibrary(id, { category = "未分类" } = {}) {
    const entry = this.getEntry(id);
    let documentId = entry.documentId;
    if (!documentId) {
      const document = await this.createSnapshot(entry);
      documentId = document.id;
      this.storage.setRssEntryDocument(entry.id, documentId);
    }
    const document = this.storage.getDocument(documentId);
    if (!document) throw new RssError("阅读快照不存在", 404);
    return { documentId, document: this.storage.markDocumentLibraryVisible(documentId, category) };
  }

  // ---------- AI 分诊与今日精选 ----------

  async analyzeEntry(id, { force = false } = {}) {
    const entry = this.getEntry(id);
    const feed = this.storage.getRssFeed(entry.feedId);
    const existing = this.storage.getRssEntryAnalysis(id);
    if (!force && existing && existing.contentHash === entry.contentHash && !existing.lastError) {
      return existing;
    }
    const preferences = this.storage.getRssPreferences();
    const analysis = await analyzeEntryWithAi({
      entry,
      feed,
      preferences,
      aiProvider: this.aiProvider
    });
    return this.storage.saveRssEntryAnalysis(id, analysis);
  }

  async runAutoAnalysis({ limit = 10 } = {}) {
    const preferences = this.storage.getRssPreferences();
    if (!preferences.autoAiAnalysis) return { analyzed: 0, reason: "disabled" };
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const usedToday = this.storage.countRssAnalysesSince(dayStart.toISOString());
    const remaining = Math.max(0, (preferences.aiDailyBudget || 60) - usedToday);
    if (remaining === 0) return { analyzed: 0, reason: "budget" };

    const since = new Date(Date.now() - ANALYSIS_WINDOW_HOURS * 3600000).toISOString();
    const candidates = this.storage
      .listRssAnalysisCandidates({ sinceIso: since, limit: Math.min(limit, remaining) });
    let analyzed = 0;
    for (const candidate of candidates) {
      try {
        await this.analyzeEntry(candidate.id);
        analyzed += 1;
      } catch {
        // 单条失败不阻断队列
      }
    }
    return { analyzed, budgetRemaining: remaining - analyzed };
  }

  async generateTodayBrief({ force = false } = {}) {
    const briefDate = new Date().toISOString().slice(0, 10);
    const existing = this.getTodayBrief();
    if (existing && !force) return existing;

    const preferences = this.storage.getRssPreferences();
    await this.runAutoAnalysis({ limit: 20 });

    const since = new Date(Date.now() - ANALYSIS_WINDOW_HOURS * 3600000).toISOString();
    const { entries } = this.storage.listRssEntries({
      scope: "inbox",
      read: "all",
      sort: "newest",
      limit: 120
    });
    const candidates = entries.filter(
      (entry) =>
        entry.readState !== "read" &&
        Date.parse(entry.publishedAt || entry.receivedAt || 0) >= Date.parse(since)
    );
    const scored = candidates.map((entry) => {
      const analysis = this.storage.getRssEntryAnalysis(entry.id);
      const result = scoreEntry({ entry, analysis, preferences });
      return { entry, analysis, ...result };
    });

    const selection = buildBriefSelection(scored, {
      total: preferences.dailyBriefCount || 10,
      exploreItem: preferences.exploreItem !== false
    });
    return this.storage.saveRssBrief({
      briefDate,
      generatedAt: new Date().toISOString(),
      scope: force ? "manual" : "auto",
      model: this.aiProvider?.name || "",
      status: "ready",
      entries: selection
    });
  }

  getTodayBrief() {
    const brief = this.storage.getRssBrief(new Date().toISOString().slice(0, 10));
    if (!brief) return null;
    return {
      ...brief,
      entries: brief.entries.filter((item) => hasSubstantialContent(item.entry))
    };
  }

  // ---------- OPML ----------

  previewOpml(xml) {
    const { title, items } = parseOpml(xml);
    if (items.length === 0) throw new RssError("OPML 中没有可导入的订阅条目", 400);
    const existingByUrl = new Map(
      this.storage.listRssFeeds({ includeDeleted: true }).map((feed) => [feed.feedUrl, feed])
    );
    const classified = classifyOpmlItems(items, existingByUrl);
    const summary = classified.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    return { title, items: classified, summary };
  }

  async importOpml(xml) {
    const { items } = this.previewOpml(xml);
    const results = { imported: 0, reenabled: 0, failed: [], skipped: 0 };
    const folderIds = new Map();
    for (const item of items) {
      if (item.status === "duplicate" || item.status === "invalid" || item.status === "unsupported") {
        results.skipped += 1;
        continue;
      }
      try {
        let folderId = null;
        if (item.folderName) {
          if (!folderIds.has(item.folderName)) {
            const folder = this.storage.listRssFolders().find((f) => f.name === item.folderName)
              || this.storage.createRssFolder(item.folderName);
            folderIds.set(item.folderName, folder.id);
          }
          folderId = folderIds.get(item.folderName);
        }
        await this.addFeed({ feedUrl: item.feedUrl, title: item.title, folderId });
        if (item.status === "reenable") results.reenabled += 1;
        else results.imported += 1;
      } catch (error) {
        if (String(error.message).includes("已存在")) results.skipped += 1;
        else results.failed.push({ title: item.title, feedUrl: item.feedUrl, error: error.message });
      }
    }
    return results;
  }

  exportOpml() {
    return buildOpml({
      folders: this.storage.listRssFolders(),
      feeds: this.storage.listRssFeeds()
    });
  }

  // ---------- 导航与偏好 ----------

  getNav() {
    const preferences = this.storage.getRssPreferences();
    return {
      folders: this.storage.listRssFolders(),
      feeds: this.storage.listRssFeeds(),
      unreadCount: this.storage.countRssEntries({ unreadOnly: true }),
      showUnreadCounts: preferences.showUnreadCounts
    };
  }

  getPreferences() {
    return this.storage.getRssPreferences();
  }

  updatePreferences(patch) {
    return this.storage.setRssPreferences(patch);
  }
}

function tryParseFeed(text, feedUrl) {
  try {
    return parseFeed(text, { feedUrl });
  } catch {
    return null;
  }
}

function buildCandidate(parsed, feedUrl, fallbackTitle = "") {
  return {
    feedUrl,
    title: parsed.title || fallbackTitle || feedUrl,
    siteUrl: parsed.siteUrl,
    description: parsed.description,
    format: parsed.format,
    recentEntries: parsed.entries.slice(0, 3).map((entry) => ({
      title: entry.title,
      publishedAt: entry.publishedAt
    }))
  };
}

function findAlternateFeeds(html, pageUrl) {
  const results = [];
  const linkPattern = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkPattern.exec(html))) {
    const tag = match[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      results.push({
        href: new URL(href, pageUrl).toString(),
        title: tag.match(/title=["']([^"']*)["']/i)?.[1] || ""
      });
    } catch {
      // 忽略无法解析的候选地址
    }
  }
  return results;
}

function userReadableFetchError(error) {
  if (error instanceof FeedParseError) return "来源返回的内容格式无法解析。";
  if (error?.name === "SsrfError") return error.message;
  if (error?.statusCode === 413) return "订阅源内容超过大小限制。";
  if (error?.statusCode === 504) return "订阅源响应超时，已安排稍后重试。";
  return `该订阅暂时无法访问，已安排稍后重试。（${error?.message || "网络错误"}）`;
}

function buildSnapshot(entry) {
  const html = normalizeSnapshotHtml(
    entry.contentHtml || entry.summaryHtml || "(该资讯只有标题，可打开原网页阅读)"
  );
  const parsed = parseArticleDocument({ title: entry.title, html });
  const fileHtml = [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<title>${escapeHtml(entry.title)}</title></head><body>`,
    parsed.sanitizedHtml,
    "</body></html>"
  ].join("");
  return { parsed, fileHtml };
}

function hasReadableSnapshotBody(document) {
  return (document?.blocks || []).some(
    (block) => block.type !== "heading" && String(block.text || "").trim().length > 0
  );
}

function normalizeSnapshotHtml(value) {
  const content = String(value || "").trim();
  if (/<\/?[a-z][^>]*>/i.test(content)) return content;
  return content
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function repairSnapshotFileImages(filePath, blocks) {
  const replacementTags = (blocks || [])
    .flatMap((block) => [...String(block.html || "").matchAll(/<img\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)])
    .map((match) => match[0]);
  if (replacementTags.length === 0) return false;

  const html = await readFile(filePath, "utf8");
  const missingTags = [...html.matchAll(/<img\b(?![^>]*\bsrc=)[^>]*>/gi)];
  if (missingTags.length !== replacementTags.length) return false;
  let index = 0;
  const repaired = html.replace(/<img\b(?![^>]*\bsrc=)[^>]*>/gi, () => replacementTags[index++]);
  await writeFile(filePath, repaired, "utf8");
  return true;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class RssError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "RssError";
    this.statusCode = statusCode;
  }
}
