import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InstalledPlugin } from "../src/config/project-config.js";
import { findModifiedPaths, installBundles, planBundleFiles } from "../src/core/installer.js";
import { collectUsedDestPaths, removeTrackedFile } from "../src/core/removal.js";
import { collectRecordedCopies, projectRecords } from "../src/core/sync.js";
import { sanitizeBundle } from "../src/registry/http-client.js";
import type { AiName, PluginBundle, PluginBundleFile, PluginComponent } from "../src/registry/types.js";

const AI = { "claude-code": true, codex: true };

let root: string;

function bundleFile(component: PluginComponent, relativePath: string, content: string, ai: AiName | null = null) {
  return {
    component,
    ai,
    relativePath,
    rootPath: false,
    merge: false,
    mergeKeyPath: null,
    template: false,
    sha256: "",
    sizeBytes: String(content.length),
    encoding: "utf8",
    content,
  } satisfies PluginBundleFile;
}

function makeBundle(files: PluginBundleFile[], slug = "demo", version = "1.0.0"): PluginBundle {
  return {
    slug,
    description: "",
    version,
    changelog: null,
    createdBy: { username: "u" },
    updatedBy: { username: "u" },
    dependencies: [],
    files,
  };
}

const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

const demo = () =>
  makeBundle([
    bundleFile("skills", "lint/SKILL.md", "skill v1"),
    bundleFile("agents", "reviewer.md", "claude agent", "claude-code"),
    bundleFile("agents", "reviewer.toml", "codex agent", "codex"),
    bundleFile("commands", "run.md", "command"),
  ]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "closet-installer-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const SKILL = ".claude/skills/lint/SKILL.md";

describe("planBundleFiles (layout agents)", () => {
  it("Claude — сразу в .claude/*, Codex — в .agents/* (native), без дублей и dot-подпапок", () => {
    const { files, notices } = planBundleFiles(root, AI, demo(), "agents");
    const rel = files.map((f) => path.relative(root, f.destPath).split(path.sep).join("/")).sort();
    expect(rel).toEqual([
      ".agents/agents/reviewer.toml",
      ".agents/skills/lint/SKILL.md",
      ".claude/agents/reviewer.md",
      ".claude/commands/run.md",
      ".claude/skills/lint/SKILL.md",
    ]);
    expect(notices).toEqual([
      { pluginSlug: "demo", component: "commands", ai: "codex", reason: "unsupported" },
    ]);
  });

  it("не пишет ai-специфичный файл выключенного harness'а", () => {
    const { files } = planBundleFiles(root, { codex: true, "claude-code": false }, demo(), "agents");
    const rel = files.map((f) => path.relative(root, f.destPath).split(path.sep).join("/")).sort();
    expect(rel).toEqual([".agents/agents/reviewer.toml", ".agents/skills/lint/SKILL.md"]);
  });

  it("только Claude: хранилище .agents/ не создаётся", () => {
    const { files } = planBundleFiles(root, { codex: false, "claude-code": true }, demo(), "agents");
    const rel = files.map((f) => path.relative(root, f.destPath).split(path.sep).join("/"));
    expect(rel.some((r) => r.startsWith(".agents/"))).toBe(false);
  });
});

describe("installBundles (layout agents)", () => {
  it("кладёт файлы Claude в .claude/, Codex — в .agents/, копий нет", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });

    expect(read(SKILL)).toBe("skill v1");
    expect(read(".agents/skills/lint/SKILL.md")).toBe("skill v1");
    expect(read(".claude/agents/reviewer.md")).toBe("claude agent");
    expect(read(".agents/agents/reviewer.toml")).toBe("codex agent");
    expect(read(".claude/commands/run.md")).toBe("command");
    expect(exists(".agents/commands")).toBe(false);
    expect(exists(".agents/agents/.claude-code")).toBe(false);
    expect(exists(".claude/agents/reviewer.toml")).toBe(false);
    expect(exists(".codex")).toBe(false);

    expect(result!.writtenFiles.every((f) => f.copies === undefined)).toBe(true);
    expect(result!.skippedCopies).toEqual([]);
  });

  it("не перезаписывает руками изменённый файл в режиме skip", async () => {
    await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    fs.writeFileSync(path.join(root, SKILL), "hand edit");

    const [second] = await installBundles(root, AI, [demo()], "skip", { layout: "agents" });

    expect(read(SKILL)).toBe("hand edit");
    expect(second!.skippedFiles.map((f) => path.relative(root, f.destPath).split(path.sep).join("/"))).toEqual([SKILL]);
  });

  it("обновляет нетронутые файлы при новой версии", async () => {
    const [first] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });

    const next = demo();
    next.files[0]!.content = "skill v2";
    const preApprovedKeys = new Set(first!.writtenFiles.map((f) => path.join(root, f.path)));
    await installBundles(root, AI, [next], "interactive", { layout: "agents", preApprovedKeys });

    expect(read(".agents/skills/lint/SKILL.md")).toBe("skill v2");
    expect(read(SKILL)).toBe("skill v2");
  });
});

describe("findModifiedPaths", () => {
  it("помечает изменённый или удалённый файл", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const skill = result!.writtenFiles.find((f) => f.path === SKILL)!;

    expect(findModifiedPaths(root, skill)).toEqual([]);

    fs.writeFileSync(path.join(root, SKILL), "hand edit");
    expect(findModifiedPaths(root, skill)).toEqual([SKILL]);

    fs.rmSync(path.join(root, SKILL));
    expect(findModifiedPaths(root, skill)).toEqual([SKILL]);
  });
});

describe("sync (projectRecords)", () => {
  it("не трогает файлы, записанные напрямую в папку ИИ", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    fs.writeFileSync(path.join(root, SKILL), "hand edit");

    const plugins: Record<string, InstalledPlugin> = {
      demo: { version: "1.0.0", autoupdate: true, files: result!.writtenFiles },
    };
    const projection = await projectRecords(root, AI, result!.writtenFiles, "force", collectRecordedCopies(plugins));

    expect([...projection.copies.values()].every((copies) => copies.length === 0)).toBe(true);
    expect(read(SKILL)).toBe("hand edit");
  });
});

describe("removeTrackedFile (layout agents)", () => {
  it("удаляет файл Claude и файл Codex", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const claudeSkill = result!.writtenFiles.find((f) => f.path === SKILL)!;
    const codexSkill = result!.writtenFiles.find((f) => f.path === ".agents/skills/lint/SKILL.md")!;

    expect(removeTrackedFile(root, claudeSkill, new Set())).toBe("removed");
    expect(removeTrackedFile(root, codexSkill, new Set())).toBe("removed");
    expect(exists(SKILL)).toBe(false);
    expect(exists(".agents/skills/lint/SKILL.md")).toBe(false);
  });

  it("не трогает файл, пока им пользуется другой плагин", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const other: Record<string, InstalledPlugin> = {
      other: { version: "1.0.0", autoupdate: true, files: result!.writtenFiles },
    };
    const skill = result!.writtenFiles.find((f) => f.path === SKILL)!;

    const stillUsed = collectUsedDestPaths(root, other, new Set());
    expect(removeTrackedFile(root, skill, stillUsed)).toBe("kept-shared");
    expect(exists(SKILL)).toBe(true);
  });
});

describe("sanitizeBundle", () => {
  it("пропускает файлы с неизвестным ai и сообщает о них", () => {
    const bundle = makeBundle([
      bundleFile("skills", "a/SKILL.md", "x"),
      { ...bundleFile("agents", "a.md", "x"), ai: "cursor" as AiName },
    ]);
    const clean = sanitizeBundle(bundle);

    expect(clean.files.map((f) => f.relativePath)).toEqual(["a/SKILL.md"]);
    expect(clean.unsupportedFiles).toEqual([{ component: "agents", ai: "cursor", relativePath: "a.md" }]);
  });
});
