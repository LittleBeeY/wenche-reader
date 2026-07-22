import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

const root = await mkdtemp(path.join(tmpdir(), "wenche-e2e-"));
const app = createApp({
  dataDir: path.join(root, "data"),
  uploadDir: path.join(root, "uploads"),
  aiProviderConfig: { provider: "mock" }
});
const server = app.listen(4173, "127.0.0.1", () => {
  console.log("Wenche E2E server running at http://127.0.0.1:4173");
});

async function close() {
  await new Promise((resolve) => server.close(resolve));
  app.locals.storage.close();
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
