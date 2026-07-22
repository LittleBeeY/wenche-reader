import assert from "node:assert/strict";
import test from "node:test";
import { loadPanelState, savePanelState } from "../public/panelState.js";

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

test("saves and restores independent panel states", () => {
  const storage = createMemoryStorage();
  savePanelState(storage, { leftCollapsed: true, rightCollapsed: false });

  assert.deepEqual(loadPanelState(storage), {
    leftCollapsed: true,
    rightCollapsed: false
  });
});

test("falls back to expanded panels for invalid storage", () => {
  const storage = createMemoryStorage();
  storage.setItem("ai-reader:panel-state", "not json");

  assert.deepEqual(loadPanelState(storage), {
    leftCollapsed: false,
    rightCollapsed: false
  });
});
