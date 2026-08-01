import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RSS_VIEW,
  loadRssViewState,
  saveRssViewState
} from "../public/rssState.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("RSS uses the cover card layout by default", () => {
  assert.equal(loadRssViewState(createStorage()).view, "cards");
  assert.equal(DEFAULT_RSS_VIEW.view, "cards");
});

test("RSS migrates the old default layout once but keeps later view choices", () => {
  const legacy = createStorage({
    "wenche.rss.view.v1": JSON.stringify({ scope: "inbox", view: "summary" })
  });
  assert.equal(loadRssViewState(legacy).view, "cards");
  assert.equal(loadRssViewState(legacy).scope, "inbox");

  saveRssViewState({ ...DEFAULT_RSS_VIEW, view: "compact" }, legacy);
  assert.equal(loadRssViewState(legacy).view, "compact");
});
