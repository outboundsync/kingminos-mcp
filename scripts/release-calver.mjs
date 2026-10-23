#!/usr/bin/env node
// Computes the next CalVer release (YYYY.MM.DD.N, UTC date) and its notes
// from commits since the last CalVer tag.
//
//   npm run release:preview           # print tag + notes; writes nothing
//   node scripts/release-calver.mjs --dry-run --notes-file notes.md --tag-file tag.txt
//                                      # CI: also write notes/tag files
//   npm run release:apply             # stamp package.json, package-lock.json, src/config.ts
//
// CI (.github/workflows/release-calver.yml) runs --apply --stamp-version, commits
// the version bump on main, tags, and publishes a GitHub release.
//
// GITHUB_OUTPUT (when set) receives has_changes, next_tag, previous_tag,
// release_date, and version_stamped.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CALVER_TAG_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
// Release bookkeeping commits never count toward a new release.
export const RELEASE_COMMIT_PATTERN =
  /^chore\(release\):\s+(?:CHANGELOG for\s+)?\d{4}\.\d{2}\.\d{2}\.\d+(?:\s+\(#\d+\))?$/i;

const TYPE_TITLES = new Map([
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactors"],
  ["docs", "Documentation"],
  ["build", "Build"],
  ["chore", "Chores"],
  ["test", "Tests"],
  ["ci", "CI"],
  ["revert", "Reverts"],
  ["other", "Other"],
]);

const PACKAGE_JSON = "package.json";
const PACKAGE_LOCK = "package-lock.json";
const CONFIG_TS = "src/config.ts";

export function parseArgs(argv) {
  const known = new Set([
    "--dry-run",
    "--apply",
    "--stamp-version",
    "--notes-file",
    "--tag-file",
  ]);
  for (const arg of argv) {
    if (arg.startsWith("--") && !known.has(arg))
      throw new Error(`unknown argument '${arg}'`);
  }
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run"))
    throw new Error("--dry-run and --apply are mutually exclusive");
  return {
    apply,
    stampVersion: argv.includes("--stamp-version"),
    notesFile: readArgValue(argv, "--notes-file"),
    tagFile: readArgValue(argv, "--tag-file"),
  };
}

function readArgValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return "";
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${flag} needs a file path`);
  return value;
}

export function compareCalverTags(a, b) {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  for (let index = 0; index < 4; index += 1) {
    if (aParts[index] !== bParts[index]) return aParts[index] - bParts[index];
  }
  return 0;
}

export function sortCalverTags(tags) {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => CALVER_TAG_PATTERN.test(tag))
    .sort(compareCalverTags);
}

function formatTodayPrefixUtc(now) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

export function getNextTag(tags, now) {
  const prefix = formatTodayPrefixUtc(now);
  const suffixes = tags
    .filter((tag) => tag.startsWith(`${prefix}.`))
    .map((tag) => Number(tag.split(".")[3]))
    .filter((n) => !Number.isNaN(n));
  return `${prefix}.${suffixes.length === 0 ? 0 : Math.max(...suffixes) + 1}`;
}

/** `raw` is `git log --pretty=format:%H%x09%s` output. */
export function parseCommits(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subjectParts] = line.split("\t");
      return {
        sha,
        shortSha: sha.slice(0, 7),
        subject: subjectParts.join("\t").trim(),
      };
    })
    .filter((commit) => !RELEASE_COMMIT_PATTERN.test(commit.subject));
}

export function classifyCommit(subject) {
  const match = subject.match(/^([a-z]+)(\([^)]*\))?(!)?:\s+(.+)$/i);
  if (!match) return { typeKey: "other", breaking: false };
  const rawType = match[1].toLowerCase();
  return {
    typeKey: TYPE_TITLES.has(rawType) ? rawType : "other",
    breaking: Boolean(match[3]),
  };
}

export function renderGroupedNotes(commits) {
  const groups = new Map();
  for (const commit of commits) {
    const { typeKey, breaking } = classifyCommit(commit.subject);
    if (!groups.has(typeKey)) groups.set(typeKey, []);
    groups
      .get(typeKey)
      .push(
        `- ${breaking ? "**Breaking:** " : ""}${commit.subject} (${commit.shortSha})`,
      );
  }
  const sections = [...TYPE_TITLES.keys()]
    .filter((key) => groups.has(key))
    .map((key) =>
      [`### ${TYPE_TITLES.get(key)}`, ...groups.get(key)].join("\n"),
    );
  return sections.length === 0
    ? "- No changes in this release."
    : sections.join("\n\n");
}

export function renderReleaseSection(tag, date, body) {
  return `## [${tag}] - ${date}\n\n${body}`;
}

/** Returns true when any stamped file changed. */
export function stampReleaseVersion(nextTag, rootDir = ".") {
  let changed = false;
  const file = (relative) => path.join(rootDir, relative);

  const pkgPath = file(PACKAGE_JSON);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.version !== nextTag) {
    pkg.version = nextTag;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    changed = true;
  }

  const lockPath = file(PACKAGE_LOCK);
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    let lockChanged = false;
    if (lock.version !== nextTag) {
      lock.version = nextTag;
      lockChanged = true;
    }
    if (lock.packages?.[""]?.version !== nextTag) {
      lock.packages = lock.packages ?? {};
      lock.packages[""] = lock.packages[""] ?? {};
      lock.packages[""].version = nextTag;
      lockChanged = true;
    }
    if (lockChanged) {
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
      changed = true;
    }
  }

  const configPath = file(CONFIG_TS);
  const configBefore = readFileSync(configPath, "utf8");
  const versionMatch = configBefore.match(/export const VERSION = "([^"]+)";/);
  if (!versionMatch) {
    throw new Error(`${configPath} is missing export const VERSION = "…";`);
  }
  if (versionMatch[1] !== nextTag) {
    const configAfter = configBefore.replace(
      /export const VERSION = "[^"]+";/,
      `export const VERSION = "${nextTag}";`,
    );
    writeFileSync(configPath, configAfter, "utf8");
    changed = true;
  }

  return changed;
}

export function githubOutputLine(
  name,
  value,
  delimiter = `EOF_${randomBytes(8).toString("hex")}`,
) {
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

export function planRelease({ tags, commitLog, now }) {
  const sorted = sortCalverTags(tags);
  const lastTag = sorted.at(-1) ?? "";
  const commits = parseCommits(commitLog);
  if (commits.length === 0) return { hasChanges: false, lastTag };
  const nextTag = getNextTag(sorted, now);
  const date = now.toISOString().slice(0, 10);
  const notes = renderGroupedNotes(commits);
  return {
    hasChanges: true,
    lastTag,
    nextTag,
    date,
    commits,
    notes,
    releaseNotes: renderReleaseSection(nextTag, date, notes),
  };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`release-calver: ${err.message}`);
    process.exit(2);
  }

  const tags = git(["tag", "--list"]).split("\n").filter(Boolean);
  const lastTag = sortCalverTags(tags).at(-1) ?? "";
  const commitLog = git([
    "log",
    "--pretty=format:%H%x09%s",
    lastTag ? `${lastTag}..HEAD` : "HEAD",
  ]);
  const plan = planRelease({ tags, commitLog, now: new Date() });

  const output = (name, value) => {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        githubOutputLine(name, value),
        "utf8",
      );
  };

  if (!plan.hasChanges) {
    console.log("No commits since the last CalVer tag. Skipping release.");
    output("has_changes", "false");
    output("previous_tag", plan.lastTag || "none");
    return;
  }

  let versionStamped = false;
  if (args.apply && args.stampVersion) {
    versionStamped = stampReleaseVersion(plan.nextTag);
    if (!versionStamped) {
      console.log("Version files already match the next tag; no stamp needed.");
    }
  }

  if (args.notesFile)
    writeFileSync(args.notesFile, `${plan.releaseNotes}\n`, "utf8");
  if (args.tagFile) writeFileSync(args.tagFile, `${plan.nextTag}\n`, "utf8");

  output("has_changes", "true");
  output("next_tag", plan.nextTag);
  output("previous_tag", plan.lastTag || "none");
  output("release_date", plan.date);
  output("version_stamped", String(versionStamped));

  console.log(
    `Next release tag: ${plan.nextTag} (previous: ${plan.lastTag || "none"}, ${plan.commits.length} commits)\n`,
  );
  console.log(plan.releaseNotes);
  const wrote = [
    args.notesFile,
    args.tagFile,
    versionStamped && "version files",
  ].filter(Boolean);
  console.log(
    `\n${wrote.length ? `Wrote: ${wrote.join(", ")}` : "Preview only — no files written."}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
