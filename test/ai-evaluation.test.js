import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateAnswerCitations } from "../src/lib/answerCitations.js";
import { buildContextBundle } from "../src/lib/selectionContext.js";
import { Storage } from "../src/lib/storage.js";
const AI_RETRIEVAL_CASES = JSON.parse(
  await readFile(new URL("./fixtures/ai-evaluation-cases.json", import.meta.url), "utf8")
);

test("AI core retrieval evaluation keeps every expected source in the context budget", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "wenche-ai-eval-"));
  const storage = new Storage({ dataDir });
  t.after(async () => {
    storage.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  let hits = 0;
  for (const evaluation of AI_RETRIEVAL_CASES) {
    const document = storage.createDocument({
      title: evaluation.name,
      originalName: `${evaluation.name}.txt`,
      mimeType: "text/plain",
      filePath: path.join(dataDir, `${evaluation.name}.txt`),
      blocks: evaluation.blocks.map((block) => ({ ...block, id: undefined }))
    });
    const expectedPosition = evaluation.blocks.find(
      (block) => block.id === evaluation.expectedBlockId
    ).position;
    const expectedStoredId = document.blocks.find(
      (block) => block.position === expectedPosition
    ).id;
    const searchBlockIds = storage.searchDocumentBlocks(
      document.id,
      evaluation.question,
      8
    );
    const bundle = buildContextBundle({
      blocks: document.blocks,
      scope: "document",
      question: evaluation.question,
      searchBlockIds,
      maxChars: 1200
    });
    assert.ok(bundle.text.length <= 1200, `${evaluation.name} exceeded its context budget`);
    if (bundle.blockIds.includes(expectedStoredId)) hits += 1;
  }

  assert.equal(hits / AI_RETRIEVAL_CASES.length, 1);
});

test("AI core citation evaluation rejects unsupported source ids", () => {
  const result = validateAnswerCitations(
    "有依据的结论 [cite:B3]。无依据的结论 [cite:B999]。",
    [{ id: "B3", blockId: 3, position: 3 }]
  );

  assert.deepEqual(result.citedSourceIds, ["B3"]);
  assert.equal(result.invalidCitationCount, 1);
  assert.doesNotMatch(result.answer, /B999/);
});
