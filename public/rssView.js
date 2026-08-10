import { loadRssViewState, saveRssViewState } from "./rssState.js";
import { bindDisclosureState } from "./disclosureState.js";
import { closeSettings, openSettings } from "./settingsHub.js";

const SCOPE_TITLES = {
  today: "今日精选",
  inbox: "收件箱",
  later: "稍后读",
  starred: "收藏"
};

const RSS_AI_QUESTIONS = {
  judge: "请基于全文判断：这篇文章值得花时间深读吗？先给结论（值得/可略读/不值得），再列出 2-3 条依据。",
  summary: "请生成结构化摘要：一句话总结、3-5 个要点、涉及的主题与实体。",
  points: "请提取这篇文章的核心观点，并为每个观点列出对应的原文证据。"
};

export function initRssMode(host) {
  const els = {
    appShell: document.querySelector("#app-shell"),
    nav: document.querySelector("#rss-nav"),
    subscriptionsDisclosure: document.querySelector("#rss-subscriptions-disclosure"),
    subscriptionsCount: document.querySelector("#rss-subscriptions-count"),
    managementDisclosure: document.querySelector("#rss-management-disclosure"),
    feedTree: document.querySelector("#rss-feed-tree"),
    listPanel: document.querySelector("#rss-list-panel"),
    scopeTitle: document.querySelector("#rss-scope-title"),
    entryList: document.querySelector("#rss-entry-list"),
    listSearch: document.querySelector("#rss-list-search"),
    listRefresh: document.querySelector("#rss-list-refresh"),
    listBack: document.querySelector("#rss-list-back"),
    readFilter: document.querySelector("#rss-read-filter"),
    sortControl: document.querySelector("#rss-sort-control"),
    viewControl: document.querySelector("#rss-view-control"),
    loadMore: document.querySelector("#rss-load-more"),
    briefBanner: document.querySelector("#rss-brief-banner"),
    lastUpdated: document.querySelector("#rss-last-updated"),
    refreshAll: document.querySelector("#rss-refresh-all"),
    addDialog: document.querySelector("#rss-add-dialog"),
    addUrl: document.querySelector("#rss-add-url"),
    addStatus: document.querySelector("#rss-add-status"),
    addCandidates: document.querySelector("#rss-add-candidates"),
    opmlDialog: document.querySelector("#rss-opml-dialog"),
    opmlFile: document.querySelector("#rss-opml-file"),
    opmlStatus: document.querySelector("#rss-opml-status"),
    opmlPreview: document.querySelector("#rss-opml-preview"),
    opmlImport: document.querySelector("#rss-opml-import"),
    feedsDialog: document.querySelector("#rss-feeds-dialog"),
    feedsList: document.querySelector("#rss-feeds-manage-list"),
    folderDialog: document.querySelector("#rss-folder-dialog"),
    folderDialogStatus: document.querySelector("#rss-folder-dialog-status"),
    newFolderName: document.querySelector("#rss-new-folder-name"),
    articleBar: document.querySelector("#rss-article-bar"),
    articleBack: document.querySelector("#rss-article-back"),
    articleMeta: document.querySelector("#rss-article-meta"),
    articleOrigin: document.querySelector("#rss-article-origin"),
    quickActions: document.querySelector("#rss-quick-actions")
  };

  const state = {
    active: false,
    view: loadRssViewState(),
    entries: [],
    brief: null,
    nextCursor: null,
    loading: false,
    reloadAfterLoad: false,
    nav: { folders: [], feeds: [], unreadCount: 0, showUnreadCounts: true },
    selectedEntryIds: new Set(),
    focusIndex: -1,
    activeEntry: null,
    opmlContent: "",
    searchTimer: null,
    progressTimer: null
  };

  bindDisclosureState(els.subscriptionsDisclosure, "rss-subscriptions");
  bindDisclosureState(els.managementDisclosure, "rss-management");

  // ---------- 工具 ----------

  async function api(path, { method = "GET", body } = {}) {
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
    }
    return payload;
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const diff = Date.now() - Date.parse(iso);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return new Date(iso).toLocaleDateString("zh-CN");
  }

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "时间未知";
    const pad = (value) => String(value).padStart(2, "0");
    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    ].join(" ");
  }

  function stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html || "") : (html || "");
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  function snippetOf(entry, max = 140) {
    const text = entry.analysisSummary || stripHtml(entry.summaryHtml || "");
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function persistView() {
    saveRssViewState(state.view);
  }

  // ---------- 导航 ----------

  async function loadNav() {
    try {
      state.nav = await api("/api/rss/feeds");
      renderNav();
      if (state.active) renderList();
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  function renderNav() {
    document.querySelectorAll("[data-rss-scope]").forEach((button) => {
      const active = state.view.scope === button.dataset.rssScope && !state.view.scopeId;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    const tree = els.feedTree;
    tree.replaceChildren();
    const showUnread = state.nav.showUnreadCounts;
    els.subscriptionsCount.textContent = String(state.nav.feeds.length);

    const allButton = navItem("全部订阅", state.view.scope === "feed" && !state.view.scopeId, () => {
      setScope("feed", null);
    });
    const totalUnread = state.nav.unreadCount;
    if (showUnread && totalUnread > 0) {
      allButton.appendChild(unreadBadge(totalUnread));
    }
    tree.appendChild(allButton);

    const folders = [...state.nav.folders].sort((a, b) => a.position - b.position);
    const ungrouped = state.nav.feeds.filter((feed) => !feed.folderId);
    for (const folder of folders) {
      const details = document.createElement("details");
      details.className = "rss-folder";
      bindDisclosureState(details, `rss-folder:${folder.id}`, {
        defaultOpen:
          state.view.scope === "folder" && state.view.scopeId === folder.id ||
          state.view.scope === "feed" &&
            state.nav.feeds.some(
              (feed) => feed.id === state.view.scopeId && feed.folderId === folder.id
            )
      });
      const summary = document.createElement("summary");
      const name = document.createElement("button");
      name.type = "button";
      name.className = "rss-folder-open";
      name.textContent = folder.name;
      name.title = `查看「${folder.name}」中的资讯`;
      name.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setScope("folder", folder.id);
      });
      summary.appendChild(name);
      if (showUnread && folder.unreadCount > 0) summary.appendChild(unreadBadge(folder.unreadCount));
      details.appendChild(summary);
      for (const feed of state.nav.feeds.filter((item) => item.folderId === folder.id)) {
        details.appendChild(feedButton(feed, showUnread));
      }
      tree.appendChild(details);
    }
    if (ungrouped.length > 0) {
      const details = document.createElement("details");
      details.className = "rss-folder";
      bindDisclosureState(details, "rss-folder:ungrouped", {
        defaultOpen:
          state.view.scope === "feed" &&
          ungrouped.some((feed) => feed.id === state.view.scopeId)
      });
      const summary = document.createElement("summary");
      const name = document.createElement("span");
      name.className = "rss-folder-label";
      name.textContent = "未分组";
      summary.appendChild(name);
      const unreadCount = ungrouped.reduce((total, feed) => total + feed.unreadCount, 0);
      if (showUnread && unreadCount > 0) summary.appendChild(unreadBadge(unreadCount));
      details.appendChild(summary);
      for (const feed of ungrouped) {
        details.appendChild(feedButton(feed, showUnread));
      }
      tree.appendChild(details);
    }

    document.querySelector('[data-rss-scope="inbox"]').textContent =
      showUnread && totalUnread > 0 ? `收件箱（${totalUnread}）` : "收件箱";
  }

  function navItem(label, active, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rss-nav-item";
    button.dataset.active = String(active);
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function feedButton(feed, showUnread) {
    const row = document.createElement("div");
    row.className = "rss-feed-item-row";
    const button = navItem(feed.title, state.view.scope === "feed" && state.view.scopeId === feed.id, () => {
      setScope("feed", feed.id);
    });
    button.classList.add("rss-feed-item");
    button.title = feed.lastError ? `${feed.title}：${feed.lastError}` : feed.title;
    if (feed.disabled) button.classList.add("is-paused");
    if (feed.consecutiveFailures > 0) button.classList.add("has-error");
    if (showUnread && feed.unreadCount > 0) button.appendChild(unreadBadge(feed.unreadCount));

    const unsubscribe = document.createElement("button");
    unsubscribe.type = "button";
    unsubscribe.className = "rss-feed-unsubscribe";
    unsubscribe.textContent = "取消关注";
    unsubscribe.title = `取消关注「${feed.title}」`;
    unsubscribe.setAttribute("aria-label", unsubscribe.title);
    unsubscribe.addEventListener("click", () => unsubscribeFeed(feed));

    row.append(button, unsubscribe);
    return row;
  }

  async function unsubscribeFeed(feed) {
    if (!window.confirm(`确定取消关注「${feed.title}」？已收藏和有标注的内容会保留。`)) return;
    try {
      await api(`/api/rss/feeds/${feed.id}`, { method: "DELETE" });
      if (state.view.scope === "feed" && state.view.scopeId === feed.id) {
        state.view.scope = "inbox";
        state.view.scopeId = null;
        persistView();
      }
      await Promise.all([loadNav(), loadEntries({ reset: true }), updateRefreshStatus()]);
      if (state.activeEntry?.feedId === feed.id) renderArticleBar();
      if (els.feedsDialog.open) await renderFeedsManage();
      host.setStatus(`已取消关注「${feed.title}」。`);
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  function unreadBadge(count) {
    const badge = document.createElement("span");
    badge.className = "rss-unread-badge";
    badge.textContent = count > 99 ? "99+" : String(count);
    return badge;
  }

  function setScope(scope, scopeId = null) {
    state.view.scope = scope;
    state.view.scopeId = scopeId;
    // 收藏与稍后读范围默认展示全部，避免未读筛选藏掉已读条目
    if (["starred", "later", "today"].includes(scope)) {
      state.view.read = "all";
    }
    els.appShell.classList.remove("rss-reading");
    els.appShell.classList.remove("rss-mobile-nav");
    els.appShell.classList.add("rss-mobile-list");
    persistView();
    renderNav();
    loadEntries({ reset: true });
  }

  // ---------- 列表 ----------

  function scopeQuery() {
    const params = new URLSearchParams();
    params.set("scope", state.view.scope);
    if (state.view.scopeId) params.set("scopeId", String(state.view.scopeId));
    params.set("read", state.view.read);
    params.set("sort", state.view.sort);
    params.set("limit", "40");
    if (els.listSearch.value.trim()) params.set("query", els.listSearch.value.trim());
    return params;
  }

  async function loadEntries({ reset = false, append = false } = {}) {
    if (state.loading) {
      if (reset) state.reloadAfterLoad = true;
      return;
    }
    state.loading = true;
    try {
      if (state.view.scope === "today") {
        await loadBrief();
      } else {
        const params = scopeQuery();
        if (append && state.nextCursor) params.set("cursor", state.nextCursor);
        const payload = await api(`/api/rss/entries?${params}`);
        state.entries = append ? [...state.entries, ...payload.entries] : payload.entries;
        state.nextCursor = payload.nextCursor;
        state.brief = null;
      }
      state.focusIndex = -1;
      renderList();
    } catch (error) {
      host.setStatus(error.message, true);
    } finally {
      state.loading = false;
      if (state.reloadAfterLoad) {
        state.reloadAfterLoad = false;
        loadEntries({ reset: true });
      }
    }
  }

  async function loadBrief() {
    const response = await fetch("/api/rss/briefs/today");
    if (response.status === 404) {
      state.brief = null;
      state.entries = [];
      state.nextCursor = null;
      return;
    }
    state.brief = await response.json();
    state.entries = filteredBriefEntries();
    state.nextCursor = null;
  }

  async function generateBrief() {
    els.briefBanner.querySelector("button")?.setAttribute("disabled", "true");
    try {
      state.brief = await api("/api/rss/briefs/today", { method: "POST", body: { force: true } });
      state.entries = filteredBriefEntries();
      renderList();
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  function renderList() {
    const scopeName = state.view.scope === "feed" && state.view.scopeId
      ? state.nav.feeds.find((feed) => feed.id === state.view.scopeId)?.title || "订阅"
      : state.view.scope === "feed"
        ? "全部订阅"
      : state.view.scope === "folder" && state.view.scopeId
        ? state.nav.folders.find((folder) => folder.id === state.view.scopeId)?.name || "分组"
        : SCOPE_TITLES[state.view.scope] || "收件箱";
    els.scopeTitle.textContent = scopeName;
    els.listPanel.dataset.view = state.view.view;
    els.loadMore.hidden = !state.nextCursor;

    syncSegment(els.readFilter, state.view.read);
    syncSegment(els.sortControl, state.view.sort);
    syncSegment(els.viewControl, state.view.view);

    renderBriefBanner();

    const list = els.entryList;
    list.replaceChildren();
    list.className = `rss-entry-list view-${state.view.view}`;

    if (state.nav.feeds.length === 0) {
      list.appendChild(emptyState(
        "添加你信任的来源，文澈会把更新整理成可深读的资讯。",
        [
          { label: "添加订阅", action: () => openAddDialog() },
          { label: "导入订阅源", action: () => els.opmlDialog.showModal() }
        ]
      ));
      return;
    }
    if (state.view.scope === "today" && !state.brief) {
      list.appendChild(emptyState("今天还没有生成精选。", [
        { label: "立即生成", action: () => generateBrief() },
        { label: "查看收件箱", action: () => setScope("inbox") }
      ]));
      return;
    }
    if (state.entries.length === 0) {
      list.appendChild(emptyState(
        state.view.read === "unread" ? "没有未读资讯。" : "这里还没有内容。",
        state.view.read === "unread" ? [{ label: "查看全部", action: () => setReadFilter("all") }] : []
      ));
      return;
    }

    for (const [index, entry] of state.entries.entries()) {
      list.appendChild(renderEntry(entry, index));
    }
  }

  function renderBriefBanner() {
    if (state.view.scope !== "today" || !state.brief) {
      els.briefBanner.hidden = true;
      els.briefBanner.replaceChildren();
      return;
    }
    els.briefBanner.hidden = false;
    els.briefBanner.replaceChildren();
    const text = document.createElement("span");
    text.textContent = `今日精选 · ${state.brief.entries.filter((item) => item.section === "focus").length} 条重点 · 生成于 ${new Date(state.brief.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.textContent = "重新生成";
    regenerate.addEventListener("click", () => generateBrief());
    els.briefBanner.append(text, regenerate);
  }

  function emptyState(message, actions) {
    const box = document.createElement("div");
    box.className = "rss-empty";
    const text = document.createElement("p");
    text.textContent = message;
    box.appendChild(text);
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", action.action);
      box.appendChild(button);
    }
    return box;
  }

  function renderEntry(entry, index) {
    const item = document.createElement("article");
    item.className = "rss-entry";
    item.dataset.entryId = entry.id;
    item.dataset.read = entry.readState;
    if (index === state.focusIndex) item.classList.add("is-focused");

    if (state.view.view === "compact") {
      const dot = document.createElement("span");
      dot.className = "rss-unread-dot";
      dot.hidden = entry.readState === "read";
      dot.setAttribute("aria-label", entry.readState === "read" ? "已读" : "未读");
      const title = document.createElement("button");
      title.type = "button";
      title.className = "rss-entry-title";
      title.textContent = entry.title;
      title.addEventListener("click", () => openEntry(entry.id));
      const source = document.createElement("span");
      source.className = "rss-entry-source";
      source.textContent = entry.feedTitle;
      const timestamp = entry.publishedAt || entry.receivedAt;
      const time = document.createElement("time");
      time.className = "rss-entry-time";
      time.dateTime = timestamp || "";
      time.title = relativeTime(timestamp);
      time.textContent = formatDateTime(timestamp);
      item.append(
        dot,
        createEntryThumbnail(entry, "compact"),
        title,
        source,
        time,
        entryStarButton(entry)
      );
      return item;
    }

    const head = document.createElement("div");
    head.className = "rss-entry-head";
    const source = document.createElement("span");
    source.className = "rss-entry-source";
    source.textContent = entry.feedTitle;
    if (entry.feedPriority >= 1) {
      const badge = document.createElement("span");
      badge.className = "rss-priority-badge";
      badge.textContent = "重点";
      source.appendChild(badge);
    }
    const timestamp = entry.publishedAt || entry.receivedAt;
    const time = document.createElement("time");
    time.className = "rss-entry-time";
    time.dateTime = timestamp || "";
    time.title = relativeTime(timestamp);
    time.textContent = `${formatDateTime(timestamp)} · 约 ${entry.estimatedReadMinutes} 分钟`;
    head.append(source, time);

    const title = document.createElement("button");
    title.type = "button";
    title.className = "rss-entry-title";
    title.textContent = entry.title;
    title.addEventListener("click", () => openEntry(entry.id));

    const summary = document.createElement("p");
    summary.className = "rss-entry-summary";
    summary.textContent = snippetOf(entry, state.view.view === "cards" ? 260 : 140);

    const reason = state.view.scope === "today"
      ? entry.briefReason || entry.recommendationReason
      : "";
    const reasonEl = reason ? document.createElement("p") : null;
    if (reasonEl) {
      reasonEl.className = "rss-entry-reason";
      reasonEl.textContent = `推荐：${reason}`;
    }

    const thumbnail = createEntryThumbnail(
      entry,
      state.view.view === "cards" ? "card" : "summary"
    );
    if (state.view.view === "cards") {
      const body = document.createElement("div");
      body.className = "rss-entry-body";
      body.append(head, title, summary);
      if (reasonEl) body.append(reasonEl);
      item.append(thumbnail, body);
      return item;
    }

    const actions = document.createElement("div");
    actions.className = "rss-entry-actions";
    actions.append(
      actionButton(entry.starred ? "★" : "☆", entry.starred ? "取消收藏" : "收藏", () => patchEntry(entry.id, { starred: !entry.starred })),
      actionButton("🕑", entry.readLater ? "移出稍后读" : "稍后读", () => patchEntry(entry.id, { readLater: !entry.readLater })),
      actionButton("⊘", "不感兴趣", () => patchEntry(entry.id, { hidden: true })),
      entryStarCheckbox(entry)
    );
    item.append(thumbnail, head, title, summary);
    if (reasonEl) item.append(reasonEl);
    item.append(actions);
    return item;
  }

  function filteredBriefEntries() {
    if (!state.brief) return [];
    return state.brief.entries
      .map((item) => ({ ...item.entry, briefReason: item.reason, briefSection: item.section }))
      .filter((entry) => state.view.read === "all" || entry.readState === state.view.read);
  }

  function createEntryThumbnail(entry, variant) {
    const thumbnail = document.createElement("button");
    thumbnail.type = "button";
    thumbnail.className = `rss-entry-thumb rss-entry-thumb-${variant}`;
    thumbnail.setAttribute("aria-label", `打开 ${entry.title}`);
    thumbnail.addEventListener("click", () => openEntry(entry.id));

    const renderFallback = () => {
      thumbnail.replaceChildren();
      thumbnail.classList.add("is-fallback");
      const label = String(entry.feedTitle || entry.title || "文").trim();
      const hue = [...label].reduce(
        (total, character) => (total * 31 + character.codePointAt(0)) % 360,
        172
      );
      thumbnail.style.setProperty("--cover-hue", String(hue));
      const monogram = document.createElement("span");
      monogram.className = "rss-cover-monogram";
      monogram.textContent = [...label][0] || "文";
      thumbnail.appendChild(monogram);
      if (variant === "card") {
        const sourceLabel = document.createElement("small");
        sourceLabel.className = "rss-cover-source";
        sourceLabel.textContent = label;
        thumbnail.appendChild(sourceLabel);
      }
    };
    renderFallback();
    const imageUrl = proxiedImageUrl(entry.thumbnailUrl || entry.feedIconUrl);
    if (!imageUrl) {
      return thumbnail;
    }

    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    if (!entry.thumbnailUrl) thumbnail.classList.add("is-feed-icon");
    image.addEventListener("load", () => thumbnail.classList.add("has-image"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
    thumbnail.appendChild(image);
    return thumbnail;
  }

  function proxiedImageUrl(value) {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) return url;
    return `/api/rss/images?url=${encodeURIComponent(url)}`;
  }

  function entryStarButton(entry) {
    return actionButton(entry.starred ? "★" : "☆", entry.starred ? "取消收藏" : "收藏", () =>
      patchEntry(entry.id, { starred: !entry.starred })
    );
  }

  function entryStarCheckbox(entry) {
    const label = document.createElement("label");
    label.className = "rss-entry-select";
    label.title = "选择以批量处理";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedEntryIds.has(entry.id);
    checkbox.setAttribute("aria-label", `选择「${entry.title}」`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedEntryIds.add(entry.id);
      else state.selectedEntryIds.delete(entry.id);
      renderBatchBar();
    });
    label.appendChild(checkbox);
    return label;
  }

  function actionButton(text, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rss-action";
    button.textContent = text;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function renderBatchBar() {
    let bar = els.listPanel.querySelector(".rss-batch-bar");
    if (state.selectedEntryIds.size === 0) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "rss-batch-bar";
      els.listPanel.insertBefore(bar, els.entryList);
    }
    bar.replaceChildren();
    const count = document.createElement("span");
    count.textContent = `已选择 ${state.selectedEntryIds.size} 条`;
    const markRead = batchButton("标记已读", async () => {
      await batchState({ readState: "read" });
    });
    const later = batchButton("稍后读", async () => {
      await batchState({ readLater: true });
    });
    const hide = batchButton("不感兴趣", async () => {
      await batchState({ hidden: true });
    });
    const markAllRead = batchButton("全部标记已读", async () => {
      const affected = state.entries.filter((entry) => entry.readState === "unread").length;
      if (!window.confirm(`将把当前列表中的 ${affected} 条未读标记为已读，确定继续？`)) return;
      await batchState({ readState: "read" }, state.entries.map((entry) => entry.id));
    });
    const clear = batchButton("取消选择", () => {
      state.selectedEntryIds.clear();
      renderBatchBar();
      renderList();
    });
    bar.append(count, markRead, later, hide, markAllRead, clear);
  }

  function batchButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  async function batchState(patch, ids = null) {
    const targetIds = ids || [...state.selectedEntryIds];
    if (targetIds.length === 0) return;
    try {
      await api("/api/rss/entries/batch-state", { method: "POST", body: { ids: targetIds, state: patch } });
      state.selectedEntryIds.clear();
      renderBatchBar();
      await Promise.all([loadEntries({ reset: true }), loadNav()]);
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  async function patchEntry(entryId, patch) {
    try {
      const updated = await api(`/api/rss/entries/${entryId}/state`, { method: "PATCH", body: patch });
      const index = state.entries.findIndex((entry) => entry.id === entryId);
      if (updated.hidden) {
        state.entries.splice(index, 1);
      } else if (index !== -1) {
        state.entries[index] = { ...state.entries[index], ...updated };
      }
      if (state.activeEntry?.id === entryId) {
        state.activeEntry = { ...state.activeEntry, ...updated };
        renderArticleBar();
      }
      renderList();
      loadNav();
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  // ---------- 打开与阅读 ----------

  async function openEntry(entryId) {
    try {
      const payload = await api(`/api/rss/entries/${entryId}/open`, { method: "POST" });
      state.activeEntry = payload.entry;
      els.appShell.classList.add("rss-reading");
      els.appShell.classList.remove("rss-mobile-nav", "rss-mobile-list");
      await host.openDocument(payload.documentId);
      if (payload.sourceUpdated) {
        host.setStatus("来源正文已更新，当前展示的是打开时的阅读快照。", false);
      }
      await Promise.all([loadEntries({ reset: true }).catch(() => {}), loadNav().catch(() => {})]);
      renderList();
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  function onDocumentLoaded(documentData) {
    if (!state.active) return;
    if (documentData?.sourceType === "rss" && state.activeEntry) {
      els.articleBar.hidden = false;
      els.quickActions.hidden = false;
      renderArticleBar();
    } else {
      els.articleBar.hidden = true;
      els.quickActions.hidden = true;
      state.activeEntry = null;
    }
  }

  function renderArticleBar() {
    const entry = state.activeEntry;
    if (!entry) return;
    const contentStatus = entry.contentSource === "extracted"
      ? "已提取全文"
      : String(entry.contentText || "").trim().length >= 80
        ? "RSS 正文"
        : "仅短摘要";
    els.articleMeta.replaceChildren();
    const feed = state.nav.feeds.find((item) => Number(item.id) === Number(entry.feedId));
    if (entry.feedTitle) {
      const sourceGroup = document.createElement("span");
      sourceGroup.className = "rss-article-source-group";

      const source = document.createElement("span");
      source.className = "rss-article-source";
      source.textContent = entry.feedTitle;
      sourceGroup.appendChild(source);

      if (feed) {
        const unsubscribe = document.createElement("button");
        unsubscribe.type = "button";
        unsubscribe.className = "rss-article-unsubscribe";
        unsubscribe.textContent = "取消关注";
        unsubscribe.title = `取消关注「${feed.title}」`;
        unsubscribe.setAttribute("aria-label", unsubscribe.title);
        unsubscribe.addEventListener("click", () => unsubscribeFeed(feed));
        sourceGroup.appendChild(unsubscribe);
      }
      els.articleMeta.appendChild(sourceGroup);
    }
    const metaItems = [
      ["rss-article-author", entry.author],
      ["rss-article-date", formatDateTime(entry.publishedAt || entry.receivedAt)],
      ["rss-article-duration", `约 ${entry.estimatedReadMinutes} 分钟`],
      ["rss-article-content-status", contentStatus]
    ];
    for (const [className, text] of metaItems) {
      if (!text) continue;
      const item = document.createElement("span");
      item.className = className;
      item.textContent = text;
      els.articleMeta.appendChild(item);
    }

    els.articleOrigin.href = entry.canonicalUrl || "#";
    els.articleOrigin.hidden = !entry.canonicalUrl;

    els.articleBar.querySelectorAll("[data-rss-action]").forEach((button) => {
      const action = button.dataset.rssAction;
      if (action === "star") {
        const label = button.querySelector("[data-rss-action-label]");
        if (label) label.textContent = entry.starred ? "已收藏" : "收藏";
        button.classList.toggle("is-on", entry.starred);
        button.title = entry.starred ? "取消收藏文章" : "收藏文章";
        button.setAttribute("aria-label", button.title);
      } else if (action === "later") {
        const label = button.querySelector("[data-rss-action-label]");
        if (label) label.textContent = entry.readLater ? "移出稍后读" : "稍后读";
        button.classList.toggle("is-on", entry.readLater);
        button.title = entry.readLater ? "移出稍后读" : "稍后读";
        button.setAttribute("aria-label", button.title);
      } else if (action === "save") {
        const savedToLibrary = Boolean(entry.isLibraryVisible);
        const label = button.querySelector("[data-rss-action-label]");
        if (label) label.textContent = savedToLibrary ? "查看文档" : "保存到文档";
        button.title = savedToLibrary ? "在本地文档库中查看" : "加入本地文档库";
        button.setAttribute("aria-label", button.title);
      } else if (action === "extract") {
        button.hidden = entry.contentSource === "extracted" || !entry.canonicalUrl;
      }
    });
  }

  async function articleAction(action) {
    const entry = state.activeEntry;
    if (!entry) return;
    try {
      if (action === "unread") {
        state.activeEntry = await api(`/api/rss/entries/${entry.id}/state`, { method: "PATCH", body: { readState: "unread" } });
      } else if (action === "star") {
        state.activeEntry = await api(`/api/rss/entries/${entry.id}/state`, { method: "PATCH", body: { starred: !entry.starred } });
      } else if (action === "later") {
        state.activeEntry = await api(`/api/rss/entries/${entry.id}/state`, { method: "PATCH", body: { readLater: !entry.readLater } });
      } else if (action === "hide") {
        state.activeEntry = await api(`/api/rss/entries/${entry.id}/state`, { method: "PATCH", body: { hidden: true } });
        host.setStatus("已标记为不感兴趣，后续将减少此类推荐。");
      } else if (action === "extract") {
        host.setStatus("正在提取全文…");
        const extracted = await api(`/api/rss/entries/${entry.id}/extract`, { method: "POST" });
        state.activeEntry = extracted.entry;
        if (extracted.snapshot?.updated) {
          await host.openDocument(entry.documentId);
          host.setStatus("已提取全文并更新当前阅读快照。");
        } else if (extracted.snapshot?.reason === "protected") {
          host.setStatus("全文已提取；当前快照已有标注或 AI 记录，为避免引用错位，已保留原快照。", false);
        } else {
          host.setStatus("全文已提取。");
        }
      } else if (action === "save") {
        if (entry.isLibraryVisible && entry.documentId) {
          await host.openSavedDocument(entry.documentId);
          host.setStatus("已打开本地文档库中的文章。");
          return;
        }
        const saved = await api(`/api/rss/entries/${entry.id}/save-to-library`, { method: "POST", body: {} });
        await host.refreshDocuments();
        state.activeEntry = {
          ...state.activeEntry,
          documentId: saved.documentId,
          isLibraryVisible: true
        };
        host.setStatus("已加入左侧“本地文档库”，可再次点击“查看文档”打开。");
      }
      renderArticleBar();
      loadEntries({ reset: true }).catch(() => {});
      loadNav().catch(() => {});
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  function onReaderPageChanged(pageIndex, pageCount) {
    if (!state.activeEntry || pageCount <= 0) return;
    clearTimeout(state.progressTimer);
    state.progressTimer = setTimeout(() => {
      api(`/api/rss/entries/${state.activeEntry.id}/state`, {
        method: "PATCH",
        body: { readProgress: Math.min(1, (pageIndex + 1) / pageCount) }
      }).catch(() => {});
    }, 800);
  }

  // ---------- 刷新 ----------

  async function refreshAll() {
    els.refreshAll.disabled = true;
    els.refreshAll.textContent = "刷新中…";
    try {
      const result = await api("/api/rss/refresh", { method: "POST" });
      const message = result.failed > 0
        ? `刷新完成：新增 ${result.inserted} 条、更新 ${result.updated || 0} 条，${result.failed} 个来源失败。`
        : result.inserted > 0 || result.updated > 0
          ? `刷新完成：新增 ${result.inserted} 条，更新 ${result.updated || 0} 条。`
          : "没有新内容。";
      host.setStatus(message, result.failed > 0);
      await Promise.all([loadEntries({ reset: true }), loadNav(), updateRefreshStatus()]);
    } catch (error) {
      host.setStatus(error.message, true);
    } finally {
      els.refreshAll.disabled = false;
      els.refreshAll.textContent = "⟳ 刷新";
    }
  }

  async function updateRefreshStatus() {
    try {
      const status = await api("/api/rss/status");
      els.lastUpdated.textContent = status.lastFetchedAt
        ? `上次更新 ${new Date(status.lastFetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
        : "尚未刷新";
      els.lastUpdated.title = status.failedFeeds.length > 0
        ? `${status.failedFeeds.length} 个来源失败：${status.failedFeeds.map((feed) => feed.title).join("、")}`
        : "所有来源正常";
    } catch {
      // 状态获取失败不影响主流程
    }
  }

  // ---------- 添加订阅 ----------

  function openAddDialog() {
    els.addUrl.value = "";
    els.addStatus.textContent = "";
    els.addCandidates.replaceChildren();
    els.addDialog.showModal();
    els.addUrl.focus();
  }

  async function discoverFeeds() {
    const url = els.addUrl.value.trim();
    if (!url) return;
    els.addStatus.textContent = "正在探测可用订阅…";
    els.addCandidates.replaceChildren();
    try {
      const payload = await api("/api/rss/discover", { method: "POST", body: { url } });
      els.addStatus.textContent = "";
      for (const candidate of payload.candidates) {
        els.addCandidates.appendChild(renderCandidate(candidate));
      }
      if (payload.candidates.length === 0) {
        els.addStatus.textContent = "未发现可订阅的 RSS 或 Atom 地址。";
      }
    } catch (error) {
      els.addStatus.textContent = error.message;
    }
  }

  function renderCandidate(candidate) {
    const box = document.createElement("div");
    box.className = "rss-candidate";
    const title = document.createElement("strong");
    title.textContent = candidate.title;
    const meta = document.createElement("span");
    meta.textContent = `${candidate.format.toUpperCase()} · ${candidate.siteUrl || candidate.feedUrl}`;
    const recent = document.createElement("ul");
    for (const entry of candidate.recentEntries || []) {
      const li = document.createElement("li");
      li.textContent = entry.title;
      recent.appendChild(li);
    }
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = candidate.title;
    nameInput.maxLength = 160;
    nameInput.setAttribute("aria-label", "订阅名称");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = "确认订阅";
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        await api("/api/rss/feeds", {
          method: "POST",
          body: { feedUrl: candidate.feedUrl, title: nameInput.value.trim() || candidate.title }
        });
        els.addDialog.close();
        host.setStatus(`已订阅「${nameInput.value.trim() || candidate.title}」。`);
        await Promise.all([loadNav(), loadEntries({ reset: true }), updateRefreshStatus()]);
      } catch (error) {
        confirm.disabled = false;
        els.addStatus.textContent = error.message;
      }
    });
    box.append(title, meta, recent, nameInput, confirm);
    return box;
  }

  // ---------- OPML ----------

  async function previewOpmlFile() {
    const file = els.opmlFile.files?.[0];
    if (!file) return;
    state.opmlContent = await file.text();
    els.opmlStatus.textContent = "正在解析 OPML…";
    els.opmlPreview.replaceChildren();
    els.opmlImport.disabled = true;
    try {
      const payload = await api("/api/rss/opml/preview", { method: "POST", body: { opml: state.opmlContent } });
      const summary = payload.summary;
      els.opmlStatus.textContent = `共 ${payload.items.length} 条：新增 ${summary.new || 0}，重复 ${summary.duplicate || 0}，可恢复 ${summary.reenable || 0}，无效 ${summary.invalid || 0}${summary.unsupported ? `，不支持 ${summary.unsupported}` : ""}。`;
      const list = document.createElement("ul");
      list.className = "rss-opml-list";
      for (const item of payload.items.slice(0, 100)) {
        const li = document.createElement("li");
        li.dataset.status = item.status;
        li.textContent = `${item.title}${item.folderName ? `（${item.folderName}）` : ""} — ${statusLabel(item.status)}`;
        list.appendChild(li);
      }
      els.opmlPreview.replaceChildren(list);
      els.opmlImport.disabled = (summary.new || 0) + (summary.reenable || 0) === 0;
    } catch (error) {
      els.opmlStatus.textContent = error.message;
    }
  }

  function statusLabel(status) {
    return {
      new: "新增",
      duplicate: "重复",
      reenable: "重新订阅",
      invalid: "无效",
      unsupported: "不支持"
    }[status] || status;
  }

  async function importOpml() {
    els.opmlImport.disabled = true;
    els.opmlStatus.textContent = "正在导入…";
    try {
      const result = await api("/api/rss/opml/import", { method: "POST", body: { opml: state.opmlContent } });
      els.opmlStatus.textContent = `导入完成：新增 ${result.imported}，恢复 ${result.reenabled}，跳过 ${result.skipped}，失败 ${result.failed.length}。`;
      await Promise.all([loadNav(), loadEntries({ reset: true }), updateRefreshStatus()]);
    } catch (error) {
      els.opmlStatus.textContent = error.message;
      els.opmlImport.disabled = false;
    }
  }

  // ---------- 管理订阅 ----------

  async function renderFeedsManage() {
    await loadNav();
    const list = els.feedsList;
    list.replaceChildren();
    if (state.nav.feeds.length === 0) {
      list.appendChild(emptyState("还没有订阅源。", []));
      return;
    }
    const folderOptions = [{ id: null, name: "未分组" }, ...state.nav.folders];
    for (const feed of state.nav.feeds) {
      const row = document.createElement("div");
      row.className = "rss-feed-row";

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.value = feed.title;
      titleInput.maxLength = 160;
      titleInput.setAttribute("aria-label", "订阅名称");

      const folderSelect = document.createElement("select");
      folderSelect.setAttribute("aria-label", "订阅分组");
      for (const folder of folderOptions) {
        const option = document.createElement("option");
        option.value = folder.id ?? "";
        option.textContent = folder.name;
        folderSelect.appendChild(option);
      }
      folderSelect.value = feed.folderId ?? "";

      const prioritySelect = document.createElement("select");
      prioritySelect.setAttribute("aria-label", "来源优先级");
      for (const [value, label] of [["-1", "降低"], ["0", "普通"], ["1", "重点"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        prioritySelect.appendChild(option);
      }
      prioritySelect.value = String(feed.priority);

      const intervalInput = document.createElement("input");
      intervalInput.type = "number";
      intervalInput.min = "15";
      intervalInput.max = "1440";
      intervalInput.value = String(feed.fetchIntervalMinutes);
      intervalInput.title = "刷新间隔（分钟）";
      intervalInput.setAttribute("aria-label", "刷新间隔（分钟）");

      const fullTextControl = document.createElement("label");
      fullTextControl.className = "rss-feed-fulltext";
      const fullTextTitle = document.createElement("span");
      fullTextTitle.textContent = "文章正文";
      const fullTextSelect = document.createElement("select");
      fullTextSelect.setAttribute("aria-label", "正文获取方式");
      for (const [value, label] of [["feed", "使用 RSS 正文（默认）"], ["extract_on_open", "打开时自动提取原文"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        fullTextSelect.appendChild(option);
      }
      fullTextSelect.value = feed.fullTextMode;
      const fullTextHint = document.createElement("small");
      fullTextHint.textContent = "适合只提供摘要的订阅源；仅在打开文章时请求原网站。";
      fullTextControl.append(fullTextTitle, fullTextSelect, fullTextHint);

      const aiExcludedLabel = document.createElement("label");
      aiExcludedLabel.className = "rss-feed-check";
      const aiExcluded = document.createElement("input");
      aiExcluded.type = "checkbox";
      aiExcluded.checked = feed.aiExcluded;
      aiExcludedLabel.append(aiExcluded, document.createTextNode(" 不参与 AI 初评"));

      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "保存";
      save.addEventListener("click", async () => {
        try {
          await api(`/api/rss/feeds/${feed.id}`, {
            method: "PATCH",
            body: {
              title: titleInput.value.trim() || feed.title,
              folderId: folderSelect.value ? Number(folderSelect.value) : null,
              priority: Number(prioritySelect.value),
              fetchIntervalMinutes: Number(intervalInput.value),
              fullTextMode: fullTextSelect.value,
              aiExcluded: aiExcluded.checked
            }
          });
          host.setStatus("订阅设置已保存。");
          await Promise.all([renderFeedsManage(), loadNav()]);
        } catch (error) {
          host.setStatus(error.message, true);
        }
      });

      const pause = document.createElement("button");
      pause.type = "button";
      pause.textContent = feed.disabled ? "恢复" : "暂停";
      pause.addEventListener("click", async () => {
        await api(`/api/rss/feeds/${feed.id}`, { method: "PATCH", body: { disabled: !feed.disabled } }).catch((error) => host.setStatus(error.message, true));
        await Promise.all([renderFeedsManage(), loadNav()]);
      });

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.textContent = feed.consecutiveFailures > 0 ? "重试" : "刷新";
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        try {
          await api(`/api/rss/feeds/${feed.id}/refresh`, { method: "POST" });
        } catch (error) {
          host.setStatus(error.message, true);
        } finally {
          refresh.disabled = false;
        }
        await Promise.all([renderFeedsManage(), loadNav(), loadEntries({ reset: true })]);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.className = "is-danger";
      remove.addEventListener("click", () => unsubscribeFeed(feed));

      const error = document.createElement("p");
      error.className = "rss-feed-error";
      error.textContent = feed.lastError || "";
      error.hidden = !feed.lastError;

      const controls = document.createElement("div");
      controls.className = "rss-feed-controls";
      controls.append(
        titleInput,
        folderSelect,
        prioritySelect,
        intervalInput,
        fullTextControl,
        aiExcludedLabel,
        save,
        pause,
        refresh,
        remove
      );
      row.append(controls, error);
      list.appendChild(row);
    }
  }

  function openFolderDialog() {
    els.newFolderName.value = "";
    els.folderDialogStatus.hidden = true;
    els.folderDialogStatus.textContent = "";
    els.folderDialog.showModal();
    els.newFolderName.focus();
  }

  async function createFolder() {
    const name = els.newFolderName.value.trim();
    if (!name) {
      els.folderDialogStatus.textContent = "请输入分组名称。";
      els.folderDialogStatus.hidden = false;
      els.newFolderName.focus();
      return;
    }
    try {
      await api("/api/rss/folders", { method: "POST", body: { name } });
      els.folderDialog.close();
      host.setStatus(`已创建订阅分组“${name}”。`);
      await loadNav();
    } catch (error) {
      els.folderDialogStatus.textContent = error.message;
      els.folderDialogStatus.hidden = false;
    }
  }

  // ---------- 设置 ----------

  async function openPrefs() {
    try {
      const prefs = await api("/api/rss/preferences");
      document.querySelector("#rss-prefs-topics").value = (prefs.topics || [])
        .map((topic) => (topic.weight && topic.weight !== 0.8 ? `${topic.name}:${topic.weight}` : topic.name))
        .join("\n");
      document.querySelector("#rss-prefs-blocked-topics").value = (prefs.blockedTopics || []).join("\n");
      document.querySelector("#rss-prefs-brief-count").value = prefs.dailyBriefCount;
      document.querySelector("#rss-prefs-interval").value = prefs.fetchIntervalMinutes;
      document.querySelector("#rss-prefs-show-unread").checked = prefs.showUnreadCounts;
      document.querySelector("#rss-prefs-auto-ai").checked = prefs.autoAiAnalysis;
      document.querySelector("#rss-prefs-explore").checked = prefs.exploreItem;
      document.querySelector("#rss-prefs-longform").checked = prefs.prefersLongForm;
      openSettings("rss");
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  async function savePrefs() {
    const topics = document.querySelector("#rss-prefs-topics").value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, weight] = line.split(":");
        return { name: name.trim(), weight: Number(weight) || 0.8 };
      });
    const blockedTopics = document.querySelector("#rss-prefs-blocked-topics").value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      await api("/api/rss/preferences", {
        method: "PATCH",
        body: {
          topics,
          blockedTopics,
          dailyBriefCount: Number(document.querySelector("#rss-prefs-brief-count").value),
          fetchIntervalMinutes: Number(document.querySelector("#rss-prefs-interval").value),
          showUnreadCounts: document.querySelector("#rss-prefs-show-unread").checked,
          autoAiAnalysis: document.querySelector("#rss-prefs-auto-ai").checked,
          exploreItem: document.querySelector("#rss-prefs-explore").checked,
          prefersLongForm: document.querySelector("#rss-prefs-longform").checked
        }
      });
      closeSettings();
      host.setStatus("资讯设置已保存。");
      await loadNav();
    } catch (error) {
      host.setStatus(error.message, true);
    }
  }

  // ---------- 筛选与快捷键 ----------

  function syncSegment(container, value) {
    container.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.value === value;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setReadFilter(value) {
    state.view.read = value;
    persistView();
    loadEntries({ reset: true });
  }

  function moveFocus(delta) {
    if (state.entries.length === 0) return;
    state.focusIndex = Math.min(Math.max(state.focusIndex + delta, 0), state.entries.length - 1);
    els.entryList.querySelectorAll(".rss-entry").forEach((item, index) => {
      item.classList.toggle("is-focused", index === state.focusIndex);
    });
    els.entryList.querySelectorAll(".rss-entry")[state.focusIndex]?.scrollIntoView({ block: "nearest" });
  }

  function handleShortcut(event) {
    if (!state.active || !state.view.shortcutsEnabled) return;
    if (event.target.closest("input, textarea, select, dialog, [contenteditable]")) return;
    const entry = state.entries[state.focusIndex];
    switch (event.key) {
      case "j":
        moveFocus(1);
        event.preventDefault();
        break;
      case "k":
        moveFocus(-1);
        event.preventDefault();
        break;
      case "o":
      case "Enter":
        if (entry) {
          openEntry(entry.id);
          event.preventDefault();
        }
        break;
      case "m":
        if (entry) {
          patchEntry(entry.id, { readState: entry.readState === "read" ? "unread" : "read" });
          event.preventDefault();
        }
        break;
      case "s":
        if (entry) {
          patchEntry(entry.id, { starred: !entry.starred });
          event.preventDefault();
        }
        break;
      default:
        break;
    }
  }

  // ---------- 事件绑定 ----------

  document.querySelectorAll("[data-rss-scope]").forEach((button) => {
    button.addEventListener("click", () => setScope(button.dataset.rssScope));
  });
  document.querySelector("#rss-nav-add").addEventListener("click", () => openAddDialog());
  document.querySelector("#rss-nav-create-folder").addEventListener("click", () => openFolderDialog());
  document.querySelector("#rss-nav-manage").addEventListener("click", () => {
    renderFeedsManage();
    els.feedsDialog.showModal();
  });
  document.querySelector("#rss-nav-opml").addEventListener("click", () => els.opmlDialog.showModal());
  document.querySelector("#rss-open-prefs").addEventListener("click", () => openPrefs());
  els.refreshAll.addEventListener("click", () => refreshAll());
  els.listRefresh.addEventListener("click", () => refreshAll());
  els.listBack.addEventListener("click", () => {
    els.appShell.classList.remove("rss-reading", "rss-mobile-list");
    els.appShell.classList.add("rss-mobile-nav");
  });
  els.articleBack.addEventListener("click", () => {
    els.appShell.classList.remove("rss-reading", "rss-mobile-nav");
    els.appShell.classList.add("rss-mobile-list");
  });
  els.loadMore.addEventListener("click", () => loadEntries({ append: true }));
  els.listSearch.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadEntries({ reset: true }), 300);
  });
  els.readFilter.addEventListener("click", (event) => {
    const value = event.target.closest("button")?.dataset.value;
    if (value) setReadFilter(value);
  });
  els.sortControl.addEventListener("click", (event) => {
    const value = event.target.closest("button")?.dataset.value;
    if (value) {
      state.view.sort = value;
      persistView();
      loadEntries({ reset: true });
    }
  });
  els.viewControl.addEventListener("click", (event) => {
    const value = event.target.closest("button")?.dataset.value;
    if (value) {
      state.view.view = value;
      persistView();
      renderList();
    }
  });
  els.articleBar.addEventListener("click", (event) => {
    const action = event.target.closest("[data-rss-action]")?.dataset.rssAction;
    if (action) {
      els.articleBar.querySelector(".rss-article-more")?.removeAttribute("open");
      articleAction(action);
    }
  });
  els.quickActions.addEventListener("click", (event) => {
    const kind = event.target.closest("[data-rss-ai]")?.dataset.rssAi;
    if (!kind) return;
    host.askQuestion(RSS_AI_QUESTIONS[kind]);
  });
  document.querySelector("#rss-add-discover").addEventListener("click", () => discoverFeeds());
  document.querySelector("#rss-add-cancel").addEventListener("click", () => els.addDialog.close());
  els.addUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      discoverFeeds();
    }
  });
  els.opmlFile.addEventListener("change", () => previewOpmlFile());
  els.opmlImport.addEventListener("click", () => importOpml());
  document.querySelector("#rss-opml-cancel").addEventListener("click", () => els.opmlDialog.close());
  document.querySelector("#rss-opml-export").addEventListener("click", () => {
    window.open("/api/rss/opml/export", "_blank", "noopener");
  });
  document.querySelector("#rss-feeds-close").addEventListener("click", () => els.feedsDialog.close());
  document.querySelector("#rss-folder-cancel").addEventListener("click", () => els.folderDialog.close());
  document.querySelector("#rss-create-folder").addEventListener("click", () => createFolder());
  els.newFolderName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createFolder();
    }
  });
  document.querySelector("#rss-prefs-cancel").addEventListener("click", closeSettings);
  document.querySelector("#rss-prefs-save").addEventListener("click", () => savePrefs());
  document.addEventListener("keydown", handleShortcut);

  // ---------- 控制器 ----------

  return {
    async activate() {
      state.active = true;
      els.nav.hidden = false;
      els.listPanel.hidden = false;
      if (!els.appShell.classList.contains("rss-reading")) {
        els.appShell.classList.add("rss-mobile-nav");
      }
      if (window.matchMedia("(max-width: 1439px)").matches) {
        host.collapseAiPanel?.();
      }
      await Promise.all([loadNav(), loadEntries({ reset: true }), updateRefreshStatus()]);
      const current = host.getCurrentDocument();
      if (current?.sourceType === "rss" && state.activeEntry) {
        els.articleBar.hidden = false;
        els.quickActions.hidden = false;
      }
    },
    deactivate() {
      state.active = false;
      els.nav.hidden = true;
      els.listPanel.hidden = true;
      els.articleBar.hidden = true;
      els.quickActions.hidden = true;
      els.appShell.classList.remove("rss-reading", "rss-mobile-nav", "rss-mobile-list");
    },
    onDocumentLoaded,
    onReaderPageChanged,
    get isActive() {
      return state.active;
    }
  };
}
