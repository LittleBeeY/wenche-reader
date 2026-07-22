import assert from "node:assert/strict";
import test from "node:test";
import { consumeEventStream } from "../public/aiStream.js";

test("consumes split SSE chunks and returns the completed AI result", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: delta\ndata: {"delta":"第一"}\n'));
      controller.enqueue(encoder.encode('\nevent: delta\ndata: {"delta":"段"}\n\n'));
      controller.enqueue(encoder.encode('event: done\ndata: {"answer":"第一段","recordId":7}\n\n'));
      controller.close();
    }
  }));
  const deltas = [];
  const result = await consumeEventStream(response, (event, payload) => {
    if (event === "delta") deltas.push(payload.delta);
  });

  assert.deepEqual(deltas, ["第一", "段"]);
  assert.equal(result.answer, "第一段");
  assert.equal(result.recordId, 7);
});

test("surfaces streamed provider errors", async () => {
  const response = new Response('event: error\ndata: {"error":"provider failed"}\n\n');
  await assert.rejects(() => consumeEventStream(response), /provider failed/);
});
