#!/usr/bin/env node
/**
 * Cross-platform file operations for package build scripts.
 *
 * The build scripts used to shell out to `rm -rf`, `mkdir -p`, `cp`, `ls`,
 * `tail` and `xargs`. Those are fine on Linux and macOS and absent on Windows,
 * where npm and pnpm run scripts through `cmd.exe`: every one of them failed
 * with "The syntax of the command is incorrect", and a Windows contributor had
 * to run every build under Git Bash to get anywhere.
 *
 * Node is already a hard requirement for this repo, so the operations live here
 * instead of pulling in a dependency. Each subcommand mirrors the POSIX tool it
 * replaces, and nothing here is interactive or destructive beyond the paths it
 * is given.
 *
 *   node scripts/fsx.mjs rm <paths...>            recursive, force
 *   node scripts/fsx.mjs mkdir <dirs...>          recursive
 *   node scripts/fsx.mjs cp <src...> <dest>       recursive, force
 *   node scripts/fsx.mjs chmod [+x] <paths...>    mark executable (no-op on Windows)
 *   node scripts/fsx.mjs latest <dir> <glob> <n>  stale matches, one per line
 *   node scripts/fsx.mjs prune <dir> <glob> <n>   delete them, keep newest n
 *
 * `latest` and `prune` exist for the migration snapshot prune, which used
 * `ls | sort -r | tail -n +6 | xargs rm -f` — three POSIX tools plus an `xargs`
 * whose empty-input behaviour differs between GNU and BSD.
 */
import { chmod, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const [, , command, ...args] = process.argv;

function fail(message) {
  process.stderr.write(`fsx: ${message}\n`);
  process.exit(1);
}

/** Turn a glob with `*` and `?` into a RegExp, matching POSIX shell semantics. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);
}

async function rmCommand(paths) {
  if (paths.length === 0) fail("rm needs at least one path");
  for (const target of paths) await rm(target, { recursive: true, force: true });
}

async function mkdirCommand(dirs) {
  if (dirs.length === 0) fail("mkdir needs at least one directory");
  for (const dir of dirs) await mkdir(dir, { recursive: true });
}

async function cpCommand(operands) {
  if (operands.length < 2) fail("cp needs a source and a destination");
  const dest = operands[operands.length - 1];
  const sources = operands.slice(0, -1);
  for (const source of sources) {
    // Copying a directory into an existing directory means "into", matching
    // `cp -R src/. dist/`. Copying it to a new name means "as".
    const into = sources.length > 1 || (await isDirectory(dest));
    const target = into ? path.join(dest, path.basename(source)) : dest;
    await cp(source, target, { recursive: true, force: true });
  }
}

/**
 * Mark files executable.
 *
 * A no-op on Windows, where the executable bit does not exist and `chmod` is
 * not a command at all — the CLI build would otherwise fail there over a
 * permission change that has no meaning on that platform.
 */
async function chmodCommand(operands) {
  const targets = operands.filter((operand) => !operand.startsWith("+") && !operand.startsWith("-"));
  if (targets.length === 0) fail("chmod needs at least one path");
  if (process.platform === "win32") return;
  for (const target of targets) await chmod(target, 0o755);
}

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function latestCommand([dir, glob, count]) {
  const doomed = await staleMatches(dir, glob, count);
  // A trailing newline so a shell substitution feeds the next command cleanly,
  // and nothing at all when the list is empty rather than a blank line.
  if (doomed.length > 0) process.stdout.write(`${doomed.join("\n")}\n`);
}

/** The matches a keep-count leaves behind, oldest first. */
async function staleMatches(dir, glob, count) {
  if (!dir || !glob || !count) fail("expected a directory, a glob and a keep count");
  const limit = Number.parseInt(count, 10);
  if (!Number.isInteger(limit) || limit < 0)
    fail(`keep count must be a number, got "${count}"`);
  const pattern = globToRegExp(glob);
  const matches = (await readdir(dir)).filter((entry) => pattern.test(entry)).sort().reverse();
  return matches.slice(limit).map((entry) => path.join(dir, entry));
}

/**
 * Delete all but the newest `count` matches.
 *
 * The migration prune used `ls | sort -r | tail -n +6 | xargs rm -f`, which
 * needed three POSIX tools and an `xargs` whose empty-input behaviour differs
 * between GNU and BSD. Keeping the whole operation here removes both problems.
 */
async function pruneCommand([dir, glob, count]) {
  const doomed = await staleMatches(dir, glob, count);
  for (const target of doomed) await rm(target, { recursive: true, force: true });
}

switch (command) {
  case "rm":
    await rmCommand(args);
    break;
  case "mkdir":
    await mkdirCommand(args);
    break;
  case "cp":
    await cpCommand(args);
    break;
  case "chmod":
    await chmodCommand(args);
    break;
  case "latest":
    await latestCommand(args);
    break;
  case "prune":
    await pruneCommand(args);
    break;
  default:
    fail(`unknown command "${command ?? ""}" — expected rm, mkdir, cp, chmod, latest or prune`);
}
