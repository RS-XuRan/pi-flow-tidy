import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CONFIG_FILE,
  GIT_SOURCE,
  PACKAGE_NAME,
  REPOSITORY,
  getAgentDir,
  getConfigPath,
  getDefaultBinDir,
  locatePiRoot,
  resolveExecutablePackageRoot,
  settingsHasPackage,
} from "./paths.mjs";

const MANAGED_MARKER = "pi-flow-tidy managed wrapper";
const WRAPPER_NAMES = ["pi", "pi.cmd", "pi.ps1", "pi-raw", "pi-raw.cmd", "pi-raw.ps1"];

function timestamp() {
  const value = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\..+$/, "");
  return value;
}

async function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await copyFile(temporary, path);
  await rm(temporary, { force: true });
}

function runOfficialPi(piRoot, args, options = {}) {
  const cli = join(piRoot, "dist", "bundle", "cli.js");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`Pi command failed: pi ${args.join(" ")}${detail ? `\n${detail}` : ""}`);
  }
  if (options.echo === true && detail) process.stdout.write(`${detail}\n`);
  return result;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function windowsCmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function wrapperContents(launcherPath, rawCliPath) {
  return {
    pi: `#!/usr/bin/env sh\n# ${MANAGED_MARKER}\nexec node ${shellQuote(launcherPath)} "$@"\n`,
    "pi.cmd": `@echo off\nrem ${MANAGED_MARKER}\nnode ${windowsCmdQuote(launcherPath)} %*\nexit /b %errorlevel%\n`,
    "pi.ps1": `# ${MANAGED_MARKER}\n& node "${launcherPath.replace(/`/g, "``").replace(/"/g, '`"')}" @args\nexit $LASTEXITCODE\n`,
    "pi-raw": `#!/usr/bin/env sh\n# ${MANAGED_MARKER}\nexec node ${shellQuote(rawCliPath)} "$@"\n`,
    "pi-raw.cmd": `@echo off\nrem ${MANAGED_MARKER}\nnode ${windowsCmdQuote(rawCliPath)} %*\nexit /b %errorlevel%\n`,
    "pi-raw.ps1": `# ${MANAGED_MARKER}\n& node "${rawCliPath.replace(/`/g, "``").replace(/"/g, '`"')}" @args\nexit $LASTEXITCODE\n`,
  };
}

async function backupConflictingWrappers(binDir, agentDir, contents) {
  let backupDir;
  for (const name of WRAPPER_NAMES) {
    const path = join(binDir, name);
    if (!existsSync(path)) continue;
    const current = await readFile(path, "utf8").catch(() => "");
    if (current === contents[name] || current.includes(MANAGED_MARKER)) continue;
    backupDir ||= join(agentDir, "backups", `${PACKAGE_NAME}-${timestamp()}`);
    await mkdir(backupDir, { recursive: true });
    await copyFile(path, join(backupDir, name));
  }
  return backupDir;
}

async function writeWrappers(binDir, launcherPath, rawCliPath, agentDir) {
  const contents = wrapperContents(launcherPath, rawCliPath);
  await mkdir(binDir, { recursive: true });
  const backupDir = await backupConflictingWrappers(binDir, agentDir, contents);
  for (const [name, content] of Object.entries(contents)) {
    const path = join(binDir, name);
    await writeFile(path, content, "utf8");
    if (!name.endsWith(".cmd") && !name.endsWith(".ps1")) await chmod(path, 0o755);
  }
  return backupDir;
}

function ensureWindowsUserPath(binDir) {
  const script = [
    "$target=$env:PI_FLOW_TIDY_BIN_DIR",
    "$value=[Environment]::GetEnvironmentVariable('Path','User')",
    "$parts=@($value -split ';' | Where-Object { $_ })",
    "$exists=$parts | Where-Object { $_.TrimEnd('\\') -ieq $target.TrimEnd('\\') }",
    "if (-not $exists) { [Environment]::SetEnvironmentVariable('Path',(@($target)+$parts -join ';'),'User') }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, PI_FLOW_TIDY_BIN_DIR: binDir },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not update the Windows user PATH: ${(result.stderr || result.stdout || "").trim()}`);
}

async function ensureUnixUserPath(binDir) {
  const pathParts = (process.env.PATH || "").split(":").filter(Boolean);
  if (pathParts.includes(binDir)) return undefined;
  const profile = process.platform === "darwin" ? join(homedir(), ".zprofile") : join(homedir(), ".profile");
  const marker = "# pi-flow-tidy PATH";
  const existing = await readFile(profile, "utf8").catch(() => "");
  if (!existing.includes(marker)) {
    const relative = binDir === join(homedir(), ".local", "bin") ? "$HOME/.local/bin" : binDir;
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(profile, `${existing}${prefix}${marker}\nexport PATH="${relative}:$PATH"\n`, "utf8");
  }
  return profile;
}

async function loadSettings(agentDir) {
  return readJson(join(agentDir, "settings.json"), { packages: [] });
}

async function ensurePiPackage(piRoot, agentDir, options = {}) {
  const settings = await loadSettings(agentDir);
  if (options.ensureSelf !== false && !settingsHasPackage(settings, PACKAGE_NAME)) {
    runOfficialPi(piRoot, ["install", GIT_SOURCE]);
  }
  if (options.update === true) runOfficialPi(piRoot, ["update", "--extension", GIT_SOURCE]);
}

export async function getInstallStatus(options = {}) {
  const agentDir = options.agentDir || getAgentDir();
  const binDir = options.binDir || getDefaultBinDir();
  const config = await readJson(getConfigPath(agentDir));
  const wrappers = Object.fromEntries(await Promise.all(WRAPPER_NAMES.map(async (name) => {
    const path = join(binDir, name);
    const managed = existsSync(path) && (await readFile(path, "utf8").catch(() => "")).includes(MANAGED_MARKER);
    return [name, { path, present: existsSync(path), managed }];
  })));
  return {
    active: process.env.PI_FLOW_TIDY_ACTIVE === "1",
    configured: Boolean(config),
    config,
    agentDir,
    binDir,
    wrappers,
  };
}

export async function installFlowTidy(options = {}) {
  const currentPackageRoot = options.packageRoot;
  if (!currentPackageRoot) throw new Error("packageRoot is required");
  const agentDir = options.agentDir || getAgentDir();
  const binDir = options.binDir || getDefaultBinDir();
  const piRoot = await locatePiRoot({ agentDir, piRoot: options.piRoot });

  await ensurePiPackage(piRoot, agentDir, {
    ensureSelf: options.ensurePackage !== false,
    update: options.update,
  });
  const packageRoot = resolveExecutablePackageRoot(currentPackageRoot, agentDir);
  const launcherPath = join(packageRoot, "runtime", "launcher.mjs");
  const rawCliPath = join(piRoot, "dist", "bundle", "cli.js");
  if (!existsSync(launcherPath)) throw new Error(`Launcher not found: ${launcherPath}`);

  const backupDir = await writeWrappers(binDir, launcherPath, rawCliPath, agentDir);
  let profile;
  const modifyPath = options.modifyPath !== false && process.env.PI_FLOW_TIDY_SKIP_PATH !== "1";
  if (modifyPath) {
    if (process.platform === "win32") ensureWindowsUserPath(binDir);
    else profile = await ensureUnixUserPath(binDir);
  }

  const config = {
    version: 1,
    package: PACKAGE_NAME,
    repository: REPOSITORY,
    installedAt: new Date().toISOString(),
    packageRoot,
    piRoot,
    binDir,
  };
  await mkdir(agentDir, { recursive: true });
  await writeJsonAtomic(getConfigPath(agentDir), config);
  return { ...config, backupDir, profile };
}

export async function uninstallFlowTidy(options = {}) {
  const agentDir = options.agentDir || getAgentDir();
  const binDir = options.binDir || getDefaultBinDir();
  const piRoot = await locatePiRoot({ agentDir, piRoot: options.piRoot }).catch(() => undefined);
  const removed = [];
  const preserved = [];

  for (const name of WRAPPER_NAMES) {
    const path = join(binDir, name);
    if (!existsSync(path)) continue;
    const content = await readFile(path, "utf8").catch(() => "");
    if (!content.includes(MANAGED_MARKER)) {
      preserved.push(path);
      continue;
    }
    await rm(path, { force: true });
    removed.push(path);
  }
  await rm(getConfigPath(agentDir), { force: true });

  if (options.removePackage === true && piRoot) {
    const settings = await loadSettings(agentDir);
    if (settingsHasPackage(settings, PACKAGE_NAME)) runOfficialPi(piRoot, ["remove", GIT_SOURCE]);
  }
  return { removed, preserved, configFile: CONFIG_FILE };
}
