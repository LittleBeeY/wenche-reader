const PANEL_STATE_KEY = "ai-reader:panel-state";

export function loadPanelState(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PANEL_STATE_KEY) || "null");
    return {
      leftCollapsed: saved?.leftCollapsed === true,
      rightCollapsed: saved?.rightCollapsed === true
    };
  } catch {
    return { leftCollapsed: false, rightCollapsed: false };
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
