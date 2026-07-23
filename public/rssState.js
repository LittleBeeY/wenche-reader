const STORAGE_KEY = "wenche.rss.view.v1";

export const DEFAULT_RSS_VIEW = Object.freeze({
  scope: "today",
  scopeId: null,
  read: "unread",
  sort: "smart",
  view: "summary",
  shortcutsEnabled: true
});

export function loadRssViewState(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RSS_VIEW };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_RSS_VIEW,
      ...parsed,
      read: ["unread", "all", "read"].includes(parsed.read) ? parsed.read : DEFAULT_RSS_VIEW.read,
      sort: ["smart", "newest", "oldest"].includes(parsed.sort) ? parsed.sort : DEFAULT_RSS_VIEW.sort,
      view: ["compact", "summary", "cards"].includes(parsed.view) ? parsed.view : DEFAULT_RSS_VIEW.view
    };
  } catch {
    return { ...DEFAULT_RSS_VIEW };
  }
}

export function saveRssViewState(view, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // 本地存储不可用时静默降级
  }
}
