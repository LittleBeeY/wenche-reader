export function findDocumentMatches(pages, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("zh-CN");
  if (!needle) return [];

  const matches = [];
  for (const [pageIndex, page] of (pages || []).entries()) {
    for (const block of page.blocks || []) {
      const text = String(block.text || "");
      const normalized = text.toLocaleLowerCase("zh-CN");
      let start = normalized.indexOf(needle);
      while (start >= 0) {
        matches.push({
          pageIndex,
          blockId: Number(block.id),
          start,
          length: needle.length
        });
        start = normalized.indexOf(needle, start + needle.length);
      }
    }
  }
  return matches;
}
