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

test("accepts a JSON answer from an older server process", async () => {
  const events = [];
  const response = new Response(JSON.stringify({ answer: "兼容回答", recordId: 9 }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });

  const result = await consumeEventStream(response, (event, payload) => {
    events.push([event, payload.answer]);
  });

  assert.equal(result.answer, "兼容回答");
  assert.deepEqual(events, [["done", "兼容回答"]]);
});

test("uses a readable Chinese message when a stream ends early", async () => {
  const response = new Response('event: delta\ndata: {"delta":"未完成"}\n\n');
  await assert.rejects(() => consumeEventStream(response), /AI 回答连接提前结束，请重试/);
});
