import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_INFO } from "../src/lib/appInfo.js";

test("keeps the desktop version aligned with package metadata", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(APP_INFO.version, packageJson.version);
  assert.equal(packageJson.main, "desktop/main.js");
  assert.equal(packageJson.productName, "文澈阅读");
  assert.equal(packageJson.devDependencies.electron, "43.3.0");
  assert.equal(packageJson.version, "1.1.0");
});
