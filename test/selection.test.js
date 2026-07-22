import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDocumentContext,
  buildSelectionContext
} from "../src/lib/selectionContext.js";

test("builds context around selected blocks in document order", () => {
  const context = buildSelectionContext({
    blocks: [
      { id: 1, position: 0, text: "First block gives background." },
      { id: 2, position: 1, text: "Second block contains the core concept." },
      { id: 3, position: 2, text: "Third block expands the argument." }
    ],
    selection: {
      text: "core concept",
      blockIds: [2]
    },
    radius: 1
  });

  assert.equal(
    context,
    "[第 1 段] First block gives background.\n\n[第 2 段] Second block contains the core concept.\n\n[第 3 段] Third block expands the argument."
  );
});

test("falls back to selected text when block ids are missing", () => {
  const context = buildSelectionContext({
    blocks: [{ id: 1, position: 0, text: "Body" }],
    selection: {
      text: "manual selection",
      blockIds: []
    }
  });

  assert.equal(context, "manual selection");
});

test("builds bounded document context around blocks relevant to a question", () => {
  const blocks = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    position: index,
    text:
      index === 12
        ? "光合作用把光能转化为化学能，是植物获取能量的关键过程。"
        : `这是第 ${index + 1} 段不相关的背景材料。`.repeat(8)
  }));

  const context = buildDocumentContext({
    blocks,
    question: "文章如何解释光合作用和能量转化？",
    maxChars: 500
  });

  assert.match(context, /光合作用把光能转化为化学能/);
  assert.ok(context.length <= 500);
});
