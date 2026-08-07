import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Storage } from "../src/lib/storage.js";
import { startRuntime } from "../src/runtime.js";

const mockStore = {
  read: async () => ({ provider: "mock", apiKey: "", baseUrl: "", model: "" })
};

async function startTestRuntime(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-runtime-"));
  const runtime = await startRuntime({
    port: 0,
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    ...options
  });
  t.after(async () => {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  return runtime;
}

test("starts on an ephemeral port and serves health", async (t) => {
  const runtime = await startTestRuntime(t, { settingsStore: mockStore });

  assert.ok(runtime.port > 0);
  assert.equal(runtime.origin, `http://127.0.0.1:${runtime.port}`);
  const response = await fetch(`${runtime.origin}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");

  await runtime.close();
  await runtime.close();
});

test("starts the RSS scheduler only after listen succeeds", async (t) => {
  const runtime = await startTestRuntime(t, { settingsStore: mockStore });
  assert.ok(runtime.scheduler.timer || runtime.scheduler.startupTimer);
});

test("close() stops the scheduler before closing storage", async (t) => {
  const runtime = await startTestRuntime(t, { settingsStore: mockStore });
  const order = [];
  const originalStop = runtime.scheduler.stop.bind(runtime.scheduler);
  runtime.scheduler.stop = () => {
    order.push("scheduler");
    originalStop();
  };
  const originalClose = runtime.storage.close.bind(runtime.storage);
  runtime.storage.close = () => {
    order.push("storage");
    originalClose();
  };
  await runtime.close();
  assert.deepEqual(order, ["scheduler", "storage"]);
});

test("closes storage when listen fails", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "wenche-runtime-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const port = blocker.address().port;
  const dataDir = path.join(root, "data");
  const storage = new Storage({ dataDir });
  let closed = false;
  const originalClose = storage.close.bind(storage);
  storage.close = () => {
    closed = true;
    originalClose();
  };

  await assert.rejects(
    () =>
      startRuntime({
        host: "127.0.0.1",
        port,
        dataDir,
        storage,
        settingsStore: mockStore
      }),
    (error) => error.code === "EADDRINUSE"
  );
  assert.equal(closed, true);
  await new Promise((resolve) => blocker.close(resolve));
});

test("creates the AI provider from the settings store", async (t) => {
  const runtime = await startTestRuntime(t, {
    settingsStore: {
      read: async () => ({
        provider: "deepseek",
        apiKey: "secret",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat"
      })
    }
  });
  const status = await (
    await fetch(`${runtime.origin}/api/ai/status`)
  ).json();
  assert.equal(status.provider, "deepseek");
  assert.equal(status.configured, true);
});

test("keeps the current provider when the store write fails", async (t) => {
  const runtime = await startTestRuntime(t, {
    settingsStore: {
      read: async () => ({
        provider: "mock",
        apiKey: "",
        baseUrl: "",
        model: ""
      }),
      write: async () => {
        throw new Error("write-failed");
      }
    }
  });

  const response = await fetch(`${runtime.origin}/api/ai/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "k" })
  });
  assert.equal(response.status, 500);
  const status = await (
    await fetch(`${runtime.origin}/api/ai/status`)
  ).json();
  assert.equal(status.provider, "mock");
});
