#!/usr/bin/env node

import { getPackageRootFromModule } from "../lib/paths.mjs";
import { getInstallStatus, installFlowTidy, uninstallFlowTidy } from "../lib/install.mjs";

const packageRoot = getPackageRootFromModule(import.meta.url);
const command = (process.argv[2] || "install").toLowerCase();

function printHelp() {
  console.log(`pi-flow-tidy

Usage:
  pi-flow-tidy install
  pi-flow-tidy repair
  pi-flow-tidy status
  pi-flow-tidy uninstall

Environment:
  PI_CODING_AGENT_DIR  Override the Pi agent directory
  PI_PACKAGE_ROOT        Override the Pi package root
  PI_FLOW_TIDY_BIN_DIR   Override the managed command directory
  PI_FLOW_TIDY_SKIP_PATH Set to 1 to avoid modifying shell or user PATH
  PI_FLOW_TIDY           Set to 0 to disable rendering for one invocation
`);
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "install" || command === "repair") {
    const result = await installFlowTidy({
      packageRoot,
      ensurePackage: true,
      update: command === "repair",
    });
    console.log(`Installed pi-flow-tidy from ${result.packageRoot}`);
    console.log(`Managed command directory: ${result.binDir}`);
    if (result.backupDir) console.log(`Previous wrappers backed up to: ${result.backupDir}`);
    if (result.profile) console.log(`Reload this profile or restart the terminal: ${result.profile}`);
    console.log("Restart the terminal, then run: pi");
    return;
  }
  if (command === "status") {
    const status = await getInstallStatus();
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (command === "uninstall") {
    const result = await uninstallFlowTidy({ removePackage: true });
    console.log(`Removed ${result.removed.length} managed wrappers.`);
    if (result.preserved.length) console.log(`Preserved non-managed files: ${result.preserved.join(", ")}`);
    console.log("Restart the terminal to restore the official Pi command.");
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`[pi-flow-tidy] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
