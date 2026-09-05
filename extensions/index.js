import { getPackageRootFromModule } from "../lib/paths.mjs";
import { getInstallStatus, installFlowTidy, uninstallFlowTidy } from "../lib/install.mjs";

const RUNTIME_SYMBOL = Symbol.for("pi.flowTidy.runtime");
const COMPLETIONS = ["status", "install", "repair", "uninstall"];
const packageRoot = getPackageRootFromModule(import.meta.url);

function runtimeStatus() {
  return globalThis[RUNTIME_SYMBOL]?.getStatus?.();
}

export default function flowTidyExtension(pi) {
  pi.registerCommand("flow-tidy", {
    description: "Install, inspect, repair, or remove universal compact tool rendering",
    getArgumentCompletions(prefix) {
      return COMPLETIONS
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, context) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "install" || action === "repair") {
        try {
          const result = await installFlowTidy({
            packageRoot,
            ensurePackage: false,
          });
          const backup = result.backupDir ? ` Previous wrappers were backed up to ${result.backupDir}.` : "";
          const profile = result.profile ? ` Reload ${result.profile} or restart the terminal.` : " Restart the terminal if command lookup is unchanged.";
          context.ui.notify(`pi-flow-tidy is installed.${backup}${profile} Restart Pi to activate universal rendering.`, "info");
        } catch (error) {
          context.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      if (action === "uninstall") {
        try {
          const result = await uninstallFlowTidy({ removePackage: false });
          context.ui.notify(
            `Removed ${result.removed.length} managed wrappers. Restart the terminal, then run 'pi remove git:github.com/RS-XuRan/pi-flow-tidy' if you also want to remove the Pi package.`,
            "info",
          );
        } catch (error) {
          context.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      if (action !== "status") {
        context.ui.notify("Usage: /flow-tidy status|install|repair|uninstall", "warning");
        return;
      }

      const install = await getInstallStatus();
      const runtime = runtimeStatus();
      const active = install.active && runtime?.patchInstalled;
      const names = runtime?.decoratedNames?.length ? runtime.decoratedNames.join(", ") : "none yet";
      const failure = runtime?.patchFailure ? ` Failure: ${runtime.patchFailure}.` : "";
      context.ui.notify(
        `pi-flow-tidy is ${active ? "active" : install.configured ? "installed but inactive" : "not installed"}. Decorated ${runtime?.decoratedCount ?? 0} tools: ${names}.${failure}`,
        failure ? "warning" : "info",
      );
    },
  });

  pi.on("session_start", async (_event, context) => {
    const install = await getInstallStatus();
    if (!install.configured) {
      context.ui.notify("pi-flow-tidy package loaded. Run /flow-tidy install once, then restart Pi.", "info");
    }
  });
}
