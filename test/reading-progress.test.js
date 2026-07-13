import assert from "node:assert/strict";
import test from "node:test";
import {
  getLastDocumentId,
  getSavedPageIndex,
  saveReadingProgress
} from "../public/readingProgress.js";

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

test("saves and restores the last document and page", () => {
  const storage = createMemoryStorage();
  saveReadingProgress(storage, 42, 6);

  assert.equal(getLastDocumentId(storage), 42);
  assert.equal(getSavedPageIndex(storage, 42), 6);
});

test("ignores invalid or stale reading progress", () => {
  const storage = createMemoryStorage();
  storage.setItem("ai-reader:last-document", "broken");
  storage.setItem("ai-reader:page:8", "-4");

  assert.equal(getLastDocumentId(storage), null);
  assert.equal(getSavedPageIndex(storage, 8), 0);
  assert.equal(getSavedPageIndex(storage, 999), 0);
});
