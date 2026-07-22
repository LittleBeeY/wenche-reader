const MARKER_PATTERN = /\[第\s*(\d+)\s*(页|段)\]/g;

export function resolveAnswerReferences(record, blocks = [], pages = []) {
  const references = [];
  const allowedMarkers = new Set(
    [...String(record?.context || "").matchAll(MARKER_PATTERN)]
      .map((match) => markerKey(match[1], match[2]))
  );
  for (const match of String(record?.answer || "").matchAll(MARKER_PATTERN)) {
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number < 1) continue;
    if (!allowedMarkers.has(markerKey(number, match[2]))) continue;
    if (match[2] === "页") {
      addReference(references, {
        label: `第 ${number} 页`,
        pageIndex: pages.length > 0
          ? Math.min(Math.max(number - 1, 0), pages.length - 1)
          : number - 1,
        blockId: null
      });
      continue;
    }

    const block = blocks.find((item) => Number(item.position) === number - 1);
    if (!block) continue;
    const pageIndex = findBlockPage(block, pages);
    addReference(references, {
      label: `第 ${number} 段 · 第 ${pageIndex + 1} 页`,
      pageIndex,
      blockId: Number(block.id)
    });
  }

  if (references.length === 0 && record?.selectedText) {
    const pageIndex = findTextPage(record.selectedText, pages);
    if (pageIndex >= 0) {
      addReference(references, { label: `第 ${pageIndex + 1} 页`, pageIndex, blockId: null });
    }
  }
  return references.slice(0, 8);
}

function markerKey(number, type) {
  return `${Number(number)}:${type}`;
}

function findBlockPage(block, pages) {
  const byId = pages.findIndex((page) => page.blockIds?.some((id) => Number(id) === Number(block.id)));
  if (byId >= 0) return byId;
  const excerpt = normalizeText(block.text).slice(0, 48);
  const byText = pages.findIndex((page) => normalizeText(page.text || page.blocks?.map((item) => item.text).join(" ")).includes(excerpt));
  return byText >= 0 ? byText : 0;
}

function findTextPage(text, pages) {
  const excerpt = normalizeText(text)
    .replace(/^第\s*\d+\s*页[：:]?\s*/, "")
    .replace(/^当前页[：:]?\s*/, "")
    .slice(0, 48);
  if (!excerpt) return -1;
  return pages.findIndex((page) => normalizeText(page.text || page.blocks?.map((item) => item.text).join(" ")).includes(excerpt));
}

function addReference(references, reference) {
  const key = `${reference.pageIndex}:${reference.blockId ?? "page"}`;
  if (!references.some((item) => item.key === key)) references.push({ ...reference, key });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
