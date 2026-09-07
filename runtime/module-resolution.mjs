import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TUI_PACKAGES = ["@earendil-works/pi-tui", "@mariozechner/pi-tui"];
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function isReadable(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFrom(parentPath, specifier) {
  try {
    return createRequire(parentPath).resolve(specifier);
  } catch {
    return undefined;
  }
}

function dependencyNames(manifest) {
  const dependencies = {
    ...manifest?.dependencies,
    ...manifest?.optionalDependencies,
    ...manifest?.peerDependencies,
  };
  return Object.keys(dependencies).filter((name) => name === "pi-tui" || name.endsWith("/pi-tui"));
}

export async function firstReadable(paths) {
  const candidates = [...new Set(paths.filter(Boolean))];
  for (const path of candidates) {
    if (await isReadable(path)) return path;
  }
  throw new Error(`Required module not found. Tried: ${candidates.join(", ")}`);
}

export async function resolvePiTuiPath(piRoot) {
  const physicalPiRoot = await realpath(piRoot).catch(() => piRoot);
  const roots = [...new Set([resolve(piRoot), resolve(physicalPiRoot)])];
  const manifests = await Promise.all(roots.map((root) => readJson(join(root, "package.json"))));
  const packageNames = [...new Set([
    ...manifests.flatMap(dependencyNames),
    ...DEFAULT_TUI_PACKAGES,
  ])];
  const resolvedEntries = [];

  for (const root of roots) {
    for (const parentPath of [join(root, "package.json"), join(root, "dist", "main.js")]) {
      for (const packageName of packageNames) {
        resolvedEntries.push(resolveFrom(parentPath, packageName));
      }
    }
  }

  const directEntries = [];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    const rootPackageDepth = typeof manifests[index]?.name === "string"
      ? manifests[index].name.split("/").length
      : 2;
    const installRoot = resolve(root, ...Array.from({ length: rootPackageDepth }, () => ".."));
    for (const packageName of packageNames) {
      const packageParts = packageName.split("/");
      directEntries.push(join(root, "node_modules", ...packageParts, "dist", "index.js"));
      directEntries.push(join(installRoot, ...packageParts, "dist", "index.js"));
    }
  }
  for (const packageName of packageNames) {
    directEntries.push(join(PACKAGE_ROOT, "node_modules", ...packageName.split("/"), "dist", "index.js"));
  }

  return firstReadable([...resolvedEntries, ...directEntries]);
}
