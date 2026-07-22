import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_READING_SETTINGS,
  loadReadingSettings,
  normalizeReadingSettings,
  saveReadingSettings
} from "../public/readingSettings.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test("saves and restores reading settings", () => {
  const storage = createMemoryStorage();
  const settings = {
    fontScale: 130,
    contentWidth: "wide",
    lineHeight: "relaxed",
    theme: "eye"
  };
  saveReadingSettings(storage, settings);

  assert.deepEqual(loadReadingSettings(storage), settings);
});

test("normalizes invalid reading settings", () => {
  assert.deepEqual(
    normalizeReadingSettings({ fontScale: 999, contentWidth: "full", lineHeight: "tiny" }),
    {
      fontScale: 160,
      contentWidth: "standard",
      lineHeight: "comfortable",
      theme: "light"
    }
  );
  assert.deepEqual(loadReadingSettings(null), DEFAULT_READING_SETTINGS);
});
