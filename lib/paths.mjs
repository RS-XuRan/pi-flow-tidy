import { access, readFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "pi-flow-tidy";
export const REPOSITORY = "RS-XuRan/pi-flow-tidy";
export const GIT_SOURCE = `git:github.com/${REPOSITORY}`;
export const CONFIG_FILE = "pi-flow-tidy.json";

export function getAgentDir() {
  return resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
}

export function getConfigPath(agentDir = getAgentDir()) {
  return join(agentDir, CONFIG_FILE);
}

export function getDefaultBinDir() {
  if (process.env.PI_FLOW_TIDY_BIN_DIR) return resolve(process.env.PI_FLOW_TIDY_BIN_DIR);
  if (process.platform === "win32") return join(homedir(), "bin");
  return join(homedir(), ".local", "bin");
}

export function getInstalledGitPackageRoot(agentDir = getAgentDir()) {
  return join(agentDir, "git", "github.com", "RS-XuRan", "pi-flow-tidy");
}

export function getPackageRootFromModule(metaUrl) {
  return resolve(dirname(fileURLToPath(metaUrl)), "..");
}

async function isPiRoot(path) {
  if (!path) return false;
  try {
    await Promise.all([
      access(join(path, "dist", "main.js"), constants.R_OK),
      access(join(path, "dist", "bundle", "cli.js"), constants.R_OK),
      access(join(path, "dist", "core", "agent-session.js"), constants.R_OK),
    ]);
    return true;
  } catch {
    return false;
  }
}

function npmGlobalRoot() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    return execFileSync(command, ["root", "--global"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function derivePiRootFromArgv() {
  const entry = process.argv[1];
  if (!entry) return "";
  const normalized = entry.replace(/\\/g, "/");
  const suffixes = ["/dist/bundle/cli.js", "/dist/cli.js", "/dist/main.js"];
  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix)) return entry.slice(0, entry.length - suffix.length);
  }
  return "";
}

export async function readInstallConfig(agentDir = getAgentDir()) {
  try {
    const value = JSON.parse(await readFile(getConfigPath(agentDir), "utf8"));
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function locatePiRoot(options = {}) {
  const agentDir = options.agentDir || getAgentDir();
  const config = await readInstallConfig(agentDir);
  const roaming = process.env.APPDATA
    || (process.env.USERPROFILE ? join(process.env.USERPROFILE, "AppData", "Roaming") : "");
  const candidates = [
    options.piRoot,
    process.env.PI_PACKAGE_ROOT,
    derivePiRootFromArgv(),
    config?.piRoot,
    roaming ? join(roaming, "npm", "node_modules", "@earendil-works", "pi-coding-agent") : "",
    npmGlobalRoot() ? join(npmGlobalRoot(), "@earendil-works", "pi-coding-agent") : "",
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates.map((value) => resolve(value)))]) {
    if (await isPiRoot(candidate)) return candidate;
  }
  throw new Error("Could not locate @earendil-works/pi-coding-agent. Set PI_PACKAGE_ROOT and retry.");
}

export function packageEntryIdentity(entry) {
  const source = typeof entry === "string" ? entry : entry?.source;
  if (typeof source !== "string") return "";
  if (source.startsWith("npm:")) {
    const spec = source.slice(4);
    if (spec.startsWith("@")) {
      const versionAt = spec.indexOf("@", spec.indexOf("/") + 1);
      return versionAt >= 0 ? spec.slice(0, versionAt) : spec;
    }
    const versionAt = spec.indexOf("@");
    return versionAt >= 0 ? spec.slice(0, versionAt) : spec;
  }
  if (source.includes("github.com/RS-XuRan/pi-flow-tidy")) return PACKAGE_NAME;
  return source;
}

export function settingsHasPackage(settings, identity) {
  const packages = Array.isArray(settings?.packages) ? settings.packages : [];
  return packages.some((entry) => packageEntryIdentity(entry) === identity);
}

export function resolveExecutablePackageRoot(currentPackageRoot, agentDir = getAgentDir()) {
  const installed = getInstalledGitPackageRoot(agentDir);
  return existsSync(join(installed, "runtime", "launcher.mjs")) ? installed : currentPackageRoot;
}
