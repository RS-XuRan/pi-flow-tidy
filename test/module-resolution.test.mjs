import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePiTuiPath } from "../runtime/module-resolution.mjs";

test("resolves pi-tui from the physical package location", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-flow-tidy-modules-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const physicalPiRoot = join(root, "store", "pi-coding-agent");
  const logicalPiRoot = join(root, "prefix", "node_modules", "@earendil-works", "pi-coding-agent");
  const tuiRoot = join(root, "store", "node_modules", "@earendil-works", "pi-tui");
  const tuiEntry = join(tuiRoot, "lib", "entry.js");

  await mkdir(join(physicalPiRoot, "dist"), { recursive: true });
  await mkdir(join(logicalPiRoot, ".."), { recursive: true });
  await mkdir(join(tuiRoot, "lib"), { recursive: true });
  await writeFile(join(physicalPiRoot, "package.json"), JSON.stringify({
    name: "@earendil-works/pi-coding-agent",
    dependencies: { "@earendil-works/pi-tui": "*" },
  }));
  await writeFile(join(physicalPiRoot, "dist", "main.js"), "export const main = true;\n");
  await writeFile(join(tuiRoot, "package.json"), JSON.stringify({
    name: "@earendil-works/pi-tui",
    type: "module",
    exports: "./lib/entry.js",
  }));
  await writeFile(tuiEntry, "export const visibleWidth = () => 0;\n");
  await symlink(physicalPiRoot, logicalPiRoot, process.platform === "win32" ? "junction" : "dir");

  assert.equal(existsSync(join(logicalPiRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js")), false);
  assert.equal(existsSync(join(logicalPiRoot, "..", "pi-tui", "dist", "index.js")), false);

  const resolved = await resolvePiTuiPath(logicalPiRoot);
  assert.equal(await realpath(resolved), await realpath(tuiEntry));
});
