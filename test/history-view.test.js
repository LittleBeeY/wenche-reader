import assert from "node:assert/strict";
import test from "node:test";
import { formatAnswerMeta, getVisibleRecords } from "../public/historyView.js";

test("shows only the most recent answer records", () => {
  const records = Array.from({ length: 6 }, (_, index) => ({ id: index + 1 }));

  assert.deepEqual(
    getVisibleRecords(records, 3).map((record) => record.id),
    [1, 2, 3]
  );
});

test("truncates long selected text in answer metadata", () => {
  const meta = formatAnswerMeta({
    provider: "mock",
    selectedText: "x".repeat(120)
  });

  assert.equal(meta.length <= 100, true);
  assert.match(meta, /^mock · /);
  assert.match(meta, /...$/);
});
