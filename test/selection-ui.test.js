import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSelectionMenuPosition,
  dismissSelectionUi
} from "../public/selectionUi.js";

test("dismisses the selection menu and clears browser and app selections", () => {
  const menu = { hidden: false };
  let rangesCleared = false;
  const browserSelection = {
    removeAllRanges() {
      rangesCleared = true;
    }
  };
  const state = {
    selection: { text: "selected text", blockIds: [1] }
  };

  dismissSelectionUi({ menu, browserSelection, state });

  assert.equal(menu.hidden, true);
  assert.equal(rangesCleared, true);
  assert.deepEqual(state.selection, { text: "", blockIds: [] });
});

test("places the menu below a desktop selection", () => {
  assert.deepEqual(
    calculateSelectionMenuPosition({
      selectionRect: { left: 300, width: 200, bottom: 240 },
      viewportWidth: 1200,
      viewportHeight: 800,
      menuWidth: 270,
      menuHeight: 44
    }),
    { left: 400, top: 252, docked: false }
  );
});

test("docks the menu when there is not enough room below", () => {
  assert.deepEqual(
    calculateSelectionMenuPosition({
      selectionRect: { left: 300, width: 200, bottom: 760 },
      viewportWidth: 1200,
      viewportHeight: 800,
      menuWidth: 270,
      menuHeight: 44
    }),
    { left: 600, top: 744, docked: true }
  );
});

test("docks the menu on narrow screens", () => {
  assert.deepEqual(
    calculateSelectionMenuPosition({
      selectionRect: { left: 80, width: 120, bottom: 200 },
      viewportWidth: 600,
      viewportHeight: 700,
      menuWidth: 270,
      menuHeight: 44
    }),
    { left: 300, top: 644, docked: true }
  );
});

test("clamps the menu inside both horizontal viewport edges", () => {
  const base = {
    viewportWidth: 800,
    viewportHeight: 700,
    menuWidth: 270,
    menuHeight: 44
  };

  assert.equal(
    calculateSelectionMenuPosition({
      ...base,
      selectionRect: { left: 0, width: 20, bottom: 200 }
    }).left,
    147
  );
  assert.equal(
    calculateSelectionMenuPosition({
      ...base,
      selectionRect: { left: 780, width: 20, bottom: 200 }
    }).left,
    653
  );
});
