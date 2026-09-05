import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInstallStatus, installFlowTidy, uninstallFlowTidy } from "../lib/install.mjs";
import { packageEntryIdentity, settingsHasPackage } from "../lib/paths.mjs";

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-flow-tidy-"));
  const agentDir = join(root, "agent");
  const binDir = join(root, "bin");
  const piRoot = join(root, "pi");
  const packageRoot = join(root, "package");
  await mkdir(join(piRoot, "dist", "bundle"), { recursive: true });
  await mkdir(join(piRoot, "dist", "core"), { recursive: true });
  await mkdir(join(packageRoot, "runtime"), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(join(piRoot, "dist", "main.js"), "export async function main() {}\n");
  await writeFile(join(piRoot, "dist", "bundle", "cli.js"), "\n");
  await writeFile(join(piRoot, "dist", "core", "agent-session.js"), "export class AgentSession {}\n");
  await writeFile(join(packageRoot, "runtime", "launcher.mjs"), "\n");
  return { root, agentDir, binDir, piRoot, packageRoot };
}

test("parses npm and git package identities", () => {
  assert.equal(packageEntryIdentity("npm:@example/search-tool@1.2.3"), "@example/search-tool");
  assert.equal(packageEntryIdentity("npm:example-tool@2.8.7"), "example-tool");
  assert.equal(packageEntryIdentity("git:github.com/RS-XuRan/pi-flow-tidy"), "pi-flow-tidy");
  assert.equal(settingsHasPackage({ packages: ["npm:@example/search-tool"] }, "@example/search-tool"), true);
});

test("installs, backs up, reports, and removes managed wrappers", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(join(fixture.binDir, "pi.cmd"), "@echo existing\n", "utf8");

  const installed = await installFlowTidy({
    packageRoot: fixture.packageRoot,
    agentDir: fixture.agentDir,
    binDir: fixture.binDir,
    piRoot: fixture.piRoot,
    ensurePackage: false,
    modifyPath: false,
  });

  assert.equal(installed.packageRoot, fixture.packageRoot);
  assert.ok(installed.backupDir);
  assert.equal(await readFile(join(installed.backupDir, "pi.cmd"), "utf8"), "@echo existing\n");
  assert.match(await readFile(join(fixture.binDir, "pi.cmd"), "utf8"), /pi-flow-tidy managed wrapper/);
  assert.match(await readFile(join(fixture.binDir, "pi"), "utf8"), /runtime[\\/]launcher\.mjs/);

  const status = await getInstallStatus({ agentDir: fixture.agentDir, binDir: fixture.binDir });
  assert.equal(status.configured, true);
  assert.equal(status.wrappers["pi.cmd"].managed, true);

  await writeFile(join(fixture.binDir, "pi.ps1"), "Write-Output custom\n", "utf8");
  const removed = await uninstallFlowTidy({
    agentDir: fixture.agentDir,
    binDir: fixture.binDir,
    piRoot: fixture.piRoot,
    removePackage: false,
  });
  assert.ok(removed.removed.some((path) => path.endsWith("pi.cmd")));
  assert.ok(removed.preserved.some((path) => path.endsWith("pi.ps1")));
  assert.equal(existsSync(join(fixture.binDir, "pi.cmd")), false);
  assert.equal(existsSync(join(fixture.binDir, "pi.ps1")), true);
  assert.equal(existsSync(join(fixture.agentDir, "pi-flow-tidy.json")), false);
});
