import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCitationIds,
  validateAnswerCitations
} from "../src/lib/answerCitations.js";

test("keeps real source citations and removes invented source ids", () => {
  const validated = validateAnswerCitations(
    "真实判断 [cite:B2]，错误判断 [cite:B99]。",
    [{ id: "B2", blockId: 2 }]
  );

  assert.equal(validated.answer, "真实判断 [cite:B2]，错误判断 。");
  assert.deepEqual(validated.citedSourceIds, ["B2"]);
  assert.equal(validated.invalidCitationCount, 1);
  assert.deepEqual(extractCitationIds(validated.answer), ["B2"]);
});
