import assert from "node:assert/strict";
import test from "node:test";
import { paginateBlocks } from "../public/pagination.js";

test("paginates long documents by character budget", () => {
  const blocks = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    type: index === 0 ? "heading" : "paragraph",
    text: index === 0 ? "Title" : "x".repeat(90)
  }));

  const pages = paginateBlocks(blocks, { charsPerPage: 180 });

  assert.equal(pages.length, 3);
  assert.deepEqual(
    pages.map((page) => page.blocks.map((block) => block.id)),
    [[1, 2], [3, 4], [5, 6]]
  );
  assert.deepEqual(
    pages.map((page) => page.number),
    [1, 2, 3]
  );
});

test("keeps a single oversized block readable on its own page", () => {
  const pages = paginateBlocks(
    [
      { id: 1, type: "paragraph", text: "short" },
      { id: 2, type: "paragraph", text: "x".repeat(500) },
      { id: 3, type: "paragraph", text: "tail" }
    ],
    { charsPerPage: 120 }
  );

  assert.deepEqual(
    pages.map((page) => page.blocks.map((block) => block.id)),
    [[1], [2], [3]]
  );
});
