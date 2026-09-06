import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url);

test("declares a standard Pi package and CLI", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(packageJson.name, "pi-flow-tidy");
  assert.equal(packageJson.version, "0.3.1");
  assert.ok(packageJson.keywords.includes("pi-package"));
  assert.deepEqual(packageJson.pi.extensions, ["./extensions/index.js"]);
  assert.equal(packageJson.bin["pi-flow-tidy"], "./bin/pi-flow-tidy.mjs");
  assert.ok(packageJson.files.includes("install.ps1"));
  assert.ok(packageJson.files.includes("install.sh"));
  for (const path of [packageJson.pi.extensions[0], packageJson.bin["pi-flow-tidy"], "install.ps1", "install.sh"]) {
    assert.ok((await readFile(new URL(path, root))).length > 0);
  }
});
