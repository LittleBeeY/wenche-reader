import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextBundle,
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
    "[source:B1 position=1 type=paragraph]\nFirst block gives background.\n\n[source:B2 position=2 type=paragraph]\nSecond block contains the core concept.\n\n[source:B3 position=3 type=paragraph]\nThird block expands the argument."
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

test("builds a heading-bounded section with stable source ids", () => {
  const bundle = buildContextBundle({
    blocks: [
      { id: 1, position: 0, type: "heading", text: "第一章", html: "<h1>第一章</h1>" },
      { id: 2, position: 1, type: "paragraph", text: "第一章正文" },
      { id: 3, position: 2, type: "heading", text: "第二章", html: "<h1>第二章</h1>" },
      { id: 4, position: 3, type: "paragraph", text: "第二章正文" }
    ],
    selection: { blockIds: [2], pageIndex: 0 },
    scope: "section",
    maxChars: 1000
  });

  assert.deepEqual(bundle.blockIds, [1, 2]);
  assert.match(bundle.text, /section="第一章"/);
  assert.doesNotMatch(bundle.text, /第二章/);
  assert.equal(bundle.sources[1].id, "B2");
  assert.equal(bundle.sources[1].pageIndex, 0);
});

test("prioritizes externally ranked document blocks while preserving reading order", () => {
  const blocks = Array.from({ length: 8 }, (_value, index) => ({
    id: index + 1,
    position: index,
    type: index === 4 ? "heading" : "paragraph",
    text: `Block ${index + 1} ${"content ".repeat(8)}`,
    html: index === 4 ? "<h2>Target</h2>" : ""
  }));
  const bundle = buildContextBundle({
    blocks,
    scope: "document",
    question: "target",
    searchBlockIds: [7],
    maxChars: 300
  });

  assert.ok(bundle.blockIds.includes(7));
  assert.deepEqual(bundle.blockIds, [...bundle.blockIds].sort((a, b) => a - b));
});
