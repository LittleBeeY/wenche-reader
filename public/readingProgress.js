const LAST_DOCUMENT_KEY = "ai-reader:last-document";
const PAGE_KEY_PREFIX = "ai-reader:page:";

export function saveReadingProgress(storage, documentId, pageIndex) {
  const normalizedDocumentId = toNonNegativeInteger(documentId);
  const normalizedPageIndex = toNonNegativeInteger(pageIndex);
  if (!storage || normalizedDocumentId === null || normalizedPageIndex === null) return;

  try {
    storage.setItem(LAST_DOCUMENT_KEY, normalizedDocumentId);
    storage.setItem(`${PAGE_KEY_PREFIX}${normalizedDocumentId}`, normalizedPageIndex);
  } catch {
    // Reading still works when browser storage is disabled.
  }
}

export function getLastDocumentId(storage) {
  return readInteger(storage, LAST_DOCUMENT_KEY);
}

export function getSavedPageIndex(storage, documentId) {
  const normalizedDocumentId = toNonNegativeInteger(documentId);
  if (normalizedDocumentId === null) return 0;
  return readInteger(storage, `${PAGE_KEY_PREFIX}${normalizedDocumentId}`) ?? 0;
}

function readInteger(storage, key) {
  try {
    return toNonNegativeInteger(storage?.getItem(key));
  } catch {
    return null;
  }
}

function toNonNegativeInteger(value) {
  if (value === null || value === "" || !Number.isInteger(Number(value))) return null;
  const number = Number(value);
  return number >= 0 ? number : null;
}
