const PANEL_STATE_KEY = "ai-reader:panel-state";
const FLOATING_PANEL_BOUNDS_KEY = "ai-reader:floating-panel-bounds";
const FLOATING_LAUNCHER_POSITION_KEY = "ai-reader:floating-launcher-position";

export function loadPanelState(storage, { rightCollapsedDefault = false } = {}) {
  try {
    const saved = JSON.parse(storage?.getItem(PANEL_STATE_KEY) || "null");
    return {
      leftCollapsed: saved?.leftCollapsed === true,
      rightCollapsed: saved
        ? saved.rightCollapsed === true
        : rightCollapsedDefault
    };
  } catch {
    return { leftCollapsed: false, rightCollapsed: rightCollapsedDefault };
  }
}

export function savePanelState(storage, panelState) {
  try {
    storage?.setItem(PANEL_STATE_KEY, JSON.stringify({
      leftCollapsed: panelState.leftCollapsed === true,
      rightCollapsed: panelState.rightCollapsed === true
    }));
  } catch {
    // Panel controls still work when browser storage is disabled.
  }
}

export function loadFloatingPanelBounds(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(FLOATING_PANEL_BOUNDS_KEY) || "null");
    const values = [saved?.left, saved?.top, saved?.width, saved?.height];
    return values.every(Number.isFinite)
      ? {
          left: saved.left,
          top: saved.top,
          width: saved.width,
          height: saved.height
        }
      : null;
  } catch {
    return null;
  }
}

export function saveFloatingPanelBounds(storage, bounds) {
  try {
    storage?.setItem(FLOATING_PANEL_BOUNDS_KEY, JSON.stringify({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height
    }));
  } catch {
    // The floating panel still works when browser storage is disabled.
  }
}

export function constrainFloatingPanelBounds(bounds, viewport, options = {}) {
  const margin = options.margin ?? 8;
  const availableWidth = Math.max(0, viewport.width - margin * 2);
  const availableHeight = Math.max(0, viewport.height - margin * 2);
  const minWidth = Math.min(options.minWidth ?? 320, availableWidth);
  const minHeight = Math.min(options.minHeight ?? 360, availableHeight);
  const width = clamp(
    finiteOr(bounds?.width, Math.min(380, availableWidth)),
    minWidth,
    availableWidth
  );
  const height = clamp(
    finiteOr(bounds?.height, Math.min(600, availableHeight)),
    minHeight,
    availableHeight
  );
  return {
    left: clamp(
      finiteOr(bounds?.left, viewport.width - width - 16),
      margin,
      Math.max(margin, viewport.width - width - margin)
    ),
    top: clamp(
      finiteOr(bounds?.top, 112),
      margin,
      Math.max(margin, viewport.height - height - margin)
    ),
    width,
    height
  };
}

export function loadFloatingLauncherPosition(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(FLOATING_LAUNCHER_POSITION_KEY) || "null");
    return Number.isFinite(saved?.left) && Number.isFinite(saved?.top)
      ? { left: saved.left, top: saved.top }
      : null;
  } catch {
    return null;
  }
}

export function saveFloatingLauncherPosition(storage, position) {
  try {
    storage?.setItem(FLOATING_LAUNCHER_POSITION_KEY, JSON.stringify({
      left: position.left,
      top: position.top
    }));
  } catch {
    // The launcher still works when browser storage is disabled.
  }
}

export function constrainFloatingLauncherPosition(position, viewport, options = {}) {
  const margin = options.margin ?? 8;
  const size = options.size ?? 48;
  return {
    left: clamp(
      finiteOr(position?.left, viewport.width - size - 16),
      margin,
      Math.max(margin, viewport.width - size - margin)
    ),
    top: clamp(
      finiteOr(position?.top, 112),
      margin,
      Math.max(margin, viewport.height - size - margin)
    )
  };
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
