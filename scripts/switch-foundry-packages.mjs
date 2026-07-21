import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(appDirectory, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const mode = process.argv[2];
const skipInstall = process.argv.includes("--no-install");
const foundryDependencies = Object.keys(packageJson.dependencies ?? {}).filter(
  (name) => name.startsWith("@foundry/"),
);
const config = packageJson.foundryPackages ?? {};
const foundryModulesDirectory = resolve(appDirectory, "node_modules", "@foundry");

function dependencyMode(specifier) {
  return specifier.startsWith("file:") ? "local" : "github";
}

function runNpm(args, env = process.env) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
        cwd: appDirectory,
        env,
        stdio: "inherit",
      })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
        cwd: appDirectory,
        env,
        stdio: "inherit",
      });

  if (result.error) {
    console.error(`Unable to start npm: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveGithubPackagesToken() {
  if (process.env.NODE_AUTH_TOKEN) {
    return { token: process.env.NODE_AUTH_TOKEN, source: "NODE_AUTH_TOKEN" };
  }

  const gh = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
  });

  if (gh.error) {
    if (gh.error.code === "ENOENT") {
      return {
        token: null,
        error:
          "NODE_AUTH_TOKEN is not set and the GitHub CLI (gh) was not found. Install gh, run `gh auth login`, or export NODE_AUTH_TOKEN.",
      };
    }
    return {
      token: null,
      error: `NODE_AUTH_TOKEN is not set and gh failed to start: ${gh.error.message}`,
    };
  }

  if (gh.status !== 0) {
    const detail = (gh.stderr || gh.stdout || "").trim();
    return {
      token: null,
      error: `NODE_AUTH_TOKEN is not set and \`gh auth token\` failed${
        detail ? `: ${detail}` : ". Run `gh auth login` or export NODE_AUTH_TOKEN."
      }`,
    };
  }

  const token = gh.stdout.trim();
  if (!token) {
    return {
      token: null,
      error:
        "NODE_AUTH_TOKEN is not set and `gh auth token` returned an empty token. Run `gh auth login` or export NODE_AUTH_TOKEN.",
    };
  }

  return { token, source: "gh auth token" };
}

function installedTarget(name) {
  const packageDirectory = resolve(foundryModulesDirectory, name.slice("@foundry/".length));
  if (!existsSync(packageDirectory)) {
    return "missing";
  }

  try {
    if (lstatSync(packageDirectory).isSymbolicLink()) {
      return `symlink -> ${readlinkSync(packageDirectory)}`;
    }
  } catch {
    // Fall through to realpath-style reporting.
  }

  return "node_modules package";
}

function printStatus() {
  const modes = new Set(
    foundryDependencies.map((name) =>
      dependencyMode(packageJson.dependencies[name]),
    ),
  );
  const currentMode = modes.size === 1 ? [...modes][0] : "mixed";
  console.log(`Foundry package mode: ${currentMode}`);
  for (const name of foundryDependencies) {
    console.log(
      `  ${name}: ${packageJson.dependencies[name]} (${installedTarget(name)})`,
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

if (mode === "status") {
  printStatus();
  process.exit(0);
}

if (!["local", "github"].includes(mode)) {
  console.error(
    "Usage: node scripts/switch-foundry-packages.mjs <local|github|status> [--no-install]",
  );
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

if (mode === "github" && !config.githubVersion) {
  console.error("Set foundryPackages.githubVersion in package.json.");
  process.exit(1);
}

for (const name of foundryDependencies) {
  const packageDirectoryName = name.slice("@foundry/".length);

  if (mode === "local") {
    const localPackageDirectory = resolve(
      appDirectory,
      config.localDirectory,
      packageDirectoryName,
    );
    if (!existsSync(resolve(localPackageDirectory, "package.json"))) {
      console.error(`Local package not found: ${localPackageDirectory}`);
      process.exit(1);
    }
    packageJson.dependencies[name] =
      `file:${config.localDirectory}/${packageDirectoryName}`;
  } else {
    packageJson.dependencies[name] =
      config.githubVersions?.[name] ?? config.githubVersion;
  }
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Switched @foundry/* dependencies to ${mode}.`);

if (skipInstall) {
  console.log(
    "Skipped npm install; package-lock.json and node_modules are unchanged.",
  );
  process.exit(0);
}

const installEnv = { ...process.env };

if (mode === "github") {
  const auth = resolveGithubPackagesToken();
  if (!auth.token) {
    console.error(auth.error);
    process.exit(1);
  }
  installEnv.NODE_AUTH_TOKEN = auth.token;
  if (auth.source === "gh auth token") {
    console.log("Using GitHub Packages token from `gh auth token`.");
  }
}

// Plain `npm install` keeps stale file: lock entries and local symlinks.
// Clear @foundry installs, then reinstall explicitly so the lockfile updates.
clearInstalledFoundryPackages();

if (mode === "github") {
  const specs = foundryDependencies.map(
    (name) => `${name}@${packageJson.dependencies[name]}`,
  );
  runNpm(["install", ...specs], installEnv);
} else {
  runNpm(["install"], installEnv);
}

printStatus();
process.exit(0);
