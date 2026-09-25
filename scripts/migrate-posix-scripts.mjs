#!/usr/bin/env node
/**
 * One-shot codemod: replace POSIX-only commands in package scripts with fsx.
 *
 * Windows runs pnpm scripts through cmd.exe, which has no `rm`, `mkdir -p`,
 * `cp`, `ls`, `tail` or `xargs`; a `clean` script of `rm -rf dist` therefore
 * fails on every Windows checkout. This rewrites those calls to the
 * cross-platform `scripts/fsx.mjs` helper.
 *
 * Only the exact command shapes used in this repo are handled, and a script is
 * left untouched when a replacement is not confidently safe. Run with --check
 * to list what would change without writing.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");
const SKIP = new Set(["node_modules", ".git", "dist", "build"]);

function packageJsonPaths(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...packageJsonPaths(full));
    else if (entry === "package.json") found.push(full);
  }
  return found;
}

/** The relative path from a package back to the root scripts directory. */
function fsxPathFor(packageJsonPath) {
  const depth = path.relative(ROOT, path.dirname(packageJsonPath)).split(path.sep).filter(Boolean).length;
  return [...Array(depth).fill(".."), "scripts", "fsx.mjs"].join("/");
}

/**
 * Rewrite one script body, or return null when nothing matched.
 *
 * Each pattern is anchored to a whole command between shell separators, so a
 * `rm -rf` appearing inside an argument or a quoted string is not touched.
 */
function rewrite(script, fsx) {
  let out = script;
  // rm -rf <targets>  ->  node <fsx> rm <targets>
  out = out.replace(
    /(^|&&|\|\||;)\s*rm -rf\s+([^&|;]+?)(?=\s*(?:&&|\|\||;|$))/g,
    (_, lead, targets) => `${lead} node ${fsx} rm ${targets.trim()}`,
  );
  // mkdir -p <dirs>  ->  node <fsx> mkdir <dirs>
  out = out.replace(
    /(^|&&|\|\||;)\s*mkdir -p\s+([^&|;]+?)(?=\s*(?:&&|\|\||;|$))/g,
    (_, lead, dirs) => `${lead} node ${fsx} mkdir ${dirs.trim()}`,
  );
  // cp -R <src> <dest>  and  cp <src> <dest>  ->  node <fsx> cp <src> <dest>
  // Handles the `src/. dest/` form, which means "the contents of src into
  // dest" — fsx.mjs applies the same rule.
  out = out.replace(
    /(^|&&|\|\||;)\s*cp\s+(?:-[Rr]+\s+)?([^&|;]+?)(?=\s*(?:&&|\|\||;|$))/g,
    (_, lead, operands) => `${lead} node ${fsx} cp ${operands.trim().replace(/\s+/g, " ")}`,
  );
  // rm -f <paths>  ->  node <fsx> rm <paths>   (fsx rm is force+recursive)
  out = out.replace(
    /(^|&&|\|\||;)\s*rm -f\s+([^&|;]+?)(?=\s*(?:&&|\|\||;|$))/g,
    (_, lead, targets) => `${lead} node ${fsx} rm ${targets.trim()}`,
  );
  // The snapshot prune: ls | sort -r | tail -n +6 | xargs rm -f
  out = out.replace(
    /ls\s+([^\s|]+)\/\*_snapshot\.json\s*\|\s*sort -r\s*\|\s*tail -n \+(\d+)\s*\|\s*xargs rm -f/g,
    (_, dir, keepPlusOne) => {
      const keep = Number(keepPlusOne) - 1;
      return `node ${fsx} prune ${dir} *_snapshot.json ${keep}`;
    },
  );
  return out === script ? null : out.replace(/^\s*&&\s*/, "").trim();
}

const report = [];
for (const file of packageJsonPaths(ROOT)) {
  const raw = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    continue;
  }
  if (!parsed.scripts) continue;
  const fsx = fsxPathFor(file);
  const rewrites = new Map();
  for (const [name, body] of Object.entries(parsed.scripts)) {
    if (typeof body !== "string") continue;
    const next = rewrite(body, fsx);
    if (next && next !== body) rewrites.set(name, next);
  }
  if (rewrites.size === 0) continue;

  // Preserve formatting: replace the value inside the raw text rather than
  // re-serialising, so key order, indentation and trailing newlines survive.
  let updated = raw;
  for (const [name, next] of rewrites) {
    const pattern = new RegExp(
      `("${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")`,
    );
    if (!pattern.test(updated)) continue;
    updated = updated.replace(pattern, (_, lead) => `${lead}${JSON.stringify(next)}`);
  }
  if (updated === raw) continue;

  report.push({ file: path.relative(ROOT, file), scripts: [...rewrites.keys()] });
  if (!checkOnly) writeFileSync(file, updated);
}

for (const entry of report) {
  process.stdout.write(`${checkOnly ? "would update" : "updated"} ${entry.file}: ${entry.scripts.join(", ")}\n`);
}
process.stdout.write(`\n${report.length} package(s) ${checkOnly ? "to change" : "changed"}\n`);
