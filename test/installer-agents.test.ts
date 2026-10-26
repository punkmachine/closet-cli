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

describe("planBundleFiles (layout agents)", () => {
  it("пишет файл в хранилище один раз; ai-специфичные — в dot-подпапку", () => {
    const { files, notices } = planBundleFiles(root, AI, demo(), "agents");
    const rel = files.map((f) => path.relative(root, f.destPath).split(path.sep).join("/")).sort();
    expect(rel).toEqual([
      ".agents/agents/.claude-code/reviewer.md",
      ".agents/agents/.codex/reviewer.toml",
      ".agents/commands/run.md",
      ".agents/skills/lint/SKILL.md",
    ]);
    expect(notices).toEqual([
      { pluginSlug: "demo", component: "commands", ai: "codex", reason: "unsupported" },
    ]);
  });

  it("не пишет ai-специфичный файл выключенного harness'а", () => {
    const { files } = planBundleFiles(root, { codex: true, "claude-code": false }, demo(), "agents");
    const rel = files.map((f) => path.relative(root, f.destPath).split(path.sep).join("/")).sort();
    expect(rel).toEqual([".agents/agents/.codex/reviewer.toml", ".agents/skills/lint/SKILL.md"]);
  });
});

describe("installBundles (layout agents)", () => {
  it("кладёт файлы в хранилище и копии в папки harness'ов (кроме native)", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });

    expect(read(".agents/skills/lint/SKILL.md")).toBe("skill v1");
    expect(read(".claude/skills/lint/SKILL.md")).toBe("skill v1");
    expect(exists(".codex/skills")).toBe(false);
    expect(read(".claude/agents/reviewer.md")).toBe("claude agent");
    expect(read(".codex/agents/reviewer.toml")).toBe("codex agent");
    expect(read(".claude/commands/run.md")).toBe("command");

    const skill = result!.writtenFiles.find((f) => f.path === ".agents/skills/lint/SKILL.md");
    expect(skill?.copies?.map((c) => c.path)).toEqual([".claude/skills/lint/SKILL.md"]);
    expect(result!.skippedCopies).toEqual([]);
  });

  it("не перезаписывает руками изменённую копию в режиме skip", async () => {
    const [first] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    fs.writeFileSync(path.join(root, ".claude/skills/lint/SKILL.md"), "hand edit");

    const plugins: Record<string, InstalledPlugin> = {
      demo: { version: "1.0.0", autoupdate: true, files: first!.writtenFiles },
    };
    const [second] = await installBundles(root, AI, [demo()], "skip", {
      layout: "agents",
      recordedCopies: collectRecordedCopies(plugins),
    });

    expect(read(".claude/skills/lint/SKILL.md")).toBe("hand edit");
    expect(second!.skippedCopies).toEqual([".claude/skills/lint/SKILL.md"]);
  });

  it("обновляет чистую копию при новой версии хранилища", async () => {
    const [first] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const plugins: Record<string, InstalledPlugin> = {
      demo: { version: "1.0.0", autoupdate: true, files: first!.writtenFiles },
    };

    const next = demo();
    next.files[0]!.content = "skill v2";
    const preApprovedKeys = new Set(first!.writtenFiles.map((f) => path.join(root, f.path)));
    await installBundles(root, AI, [next], "interactive", {
      layout: "agents",
      preApprovedKeys,
      recordedCopies: collectRecordedCopies(plugins),
    });

    expect(read(".agents/skills/lint/SKILL.md")).toBe("skill v2");
    expect(read(".claude/skills/lint/SKILL.md")).toBe("skill v2");
  });
});

describe("findModifiedPaths", () => {
  it("помечает изменённую копию, но не отсутствующую", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const skill = result!.writtenFiles.find((f) => f.path === ".agents/skills/lint/SKILL.md")!;

    expect(findModifiedPaths(root, skill)).toEqual([]);

    fs.rmSync(path.join(root, ".claude/skills/lint/SKILL.md"));
    expect(findModifiedPaths(root, skill)).toEqual([]);

    fs.writeFileSync(path.join(root, ".claude/skills/lint/SKILL.md"), "hand edit");
    expect(findModifiedPaths(root, skill)).toEqual([".claude/skills/lint/SKILL.md"]);
  });
});

describe("sync (projectRecords)", () => {
  it("восстанавливает отсутствующие копии из хранилища", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    fs.rmSync(path.join(root, ".claude"), { recursive: true });

    const plugins: Record<string, InstalledPlugin> = {
      demo: { version: "1.0.0", autoupdate: true, files: result!.writtenFiles },
    };
    await projectRecords(root, AI, result!.writtenFiles, "force", collectRecordedCopies(plugins));

    expect(read(".claude/skills/lint/SKILL.md")).toBe("skill v1");
    expect(read(".claude/agents/reviewer.md")).toBe("claude agent");
  });
});

describe("removeTrackedFile (layout agents)", () => {
  it("удаляет копии и файл хранилища", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const skill = result!.writtenFiles.find((f) => f.path === ".agents/skills/lint/SKILL.md")!;

    expect(removeTrackedFile(root, skill, new Set())).toBe("removed");
    expect(exists(".agents/skills/lint/SKILL.md")).toBe(false);
    expect(exists(".claude/skills/lint/SKILL.md")).toBe(false);
  });

  it("не трогает копии, пока хранилищем пользуется другой плагин", async () => {
    const [result] = await installBundles(root, AI, [demo()], "force", { layout: "agents" });
    const other: Record<string, InstalledPlugin> = {
      other: { version: "1.0.0", autoupdate: true, files: result!.writtenFiles },
    };
    const skill = result!.writtenFiles.find((f) => f.path === ".agents/skills/lint/SKILL.md")!;

    const stillUsed = collectUsedDestPaths(root, other, new Set());
    expect(removeTrackedFile(root, skill, stillUsed)).toBe("kept-shared");
    expect(exists(".claude/skills/lint/SKILL.md")).toBe(true);
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
