export function buildSelectionContext({ blocks, selection, radius = 2 }) {
  const selectedText = selection?.text?.trim() || "";
  const selectedIds = new Set(selection?.blockIds || []);

  if (selectedIds.size === 0) {
    return selectedText;
  }

  const orderedBlocks = [...blocks].sort((a, b) => a.position - b.position);
  const selectedIndexes = orderedBlocks
    .map((block, index) => (selectedIds.has(block.id) ? index : -1))
    .filter((index) => index >= 0);

  if (selectedIndexes.length === 0) {
    return selectedText;
  }

  const start = Math.max(0, Math.min(...selectedIndexes) - radius);
  const end = Math.min(orderedBlocks.length - 1, Math.max(...selectedIndexes) + radius);

  return orderedBlocks
    .slice(start, end + 1)
    .map(formatBlock)
    .join("\n\n");
}

export function buildDocumentContext({ blocks, question = "", maxChars = 12000 }) {
  const orderedBlocks = [...(blocks || [])].sort(
    (left, right) => left.position - right.position
  );
  if (orderedBlocks.length === 0 || maxChars <= 0) return "";

  const fullContext = orderedBlocks.map(formatBlock).join("\n\n");
  if (fullContext.length <= maxChars) return fullContext;

  const terms = getSearchTerms(question);
  if (terms.length === 0) {
    return fitBlocks(orderedBlocks, maxChars);
  }

  const ranked = orderedBlocks
    .map((block, index) => ({
      block,
      index,
      score: scoreText(block.text, terms) + (block.type === "heading" ? 1 : 0)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const candidateIndexes = [];
  for (const candidate of ranked) {
    if (candidate.score <= 0 && candidateIndexes.length > 0) break;
    for (const index of [candidate.index, candidate.index - 1, candidate.index + 1]) {
      if (index >= 0 && index < orderedBlocks.length && !candidateIndexes.includes(index)) {
        candidateIndexes.push(index);
      }
    }
  }

  for (const index of [0, orderedBlocks.length - 1]) {
    if (!candidateIndexes.includes(index)) candidateIndexes.push(index);
  }

  const selected = [];
  let usedChars = 0;
  for (const index of candidateIndexes) {
    const formatted = formatBlock(orderedBlocks[index]);
    const separatorChars = selected.length > 0 ? 2 : 0;
    if (usedChars + separatorChars + formatted.length > maxChars) continue;
    selected.push({ index, block: orderedBlocks[index] });
    usedChars += separatorChars + formatted.length;
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map(({ block }) => formatBlock(block))
    .join("\n\n");
}

function getSearchTerms(question) {
  const normalized = String(question || "").toLocaleLowerCase("zh-CN");
  const terms = normalized.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const cjkRuns = normalized.match(/[\p{Script=Han}]{2,}/gu) || [];
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.push(run.slice(index, index + 2));
    }
  }
  return [...new Set(terms)];
}

function scoreText(text, terms) {
  const normalized = String(text || "").toLocaleLowerCase("zh-CN");
  return terms.reduce(
    (score, term) => score + (normalized.includes(term) ? Math.min(term.length, 8) : 0),
    0
  );
}

function fitBlocks(blocks, maxChars) {
  const selected = [];
  let usedChars = 0;
  for (const block of blocks) {
    const formatted = formatBlock(block);
    const separatorChars = selected.length > 0 ? 2 : 0;
    if (usedChars + separatorChars + formatted.length > maxChars) {
      if (selected.length === 0) return formatted.slice(0, maxChars);
      break;
    }
    selected.push(formatted);
    usedChars += separatorChars + formatted.length;
  }
  return selected.join("\n\n");
}

function formatBlock(block) {
  return `[第 ${Number(block.position) + 1} 段] ${block.text}`;
}
