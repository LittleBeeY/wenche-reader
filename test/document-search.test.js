import assert from "node:assert/strict";
import test from "node:test";
import { findDocumentMatches } from "../public/documentSearch.js";

test("finds document text matches in page and block order", () => {
  const pages = [
    { blocks: [{ id: 1, text: "Alpha beta alpha" }] },
    { blocks: [{ id: 2, text: "No match" }, { id: 3, text: "ALPHA end" }] }
  ];

  assert.deepEqual(findDocumentMatches(pages, "alpha"), [
    { pageIndex: 0, blockId: 1, start: 0, length: 5 },
    { pageIndex: 0, blockId: 1, start: 11, length: 5 },
    { pageIndex: 1, blockId: 3, start: 0, length: 5 }
  ]);
  assert.deepEqual(findDocumentMatches(pages, "  "), []);
});
