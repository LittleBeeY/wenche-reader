export function paginateBlocks(blocks, options = {}) {
  const charsPerPage = options.charsPerPage || 2600;
  const pages = [];
  let currentBlocks = [];
  let currentChars = 0;

  for (const block of blocks) {
    const blockChars = block.text.length;
    const wouldOverflow = currentBlocks.length > 0 && currentChars + blockChars > charsPerPage;

    if (wouldOverflow) {
      pages.push(createPage(pages.length + 1, currentBlocks));
      currentBlocks = [];
      currentChars = 0;
    }

    currentBlocks.push(block);
    currentChars += blockChars;

    if (blockChars >= charsPerPage) {
      pages.push(createPage(pages.length + 1, currentBlocks));
      currentBlocks = [];
      currentChars = 0;
    }
  }

  if (currentBlocks.length > 0) {
    pages.push(createPage(pages.length + 1, currentBlocks));
  }

  return pages.length > 0 ? pages : [createPage(1, [])];
}

function createPage(number, blocks) {
  return {
    number,
    blocks,
    blockIds: blocks.map((block) => block.id)
  };
}
