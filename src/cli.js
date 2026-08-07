import path from "node:path";
import { fileURLToPath } from "node:url";
import { EnvAiSettingsStore } from "./lib/aiSettingsStore.js";
import { APP_INFO } from "./lib/appInfo.js";
import { loadEnvFile } from "./lib/env.js";
import { startRuntime } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

let runtime = null;
let exiting = false;

async function shutdown(signal) {
  if (exiting) return;
  exiting = true;
  console.log(`\n[wenche] received ${signal}, shutting down...`);
  try {
    if (runtime) await runtime.close();
  } catch (error) {
    console.error(`[wenche] shutdown error: ${error.message}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await loadEnvFile(path.join(projectRoot, ".env"));
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  runtime = await startRuntime({
    host,
    port,
    dataDir: path.join(projectRoot, "data"),
    uploadDir: path.join(projectRoot, "uploads"),
    settingsStore: new EnvAiSettingsStore({
      envPath: path.join(projectRoot, ".env")
    })
  });
  console.log(
    `${APP_INFO.name} V${APP_INFO.version} running at ${runtime.origin}`
  );
} catch (error) {
  console.error(`[wenche] failed to start: ${error.message}`);
  if (runtime) {
    try {
      await runtime.close();
    } catch {}
  }
  process.exit(1);
}
