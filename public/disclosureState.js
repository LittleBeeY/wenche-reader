const STORAGE_KEY = "wenche.sidebar.disclosures.v1";

function readState(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadDisclosureOpen(storage, key, defaultOpen = false) {
  const state = readState(storage);
  return typeof state[key] === "boolean" ? state[key] : defaultOpen;
}

export function saveDisclosureOpen(storage, key, open) {
  try {
    const state = readState(storage);
    state[key] = Boolean(open);
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 本地存储不可用时保留原生 details 行为
  }
}

export function bindDisclosureState(
  disclosure,
  key,
  { storage = window.localStorage, defaultOpen = false } = {}
) {
  if (!disclosure) return;
  disclosure.open = loadDisclosureOpen(storage, key, defaultOpen);
  disclosure.addEventListener("toggle", () => {
    saveDisclosureOpen(storage, key, disclosure.open);
  });
}
