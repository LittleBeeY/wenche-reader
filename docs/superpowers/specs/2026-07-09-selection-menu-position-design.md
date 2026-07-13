# Selection Menu Position Design

## Goal

Keep the app's AI selection menu usable when browsers such as Edge display
their own text-selection toolbar.

## Constraints

Browser-native selection toolbars are outside the page DOM. The app cannot
reliably detect their bounds or disable them across browsers, so positioning
must avoid their usual above-selection area without browser-specific logic.

## Behavior

- On desktop, place the AI menu below the selected text with a 12px gap.
- Clamp the horizontal position so the menu stays inside the viewport.
- If the menu would not fit below the selection, dock it above the bottom edge
  of the viewport.
- On narrow screens, always use the bottom-docked position.
- Keep the existing behavior that dismisses the menu and clears the selection
  when the user clicks outside it.

## Structure

Add a pure positioning function to `public/selectionUi.js`. It receives the
selection rectangle, viewport dimensions, and expected menu dimensions, then
returns `{ left, top, docked }`.

`captureSelection()` applies that result to the menu and toggles an
`is-docked` class. CSS removes the current upward transform and defines the
normal and docked presentation.

## Testing

Unit tests cover:

- A desktop selection with enough room below it.
- A desktop selection near the bottom of the viewport.
- A narrow viewport.
- Horizontal clamping near both viewport edges.

The full existing test suite must continue to pass.

## Acceptance Criteria

- The app menu no longer occupies the usual above-selection position used by
  Edge's mini menu.
- The app menu remains fully visible near viewport edges.
- Mobile and narrow layouts use a stable bottom action bar.
- Existing selection capture, AI actions, and dismissal behavior are unchanged.
