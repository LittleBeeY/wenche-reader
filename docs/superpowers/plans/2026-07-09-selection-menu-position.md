# Selection Menu Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Position the AI selection menu away from browser-native selection toolbars while keeping it visible at viewport edges.

**Architecture:** A pure function calculates menu coordinates from the selection rectangle, viewport, and measured menu size. The reader applies those coordinates and toggles one CSS state for bottom docking.

**Tech Stack:** Browser JavaScript, CSS, Node test runner

---

## File Structure

- Modify `public/selectionUi.js`: add the pure menu-position calculation.
- Modify `test/selection-ui.test.js`: cover normal, edge, narrow, and docked positions.
- Modify `public/app.js`: measure and apply the calculated position.
- Modify `public/styles.css`: place the normal menu below its anchor and style the docked state.

### Task 1: Position Calculation

**Files:**
- Modify: `test/selection-ui.test.js`
- Modify: `public/selectionUi.js`

- [ ] **Step 1: Write failing position tests**

Add this import and tests to `test/selection-ui.test.js`:

```js
import {
  calculateSelectionMenuPosition,
  dismissSelectionUi
} from "../public/selectionUi.js";

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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test test\selection-ui.test.js
```

Expected: FAIL because `calculateSelectionMenuPosition` is not exported.

- [ ] **Step 3: Add the minimal calculation**

Add to `public/selectionUi.js`:

```js
export function calculateSelectionMenuPosition({
  selectionRect,
  viewportWidth,
  viewportHeight,
  menuWidth,
  menuHeight
}) {
  const margin = 12;
  const docked =
    viewportWidth <= 760 ||
    selectionRect.bottom + margin + menuHeight > viewportHeight - margin;

  if (docked) {
    return {
      left: Math.round(viewportWidth / 2),
      top: viewportHeight - margin - menuHeight,
      docked: true
    };
  }

  const halfWidth = menuWidth / 2;
  const selectionCenter = selectionRect.left + selectionRect.width / 2;
  return {
    left: Math.round(
      Math.min(
        Math.max(selectionCenter, margin + halfWidth),
        viewportWidth - margin - halfWidth
      )
    ),
    top: Math.round(selectionRect.bottom + margin),
    docked: false
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test test\selection-ui.test.js
```

Expected: 5 tests pass.

### Task 2: Reader Integration and Styling

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Import and apply the position helper**

Update the import in `public/app.js`:

```js
import {
  calculateSelectionMenuPosition,
  dismissSelectionUi
} from "./selectionUi.js";
```

Replace the final positioning lines in `captureSelection()` with:

```js
state.selection = { text, blockIds };
selectionMenu.hidden = false;
selectionMenu.classList.remove("is-docked");

const menuRect = selectionMenu.getBoundingClientRect();
const position = calculateSelectionMenuPosition({
  selectionRect: rect,
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  menuWidth: menuRect.width,
  menuHeight: menuRect.height
});

selectionMenu.classList.toggle("is-docked", position.docked);
selectionMenu.style.left = `${position.left}px`;
selectionMenu.style.top = `${position.top}px`;
```

- [ ] **Step 2: Change normal and docked CSS positioning**

In `public/styles.css`, replace the existing selection menu transform with:

```css
transform: translateX(-50%);
```

Add:

```css
.selection-menu.is-docked {
  max-width: calc(100vw - 24px);
  width: max-content;
}
```

- [ ] **Step 3: Verify JavaScript syntax**

Run:

```powershell
node --check public\selectionUi.js
node --check public\app.js
```

Expected: both commands exit with code 0.

### Task 3: Regression Verification

**Files:**
- Test: `test/selection-ui.test.js`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --test test\selection-ui.test.js
```

Expected: 5 tests pass.

- [ ] **Step 2: Run the complete suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass with zero failures.

## Commit Note

The workspace does not contain valid Git metadata, so commit and worktree steps
cannot run. Do not initialize or replace repository metadata without an
explicit user request.
