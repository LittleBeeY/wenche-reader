import assert from "node:assert/strict";
import test from "node:test";
import {
  loadDisclosureOpen,
  saveDisclosureOpen
} from "../public/disclosureState.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("sidebar disclosures use their default until the user changes them", () => {
  const storage = createStorage();
  assert.equal(loadDisclosureOpen(storage, "local-library", true), true);
  assert.equal(loadDisclosureOpen(storage, "rss-subscriptions", false), false);
});

test("sidebar disclosure choices are saved independently", () => {
  const storage = createStorage();
  saveDisclosureOpen(storage, "local-library", false);
  saveDisclosureOpen(storage, "rss-subscriptions", true);
  assert.equal(loadDisclosureOpen(storage, "local-library", true), false);
  assert.equal(loadDisclosureOpen(storage, "rss-subscriptions", false), true);
});
