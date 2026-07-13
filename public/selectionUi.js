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

export function dismissSelectionUi({ menu, browserSelection, state }) {
  menu.hidden = true;
  browserSelection?.removeAllRanges();
  state.selection = { text: "", blockIds: [] };
}
