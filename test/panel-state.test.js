import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainFloatingPanelBounds,
  constrainFloatingLauncherPosition,
  loadFloatingPanelBounds,
  loadFloatingLauncherPosition,
  loadPanelState,
  saveFloatingPanelBounds,
  saveFloatingLauncherPosition,
  savePanelState
} from "../public/panelState.js";

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

test("can default the AI panel to its compact launcher on narrow screens", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(
    loadPanelState(storage, { rightCollapsedDefault: true }),
    { leftCollapsed: false, rightCollapsed: true }
  );
  storage.setItem(
    "ai-reader:panel-state",
    JSON.stringify({ leftCollapsed: false, rightCollapsed: false })
  );
  assert.equal(
    loadPanelState(storage, { rightCollapsedDefault: true }).rightCollapsed,
    false
  );
});

test("saves floating panel bounds independently", () => {
  const storage = createMemoryStorage();
  const bounds = { left: 420, top: 36, width: 460, height: 620 };

  saveFloatingPanelBounds(storage, bounds);

  assert.deepEqual(loadFloatingPanelBounds(storage), bounds);
});

test("keeps floating panel bounds inside the viewport", () => {
  assert.deepEqual(
    constrainFloatingPanelBounds(
      { left: 980, top: -20, width: 500, height: 900 },
      { width: 1200, height: 800 }
    ),
    { left: 692, top: 8, width: 500, height: 784 }
  );
});

test("saves and constrains the compact launcher position", () => {
  const storage = createMemoryStorage();
  saveFloatingLauncherPosition(storage, { left: 760, top: 180 });

  assert.deepEqual(loadFloatingLauncherPosition(storage), { left: 760, top: 180 });
  assert.deepEqual(
    constrainFloatingLauncherPosition(
      { left: 980, top: -10 },
      { width: 900, height: 700 }
    ),
    { left: 844, top: 8 }
  );
});
