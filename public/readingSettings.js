export const DEFAULT_READING_SETTINGS = Object.freeze({
  fontScale: 100,
  contentWidth: "standard",
  lineHeight: "comfortable"
});

const STORAGE_KEY = "ai-reader:reading-settings";
const CONTENT_WIDTHS = new Set(["narrow", "standard", "wide"]);
const LINE_HEIGHTS = new Set(["compact", "comfortable", "relaxed"]);

export function normalizeReadingSettings(value = {}) {
  const numericScale = Number(value.fontScale);
  const fontScale = Number.isFinite(numericScale)
    ? Math.min(160, Math.max(80, Math.round(numericScale / 10) * 10))
    : DEFAULT_READING_SETTINGS.fontScale;

  return {
    fontScale,
    contentWidth: CONTENT_WIDTHS.has(value.contentWidth)
      ? value.contentWidth
      : DEFAULT_READING_SETTINGS.contentWidth,
    lineHeight: LINE_HEIGHTS.has(value.lineHeight)
      ? value.lineHeight
      : DEFAULT_READING_SETTINGS.lineHeight
  };
}

export function loadReadingSettings(storage) {
  if (!storage) return { ...DEFAULT_READING_SETTINGS };
  try {
    return normalizeReadingSettings(JSON.parse(storage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_READING_SETTINGS };
  }
}

export function saveReadingSettings(storage, settings) {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(normalizeReadingSettings(settings)));
}
