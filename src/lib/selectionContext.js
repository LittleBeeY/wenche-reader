const VALID_SCOPES = new Set(["selection", "page", "section", "document"]);

export function buildContextBundle({
  blocks,
  selection = {},
  scope = "selection",
  question = "",
  radius = 2,
  maxChars = 12000,
  searchBlockIds = []
}) {
  const orderedBlocks = [...(blocks || [])].sort(
    (left, right) => Number(left.position) - Number(right.position)
  );
  if (orderedBlocks.length === 0 || maxChars <= 0) {
    return { text: selection?.text?.trim() || "", blockIds: [], sources: [] };
  }

  const normalizedScope = VALID_SCOPES.has(scope) ? scope : "selection";
  const selectedIds = collectSelectedBlockIds(selection);
  const indexById = new Map(
    orderedBlocks.map((block, index) => [Number(block.id), index])
  );
  const selectedIndexes = [...selectedIds]
    .map((id) => indexById.get(id))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);

  let candidateIndexes;
  if (normalizedScope === "document") {
    const fullContext = packBlocks({
      orderedBlocks,
      candidateIndexes: orderedBlocks.map((_block, index) => index),
      selectedIds,
      scope: normalizedScope,
      pageIndex: selection.pageIndex,
      maxChars
    });
    if (fullContext.blockIds.length === orderedBlocks.length) return fullContext;
    candidateIndexes = documentCandidateIndexes({
      orderedBlocks,
      question,
      searchBlockIds,
      indexById
    });
  } else if (normalizedScope === "section") {
    candidateIndexes = sectionIndexes(orderedBlocks, selectedIndexes);
  } else if (normalizedScope === "page") {
    candidateIndexes = selectedIndexes.length > 0
      ? selectedIndexes
      : orderedBlocks.map((_block, index) => index);
  } else {
    candidateIndexes = windowIndexes(
      orderedBlocks.length,
      selectedIndexes,
      Math.max(0, Number(radius) || 0)
    );
  }

  if (candidateIndexes.length === 0) {
    return { text: selection?.text?.trim() || "", blockIds: [], sources: [] };
  }

  return packBlocks({
    orderedBlocks,
    candidateIndexes,
    selectedIds,
    scope: normalizedScope,
    pageIndex: selection.pageIndex,
    maxChars
  });
}

export function buildSelectionContext({ blocks, selection, radius = 2, maxChars = 12000 }) {
  return buildContextBundle({
    blocks,
    selection,
    scope: "selection",
    radius,
    maxChars
  }).text;
}

export function buildDocumentContext({
  blocks,
  question = "",
  maxChars = 12000,
  searchBlockIds = []
}) {
  return buildContextBundle({
    blocks,
    selection: {},
    scope: "document",
    question,
    maxChars,
    searchBlockIds
  }).text;
}

function collectSelectedBlockIds(selection) {
  const ids = [
    ...(Array.isArray(selection?.blockIds) ? selection.blockIds : []),
    ...(Array.isArray(selection?.anchors)
      ? selection.anchors.map((anchor) => anchor?.blockId)
      : [])
  ];
  return new Set(
    ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
}

function windowIndexes(blockCount, selectedIndexes, radius) {
  if (selectedIndexes.length === 0) return [];
  const start = Math.max(0, selectedIndexes[0] - radius);
  const end = Math.min(blockCount - 1, selectedIndexes.at(-1) + radius);
  return Array.from({ length: end - start + 1 }, (_value, offset) => start + offset);
}

function sectionIndexes(orderedBlocks, selectedIndexes) {
  const anchorIndex = selectedIndexes[0] ?? 0;
  let headingIndex = -1;
  for (let index = anchorIndex; index >= 0; index -= 1) {
    if (orderedBlocks[index].type === "heading") {
      headingIndex = index;
      break;
    }
  }

  if (headingIndex < 0) {
    return windowIndexes(orderedBlocks.length, [anchorIndex], 4);
  }

  const headingLevel = getHeadingLevel(orderedBlocks[headingIndex]);
  let end = orderedBlocks.length - 1;
  for (let index = headingIndex + 1; index < orderedBlocks.length; index += 1) {
    if (
      orderedBlocks[index].type === "heading" &&
      getHeadingLevel(orderedBlocks[index]) <= headingLevel
    ) {
      end = index - 1;
      break;
    }
  }
  return Array.from(
    { length: end - headingIndex + 1 },
    (_value, offset) => headingIndex + offset
  );
}

function documentCandidateIndexes({
  orderedBlocks,
  question,
  searchBlockIds,
  indexById
}) {
  const rankedIndexes = [];
  for (const id of searchBlockIds || []) {
    const index = indexById.get(Number(id));
    if (Number.isInteger(index) && !rankedIndexes.includes(index)) {
      rankedIndexes.push(index);
    }
  }

  if (rankedIndexes.length === 0) {
    const terms = getSearchTerms(question);
    rankedIndexes.push(
      ...orderedBlocks
        .map((block, index) => ({
          index,
          score: scoreText(block.text, terms) + (block.type === "heading" ? 1 : 0)
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .filter((candidate, index) => candidate.score > 0 || index === 0)
        .map((candidate) => candidate.index)
    );
  }

  const candidates = [];
  for (const index of rankedIndexes) {
    const headingIndex = nearestHeadingIndex(orderedBlocks, index);
    for (const candidateIndex of [index, headingIndex, index - 1, index + 1]) {
      if (
        candidateIndex >= 0 &&
        candidateIndex < orderedBlocks.length &&
        !candidates.includes(candidateIndex)
      ) {
        candidates.push(candidateIndex);
      }
    }
  }
  for (const index of [0, orderedBlocks.length - 1]) {
    if (!candidates.includes(index)) candidates.push(index);
  }
  return candidates;
}

function packBlocks({
  orderedBlocks,
  candidateIndexes,
  selectedIds,
  scope,
  pageIndex,
  maxChars
}) {
  const headingPaths = buildHeadingPaths(orderedBlocks);
  const selected = [];
  let usedChars = 0;

  for (const index of candidateIndexes) {
    const block = orderedBlocks[index];
    if (!block) continue;
    const source = createSource({
      block,
      headingPath: headingPaths[index],
      pageIndex:
        Number.isInteger(pageIndex) &&
        (scope === "page" || selectedIds.has(Number(block.id)))
          ? pageIndex
          : null
    });
    let formatted = formatSource(source, block.text);
    const separatorChars = selected.length > 0 ? 2 : 0;
    if (usedChars + separatorChars + formatted.length > maxChars) {
      if (selected.length > 0) continue;
      const available = Math.max(0, maxChars - formatSource(source, "").length - 1);
      formatted = formatSource(source, String(block.text || "").slice(0, available));
    }
    selected.push({ index, source, formatted });
    usedChars += separatorChars + formatted.length;
  }

  selected.sort((left, right) => left.index - right.index);
  return {
    text: selected.map((item) => item.formatted).join("\n\n"),
    blockIds: selected.map((item) => item.source.blockId),
    sources: selected.map((item) => item.source)
  };
}

function createSource({ block, headingPath, pageIndex }) {
  return {
    id: `B${Number(block.id)}`,
    blockId: Number(block.id),
    position: Number(block.position) + 1,
    type: block.type || "paragraph",
    headingPath: headingPath || "",
    pageIndex
  };
}

function formatSource(source, text) {
  const section = source.headingPath
    ? ` section="${source.headingPath.replaceAll("\"", "'")}"`
    : "";
  return `[source:${source.id} position=${source.position} type=${source.type}${section}]\n${text}`;
}

function buildHeadingPaths(blocks) {
  const headings = [];
  return blocks.map((block) => {
    if (block.type === "heading") {
      const level = getHeadingLevel(block);
      headings.splice(level - 1);
      headings[level - 1] = block.text;
      return headings.filter(Boolean).join(" > ");
    }
    return headings.filter(Boolean).join(" > ");
  });
}

function getHeadingLevel(block) {
  const match = String(block.html || "").match(/^<h([1-6])\b/i);
  return match ? Number(match[1]) : 2;
}

function nearestHeadingIndex(blocks, startIndex) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (blocks[index]?.type === "heading") return index;
  }
  return -1;
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
