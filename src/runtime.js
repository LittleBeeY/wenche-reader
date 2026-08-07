import http from "node:http";
import { createAiProvider } from "./lib/aiProvider.js";
import { EnvAiSettingsStore } from "./lib/aiSettingsStore.js";
import { RssScheduler } from "./lib/rss/rssScheduler.js";
import { createApp } from "./server.js";

/**
 * 共同运行时启动入口：CLI 和 Electron utility process 都走这里。
 * 只有 listen 成功后才启动 RSS 调度器；close() 幂等且可重复调用。
 */
export async function startRuntime(options = {}) {
  const settingsStore =
    options.settingsStore ||
    new EnvAiSettingsStore({ envPath: options.envPath });
  const initialConfig = await settingsStore.read();
  const aiProvider =
    options.aiProvider || createAiProvider(initialConfig);
  const app = createApp({
    ...options,
    settingsStore,
    aiProvider
  });
  const storage = app.locals.storage;
  const server = http.createServer(app);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        options.port ?? 0,
        options.host || "127.0.0.1",
        () => {
          server.off("error", reject);
          resolve();
        }
      );
    });
  } catch (error) {
    storage.close();
    throw error;
  }

  const { port } = server.address();
  app.locals.port = port;

  const scheduler = new RssScheduler({ rssService: app.locals.rssService });
  scheduler.start();

  let closed = false;
  let closePromise = null;
  async function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (closed) return;
      closed = true;
      scheduler.stop();
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(resolve));
      storage.close();
    })();
    return closePromise;
  }

  return {
    app,
    server,
    storage,
    rssService: app.locals.rssService,
    scheduler,
    host: options.host || "127.0.0.1",
    port,
    origin: `http://127.0.0.1:${port}`,
    close
  };
}
