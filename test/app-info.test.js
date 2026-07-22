import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_INFO } from "../src/lib/appInfo.js";

test("keeps application identity aligned with package metadata", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(APP_INFO.name, "文澈阅读");
  assert.equal(APP_INFO.fullName, "文澈AI深度阅读系统");
  assert.equal(APP_INFO.version, packageJson.version);
  assert.equal(packageJson.name, "wenche-reader");
});
