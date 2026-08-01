const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,blockquote,pre,table,ul,ol";

export function assignBlockIdsByText(root, blocks = []) {
  if (!root) return 0;
  const allElements = [...root.querySelectorAll(BLOCK_SELECTOR)];
  const elementSet = new Set(allElements);
  const elements = allElements.filter((element) => {
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (elementSet.has(parent)) return false;
    }
    return true;
  });
  const orderedBlocks = [...blocks].sort(
    (left, right) => Number(left.position) - Number(right.position)
  );
  const usedIds = new Set();
  let cursor = 0;
  let assigned = 0;

  for (const element of elements) {
    const elementText = normalizeAnchorText(element.textContent);
    if (!elementText) continue;
    let matchIndex = findMatchingBlock(orderedBlocks, elementText, cursor, usedIds);
    if (matchIndex < 0) {
      matchIndex = findMatchingBlock(orderedBlocks, elementText, 0, usedIds);
    }
    if (matchIndex < 0) continue;
    const block = orderedBlocks[matchIndex];
    element.dataset.blockId = String(block.id);
    element.dataset.blockPosition = String(block.position);
    usedIds.add(Number(block.id));
    cursor = matchIndex + 1;
    assigned += 1;
  }
  return assigned;
}

export function buildRangeAnchors(range, root) {
  if (!range || !root) return [];
  const ownerDocument = root.ownerDocument || document;
  const RangeType = ownerDocument.defaultView?.Range || {
    START_TO_START: 0,
    END_TO_END: 2
  };
  const elements = [...root.querySelectorAll("[data-block-id]")].filter((element) => {
    try {
      return range.intersectsNode(element);
    } catch {
      return false;
    }
  });

  return elements.flatMap((element) => {
    const blockRange = ownerDocument.createRange();
    blockRange.selectNodeContents(element);
    const part = range.cloneRange();
    if (part.compareBoundaryPoints(RangeType.START_TO_START, blockRange) < 0) {
      part.setStart(blockRange.startContainer, blockRange.startOffset);
    }
    if (part.compareBoundaryPoints(RangeType.END_TO_END, blockRange) > 0) {
      part.setEnd(blockRange.endContainer, blockRange.endOffset);
    }

    const selectedText = normalizeAnchorText(part.toString());
    if (!selectedText) return [];
    const prefixRange = ownerDocument.createRange();
    prefixRange.selectNodeContents(element);
    prefixRange.setEnd(part.startContainer, part.startOffset);
    const fullText = normalizeAnchorText(element.textContent);
    const expectedOffset = normalizeAnchorText(prefixRange.toString()).length;
    const startOffset = nearestTextOffset(fullText, selectedText, expectedOffset);
    if (startOffset < 0) return [];
    return [{
      blockId: Number(element.dataset.blockId),
      startOffset,
      endOffset: Math.min(fullText.length, startOffset + selectedText.length)
    }];
  });
}

export function findBlockIdsByText(blocks, selectedText) {
  const excerpt = normalizeAnchorText(selectedText);
  if (!excerpt) return [];
  return (blocks || [])
    .filter((block) => {
      const blockText = normalizeAnchorText(block.text);
      return blockText.includes(excerpt) || excerpt.includes(blockText);
    })
    .map((block) => Number(block.id));
}

export function normalizeAnchorText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findMatchingBlock(blocks, elementText, startIndex, usedIds) {
  let partialMatch = -1;
  for (let index = startIndex; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (usedIds.has(Number(block.id))) continue;
    const blockText = normalizeAnchorText(block.text);
    if (blockText === elementText) return index;
    if (
      partialMatch < 0 &&
      Math.min(blockText.length, elementText.length) >= 8 &&
      (blockText.includes(elementText) || elementText.includes(blockText))
    ) {
      partialMatch = index;
    }
  }
  return partialMatch;
}

function nearestTextOffset(fullText, selectedText, expectedOffset) {
  let bestOffset = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let offset = fullText.indexOf(selectedText);
  while (offset >= 0) {
    const distance = Math.abs(offset - expectedOffset);
    if (distance < bestDistance) {
      bestOffset = offset;
      bestDistance = distance;
    }
    offset = fullText.indexOf(selectedText, offset + 1);
  }
  return bestOffset;
}
