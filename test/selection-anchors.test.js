import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  assignBlockIdsByText,
  buildRangeAnchors
} from "../public/selectionAnchors.js";

test("maps rendered paragraphs to stable blocks and anchors repeated selected text", () => {
  const dom = new JSDOM("<main><p>alpha beta alpha</p><p>second paragraph</p></main>");
  const { document } = dom.window;
  const root = document.querySelector("main");
  assignBlockIdsByText(root, [
    { id: 11, position: 0, text: "alpha beta alpha" },
    { id: 12, position: 1, text: "second paragraph" }
  ]);

  const textNode = root.querySelector("p").firstChild;
  const range = document.createRange();
  range.setStart(textNode, 11);
  range.setEnd(textNode, 16);

  assert.deepEqual(buildRangeAnchors(range, root), [
    { blockId: 11, startOffset: 11, endOffset: 16 }
  ]);
  dom.window.close();
});

test("creates one anchor per block for a cross-paragraph selection", () => {
  const dom = new JSDOM("<main><p>first paragraph</p><p>second paragraph</p></main>");
  const { document } = dom.window;
  const root = document.querySelector("main");
  assignBlockIdsByText(root, [
    { id: 21, position: 0, text: "first paragraph" },
    { id: 22, position: 1, text: "second paragraph" }
  ]);

  const paragraphs = root.querySelectorAll("p");
  const range = document.createRange();
  range.setStart(paragraphs[0].firstChild, 6);
  range.setEnd(paragraphs[1].firstChild, 6);

  assert.deepEqual(buildRangeAnchors(range, root), [
    { blockId: 21, startOffset: 6, endOffset: 15 },
    { blockId: 22, startOffset: 0, endOffset: 6 }
  ]);
  dom.window.close();
});
