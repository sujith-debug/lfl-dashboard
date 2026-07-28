#!/usr/bin/env node
/**
 * Switch @foundry/* dependency sources:
 *   local   — file:../../foundry-npm/packages/<name>
 *   release — download specific .tgz assets from GitHub Releases via `gh`
 *   status  — show current mode
 *
 * Release versions come only from foundryPackages.packageVersions:
 *   {
 *     "@foundry/bigquery": "0.0.2",
 *     "logger": "0.0.1"
 *   }
 *
 * Downloads only the listed packages (plus any auto-resolved @foundry/*
 * transitive deps), not every asset on each release.
 *
 * No private npm registry. Release flow lives in foundry-npm (.github/workflows/release.yml).
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(appDirectory, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const mode = process.argv[2] === "github" ? "release" : process.argv[2];
const skipInstall = process.argv.includes("--no-install");
const foundryDependencies = Object.keys(packageJson.dependencies ?? {}).filter(
  (name) => name.startsWith("@foundry/")
);
const config = packageJson.foundryPackages ?? {};
const foundryModulesDirectory = resolve(
  appDirectory,
  "node_modules",
  "@foundry"
);
const releaseCacheDirectory = resolve(
  appDirectory,
  config.releaseCacheDirectory ?? ".foundry-release"
);
const packageVersions =
  config.packageVersions && typeof config.packageVersions === "object"
    ? config.packageVersions
    : {};

function dependencyMode(specifier) {
  if (specifier.startsWith("file:")) {
    return specifier.includes(".foundry-release") ||
      specifier.endsWith(".tgz")
      ? "release"
      : "local";
  }
  return "other";
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: appDirectory,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Unable to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNpm(args, env = process.env) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    run(process.execPath, [npmCli, ...args], env);
  } else {
    run(process.platform === "win32" ? "npm.cmd" : "npm", args, env);
  }
}

function versionFromTag(tag) {
  return tag.replace(/^v/, "");
}

function resolveReleaseRepo() {
  const repo = config.releaseRepo;
  if (!repo) {
    console.error(
      'Set foundryPackages.releaseRepo in package.json (e.g. "GIVA-Jewellery/foundry-npm").'
    );
    process.exit(1);
  }
  return repo;
}

function normalizePackageVersionKey(name) {
  if (name.startsWith("@foundry/")) {
    return name;
  }
  return `@foundry/${name}`;
}

function lookupPackageVersion(name) {
  const short = name.slice("@foundry/".length);
  const raw =
    packageVersions[name] ??
    packageVersions[short] ??
    packageVersions[normalizePackageVersionKey(name)];
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  return String(raw).trim();
}

function setPackageVersion(name, version) {
  const short = name.slice("@foundry/".length);
  if (Object.prototype.hasOwnProperty.call(packageVersions, name)) {
    packageVersions[name] = version;
  } else if (Object.prototype.hasOwnProperty.call(packageVersions, short)) {
    packageVersions[short] = version;
  } else {
    packageVersions[name] = version;
  }
  packageJson.foundryPackages = {
    ...config,
    packageVersions,
  };
  delete packageJson.foundryPackages.releaseTag;
}

/**
 * Resolve versions only from packageVersions (no releaseTag).
 * Every @foundry/* dependency must be listed.
 */
function resolvePackageVersions() {
  if (Object.keys(packageVersions).length === 0) {
    console.error(
      'Set foundryPackages.packageVersions in package.json, e.g. { "@foundry/logger": "0.0.2" }.'
    );
    process.exit(1);
  }

  const missing = foundryDependencies.filter(
    (name) => !lookupPackageVersion(name)
  );
  if (missing.length > 0) {
    console.error(
      "Every @foundry/* dependency needs a version in foundryPackages.packageVersions.\nMissing:\n" +
        missing.map((name) => `  ${name}`).join("\n")
    );
    process.exit(1);
  }

  /** @type {Map<string, string>} packageName -> version (no leading v) */
  const versions = new Map();

  for (const name of foundryDependencies) {
    versions.set(name, versionFromTag(lookupPackageVersion(name)));
  }

  return versions;
}

function tagDownloadCandidates(ref) {
  const tag = ref.trim();
  const version = versionFromTag(tag);
  const candidates = [tag];
  if (tag !== `v${version}`) {
    candidates.push(`v${version}`);
  }
  if (tag !== version) {
    candidates.push(version);
  }
  return [...new Set(candidates)];
}

function tarballName(packageName, version) {
  // npm pack names @foundry/logger@0.1.0 -> foundry-logger-0.1.0.tgz
  const unscoped = packageName.replace(/^@/, "").replace("/", "-");
  return `${unscoped}-${version}.tgz`;
}

function releaseFileSpecifier(packageName, version) {
  const rel = `${config.releaseCacheDirectory ?? ".foundry-release"}/${tarballName(packageName, version)}`;
  return `file:${rel}`;
}

function readTarballPackageJson(tgzPath) {
  const result = spawnSync("tar", ["-xOf", tgzPath, "package/package.json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`Unable to read package.json from ${tgzPath}`);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout);
}

function exactFoundryDeps(manifest) {
  /** @type {Map<string, string>} */
  const deps = new Map();
  for (const section of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = manifest[section] ?? {};
    for (const [name, range] of Object.entries(block)) {
      if (!name.startsWith("@foundry/")) continue;
      const version = versionFromTag(String(range).trim());
      if (!/^\d+\.\d+\.\d+/.test(version)) {
        console.error(
          `${manifest.name} depends on ${name}@${range}; expected an exact version.`
        );
        process.exit(1);
      }
      deps.set(name, version);
    }
  }
  return deps;
}

function ensureGhAvailable(result) {
  if (result.error?.code === "ENOENT") {
    console.error(
      "GitHub CLI (gh) is required for foundry:release. Install gh and run `gh auth login`."
    );
    process.exit(1);
  }
}

function downloadOnePackageAsset(repo, tag, pattern, destDir) {
  const result = spawnSync(
    "gh",
    [
      "release",
      "download",
      tag,
      "--repo",
      repo,
      "--dir",
      destDir,
      "--pattern",
      pattern,
      "--clobber",
    ],
    { cwd: appDirectory, stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" }
  );
  ensureGhAvailable(result);
  return result.status === 0;
}

/**
 * Download only the specific package tarball for name@version.
 */
function ensurePackageTarball(repo, packageName, version) {
  const tgz = tarballName(packageName, version);
  const tgzPath = resolve(releaseCacheDirectory, tgz);
  if (existsSync(tgzPath)) {
    return;
  }

  mkdirSync(releaseCacheDirectory, { recursive: true });
  const candidates = tagDownloadCandidates(version);
  for (const candidate of candidates) {
    console.log(`Downloading ${packageName}@${version} from ${repo}@${candidate}…`);
    if (downloadOnePackageAsset(repo, candidate, tgz, releaseCacheDirectory)) {
      if (existsSync(tgzPath)) {
        return;
      }
    }
  }

  console.error(
    `Failed to download ${tgz} from ${repo} (tried tags: ${candidates.join(", ")}).`
  );
  process.exit(1);
}

function resetReleaseCache() {
  if (existsSync(releaseCacheDirectory)) {
    rmSync(releaseCacheDirectory, { recursive: true, force: true });
  }
  mkdirSync(releaseCacheDirectory, { recursive: true });
}

/**
 * Download only the package tarballs listed in `versions`.
 */
function downloadPackageTarballs(repo, versions) {
  for (const [name, version] of versions) {
    ensurePackageTarball(repo, name, version);
  }
  const files = readdirSync(releaseCacheDirectory).filter((f) =>
    f.endsWith(".tgz")
  );
  console.log(
    `Cached ${files.length} package tarball(s) in ${releaseCacheDirectory}`
  );
}

/**
 * Ensure each selected package can resolve its @foundry/* deps from local tarballs.
 *
 * packageVersions pins stay as the app-level versions. When a package needs a
 * *different* version of an @foundry dep than the pin (e.g. bigquery@0.0.1 wants
 * logger@0.0.1 while the app pins logger@0.0.2), download that extra tarball and
 * nest it via npm overrides so both versions can coexist.
 */
function resolveTransitiveFoundryVersions(repo, versions) {
  /** @type {Map<string, Map<string, string>>} parent -> (dep -> version) */
  const nestedDepVersions = new Map();

  let changed = true;
  let passes = 0;
  while (changed && passes < 20) {
    changed = false;
    passes += 1;

    for (const name of [...versions.keys()]) {
      const version = versions.get(name);
      const tgzPath = resolve(
        releaseCacheDirectory,
        tarballName(name, version)
      );
      if (!existsSync(tgzPath)) {
        console.error(
          `Missing ${tarballName(name, version)} while resolving deps.`
        );
        process.exit(1);
      }

      const required = exactFoundryDeps(readTarballPackageJson(tgzPath));
      for (const [depName, requiredVersion] of required) {
        const pinned = versions.get(depName);

        if (pinned == null) {
          console.log(
            `Adding transitive ${depName}@${requiredVersion} (required by ${name}@${version})`
          );
          ensurePackageTarball(repo, depName, requiredVersion);
          versions.set(depName, requiredVersion);
          setPackageVersion(depName, requiredVersion);
          if (!packageJson.dependencies[depName]) {
            packageJson.dependencies[depName] = releaseFileSpecifier(
              depName,
              requiredVersion
            );
            foundryDependencies.push(depName);
          }
          changed = true;
          continue;
        }

        if (pinned === requiredVersion) {
          continue;
        }

        // App pin differs from what this package needs — nest the required version.
        ensurePackageTarball(repo, depName, requiredVersion);
        if (!nestedDepVersions.has(name)) {
          nestedDepVersions.set(name, new Map());
        }
        const nested = nestedDepVersions.get(name);
        if (nested.get(depName) === requiredVersion) {
          continue;
        }
        nested.set(depName, requiredVersion);
        console.log(
          `Nesting ${depName}@${requiredVersion} under ${name}@${version} ` +
            `(app pin is ${depName}@${pinned})`
        );
        changed = true;
      }
    }
  }

  // Rebuild @foundry overrides. Use nested form when a package needs a
  // different transitive version than the app pin.
  const overrides = { ...(packageJson.overrides ?? {}) };
  for (const name of Object.keys(overrides)) {
    if (name.startsWith("@foundry/")) {
      delete overrides[name];
    }
  }

  for (const name of versions.keys()) {
    const nested = nestedDepVersions.get(name);
    const selfSpec = releaseFileSpecifier(name, versions.get(name));
    if (nested && nested.size > 0) {
      const nestedOverride = { ".": selfSpec };
      for (const [depName, depVersion] of nested) {
        nestedOverride[depName] = releaseFileSpecifier(depName, depVersion);
      }
      overrides[name] = nestedOverride;
    } else {
      overrides[name] = selfSpec;
    }
  }

  packageJson.overrides = overrides;
}

function clearFoundryOverrides() {
  if (!packageJson.overrides) return;
  let changed = false;
  for (const name of Object.keys(packageJson.overrides)) {
    if (name.startsWith("@foundry/")) {
      delete packageJson.overrides[name];
      changed = true;
    }
  }
  if (changed && Object.keys(packageJson.overrides).length === 0) {
    delete packageJson.overrides;
  }
}

function installedTarget(name) {
  const packageDirectory = resolve(
    foundryModulesDirectory,
    name.slice("@foundry/".length)
  );
  if (!existsSync(packageDirectory)) {
    return "missing";
  }

  try {
    if (lstatSync(packageDirectory).isSymbolicLink()) {
      return `symlink -> ${readlinkSync(packageDirectory)}`;
    }
  } catch {
    // ignore
  }

  return "node_modules package";
}

function printStatus() {
  const modes = new Set(
    foundryDependencies.map((name) =>
      dependencyMode(packageJson.dependencies[name])
    )
  );
  const currentMode = modes.size === 1 ? [...modes][0] : "mixed";
  console.log(`Foundry package mode: ${currentMode}`);
  if (config.releaseRepo) {
    console.log(`  releaseRepo: ${config.releaseRepo}`);
  }
  if (Object.keys(packageVersions).length > 0) {
    console.log("  packageVersions:");
    for (const [key, value] of Object.entries(packageVersions)) {
      console.log(`    ${key}: ${value}`);
    }
  }
  for (const name of foundryDependencies) {
    console.log(
      `  ${name}: ${packageJson.dependencies[name]} (${installedTarget(name)})`
    );
  }
}

function clearInstalledFoundryPackages() {
  if (!existsSync(foundryModulesDirectory)) {
    return;
  }
  rmSync(foundryModulesDirectory, { recursive: true, force: true });
  console.log("Removed stale node_modules/@foundry links/packages.");
}

function stripReleaseTag() {
  if (packageJson.foundryPackages?.releaseTag != null) {
    delete packageJson.foundryPackages.releaseTag;
  }
}

if (mode === "status") {
  printStatus();
  process.exit(0);
}

if (!["local", "release"].includes(mode)) {
  console.error(
    "Usage: node scripts/switch-foundry-packages.mjs <local|release|status> [--no-install]"
  );
  console.error("  (github is accepted as an alias for release)");
  process.exit(1);
}

if (foundryDependencies.length === 0) {
  console.error("No @foundry/* dependencies found in package.json.");
  process.exit(1);
}

if (mode === "local" && !config.localDirectory) {
  console.error("Set foundryPackages.localDirectory in package.json.");
  process.exit(1);
}

/** @type {Map<string, string> | null} */
let packageVersionMap = null;

if (mode === "release") {
  const releaseRepo = resolveReleaseRepo();
  packageVersionMap = resolvePackageVersions();
  resetReleaseCache();
  downloadPackageTarballs(releaseRepo, packageVersionMap);
  resolveTransitiveFoundryVersions(releaseRepo, packageVersionMap);
  stripReleaseTag();
} else {
  clearFoundryOverrides();
  stripReleaseTag();
}

for (const name of foundryDependencies) {
  const packageDirectoryName = name.slice("@foundry/".length);

  if (mode === "local") {
    const localPackageDirectory = resolve(
      appDirectory,
      config.localDirectory,
      packageDirectoryName
    );
    if (!existsSync(resolve(localPackageDirectory, "package.json"))) {
      console.error(`Local package not found: ${localPackageDirectory}`);
      process.exit(1);
    }
    packageJson.dependencies[name] =
      `file:${config.localDirectory}/${packageDirectoryName}`;
  } else {
    const version = packageVersionMap.get(name);
    const tgz = tarballName(name, version);
    const tgzPath = resolve(releaseCacheDirectory, tgz);
    if (!existsSync(tgzPath)) {
      console.error(
        `Missing release asset ${tgz} for ${name}@${version}. Check the GitHub Release assets.`
      );
      process.exit(1);
    }
    packageJson.dependencies[name] = releaseFileSpecifier(name, version);
  }
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Switched @foundry/* dependencies to ${mode}.`);

if (skipInstall) {
  console.log(
    "Skipped npm install; package-lock.json and node_modules are unchanged."
  );
  process.exit(0);
}

clearInstalledFoundryPackages();
runNpm(["install"]);
printStatus();
process.exit(0);
