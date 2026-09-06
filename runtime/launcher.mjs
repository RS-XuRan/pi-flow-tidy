#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { locatePiRoot } from "../lib/paths.mjs";
import { createUniversalTidy } from "./universal-tidy.mjs";

const RUNTIME_SYMBOL = Symbol.for("pi.flowTidy.runtime");

function moduleUrl(path) {
  return pathToFileURL(path).href;
}

async function firstReadable(paths) {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      continue;
    }
  }
  throw new Error(`Required module not found. Tried: ${paths.join(", ")}`);
}

async function start() {
  const piRoot = await locatePiRoot();
  const mainPath = join(piRoot, "dist", "main.js");
  const setupPath = join(piRoot, "dist", "cli", "setup.js");
  const sessionPath = join(piRoot, "dist", "core", "agent-session.js");
  const interactivePath = join(piRoot, "dist", "modes", "interactive", "interactive-mode.js");
  const tuiPath = await firstReadable([
    join(piRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js"),
    resolve(piRoot, "..", "pi-tui", "dist", "index.js"),
  ]);

  const [{ main }, { setupCli }, { AgentSession }, { InteractiveMode }, tui] = await Promise.all([
    import(moduleUrl(mainPath)),
    import(moduleUrl(setupPath)),
    import(moduleUrl(sessionPath)),
    import(moduleUrl(interactivePath)),
    import(moduleUrl(tuiPath)),
  ]);

  const flowTidy = createUniversalTidy({
    truncateToWidth: tui.truncateToWidth,
    visibleWidth: tui.visibleWidth,
  });
  globalThis[RUNTIME_SYMBOL] = flowTidy;

  const enabled = process.env.PI_FLOW_TIDY !== "0";
  const agentSessionInstalled = enabled ? flowTidy.installAgentSessionPatch(AgentSession) : false;
  const interactiveModeInstalled = enabled ? flowTidy.installInteractiveModePatch(InteractiveMode) : false;
  const installed = agentSessionInstalled && interactiveModeInstalled;
  process.env.PI_FLOW_TIDY_ACTIVE = enabled && installed ? "1" : "0";
  if (enabled && !installed) {
    const status = flowTidy.getStatus();
    console.warn(`[pi-flow-tidy] Disabled: ${status.patchFailure ?? "unsupported Pi internals"}`);
  }

  setupCli();
  await main(process.argv.slice(2));
}

start().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[pi-flow-tidy] Startup failed: ${message}`);
  process.exitCode = 1;
});
