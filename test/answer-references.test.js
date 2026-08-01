import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAnswerCitations,
  resolveAnswerReferences
} from "../public/answerReferences.js";

test("resolves page and paragraph markers to clickable document locations", () => {
  const references = resolveAnswerReferences(
    {
      answer: "结论来自原文 [第 3 段]，并在下一页继续 [第 2 页]。",
      context: "[第 2 页]\n\n[第 3 段] Source paragraph"
    },
    [{ id: 13, position: 2, text: "Source paragraph" }],
    [
      { blockIds: [11, 12], blocks: [] },
      { blockIds: [13], blocks: [{ text: "Source paragraph" }] }
    ]
  );

  assert.deepEqual(references.map(({ label, pageIndex, blockId }) => ({ label, pageIndex, blockId })), [
    { label: "第 3 段 · 第 2 页", pageIndex: 1, blockId: 13 },
    { label: "第 2 页", pageIndex: 1, blockId: null }
  ]);
});

test("ignores location markers that are absent from the source context", () => {
  const references = resolveAnswerReferences(
    {
      answer: "这个结论位于 [第 99 页]。",
      context: "[第 1 页]\n\n[第 1 段] Actual source"
    },
    [{ id: 1, position: 0, text: "Actual source" }],
    [{ blockIds: [1], blocks: [{ text: "Actual source" }] }]
  );

  assert.deepEqual(references, []);
});

test("resolves validated source citations by stable block id", () => {
  const record = {
    answer: "这个判断来自来源 [cite:B13]。",
    contextSources: [
      { id: "B13", blockId: 13, position: 3, pageIndex: 1 }
    ]
  };
  const references = resolveAnswerReferences(
    record,
    [{ id: 13, position: 2, text: "Source paragraph" }],
    [{ blockIds: [] }, { blockIds: [13] }]
  );

  assert.deepEqual(
    references.map(({ label, pageIndex, blockId }) => ({ label, pageIndex, blockId })),
    [{ label: "第 3 段 · 第 2 页", pageIndex: 1, blockId: 13 }]
  );
  assert.equal(
    formatAnswerCitations(record.answer, record.contextSources),
    "这个判断来自来源 〔原文 3〕。"
  );
});
