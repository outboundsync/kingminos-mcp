import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  classifyCommit,
  getNextTag,
  githubOutputLine,
  parseArgs,
  planRelease,
  RELEASE_COMMIT_PATTERN,
  renderGroupedNotes,
  sortCalverTags,
  stampReleaseVersion,
} from "../scripts/release-calver.mjs";

const NOW = new Date("2026-09-28T23:30:00Z");

test("tags sort numerically and ignore non-CalVer tags", () => {
  assert.deepEqual(
    sortCalverTags(["2026.09.02.10", "v1.0.0", "2026.09.02.9", "2026.07.23.0"]),
    ["2026.07.23.0", "2026.09.02.9", "2026.09.02.10"],
  );
});

test("next tag increments the same UTC day, else starts at .0", () => {
  assert.equal(
    getNextTag(["2026.09.28.0", "2026.09.28.1"], NOW),
    "2026.09.28.2",
  );
  assert.equal(getNextTag(["2026.09.02.1"], NOW), "2026.09.28.0");
  assert.equal(
    getNextTag([], new Date("2026-09-29T00:30:00+02:00")),
    "2026.09.28.0",
  );
});

test("commits group by conventional type; breaking changes are marked", () => {
  assert.deepEqual(classifyCommit("feat(api)!: drop v0"), {
    typeKey: "feat",
    breaking: true,
  });
  assert.deepEqual(classifyCommit("Point MCP links at /docs"), {
    typeKey: "other",
    breaking: false,
  });
  const notes = renderGroupedNotes([
    { subject: "fix: a", shortSha: "aaaaaaa" },
    { subject: "feat!: b", shortSha: "bbbbbbb" },
    { subject: "Plain c", shortSha: "ccccccc" },
  ]);
  assert.equal(
    notes,
    "### Features\n- **Breaking:** feat!: b (bbbbbbb)\n\n### Fixes\n- fix: a (aaaaaaa)\n\n### Other\n- Plain c (ccccccc)",
  );
});

test("release bookkeeping commits are excluded; no commits means no release", () => {
  const plan = planRelease({
    tags: ["2026.09.02.1"],
    commitLog: "abc1234def\tchore(release): 2026.09.02.1",
    now: NOW,
  });
  assert.deepEqual(plan, { hasChanges: false, lastTag: "2026.09.02.1" });
});

test("the squash-merged CHANGELOG promotion commit never triggers a release", () => {
  for (const subject of [
    "chore(release): 2026.10.08.4",
    "chore(release): CHANGELOG for 2026.10.08.4",
    "chore(release): CHANGELOG for 2026.10.08.4 (#24)",
  ]) {
    assert.match(subject, RELEASE_COMMIT_PATTERN, subject);
  }
  assert.doesNotMatch(
    "chore(release): CHANGELOG for 2026.10.08.2 plus docs (#22)",
    RELEASE_COMMIT_PATTERN,
  );
  const plan = planRelease({
    tags: ["2026.09.28.0"],
    commitLog: "abc1234def\tchore(release): CHANGELOG for 2026.09.28.0 (#24)",
    now: NOW,
  });
  assert.deepEqual(plan, { hasChanges: false, lastTag: "2026.09.28.0" });
});

test("planRelease builds the tag and notes", () => {
  const plan = planRelease({
    tags: ["2026.09.02.1"],
    commitLog: "abc1234def\tfeat: x\n",
    now: NOW,
  });
  assert.equal(plan.nextTag, "2026.09.28.0");
  assert.equal(
    plan.releaseNotes,
    "## [2026.09.28.0] - 2026-09-28\n\n### Features\n- feat: x (abc1234)",
  );
});

test("args: --dry-run and --apply are exclusive; file flags need a value", () => {
  assert.throws(
    () => parseArgs(["--dry-run", "--apply"]),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseArgs(["--notes-file", "--apply"]),
    /needs a file path/,
  );
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
  assert.deepEqual(parseArgs(["--dry-run", "--notes-file", "n.md"]), {
    apply: false,
    stampVersion: false,
    notesFile: "n.md",
    tagFile: "",
  });
  assert.deepEqual(parseArgs(["--apply", "--stamp-version"]), {
    apply: true,
    stampVersion: true,
    notesFile: "",
    tagFile: "",
  });
  assert.deepEqual(
    parseArgs(["--dry-run", "--notes-file", "release-notes.md"]),
    {
      apply: false,
      stampVersion: false,
      notesFile: "release-notes.md",
      tagFile: "",
    },
  );
});

test("GITHUB_OUTPUT uses a delimiter that cannot collide with the value", () => {
  const line = githubOutputLine("notes", "EOF\nmore");
  const delimiter = line.split("\n")[0].split("<<")[1];
  assert.notEqual(delimiter, "EOF");
  assert.ok(line.endsWith(`\n${delimiter}\n`));
});

test("stampReleaseVersion updates package.json, package-lock.json, and src/config.ts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "calver-stamp-"));
  try {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0" }, null, 2),
    );
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify(
        {
          name: "x",
          version: "1.0.0",
          lockfileVersion: 3,
          packages: { "": { name: "x", version: "1.0.0" } },
        },
        null,
        2,
      ),
    );
    mkdirSync(path.join(dir, "src"));
    writeFileSync(
      path.join(dir, "src", "config.ts"),
      'export const VERSION = "1.0.0";\n',
    );
    assert.equal(stampReleaseVersion("2026.10.23.0", dir), true);
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const lock = JSON.parse(
      readFileSync(path.join(dir, "package-lock.json"), "utf8"),
    );
    const config = readFileSync(path.join(dir, "src", "config.ts"), "utf8");
    assert.equal(pkg.version, "2026.10.23.0");
    assert.equal(lock.version, "2026.10.23.0");
    assert.equal(lock.packages[""].version, "2026.10.23.0");
    assert.match(config, /export const VERSION = "2026\.10\.23\.0";/);
    assert.equal(stampReleaseVersion("2026.10.23.0", dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
