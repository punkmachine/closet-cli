import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectCopy, projectFile, removeCopy, resolveCopyPath, sha256Hex } from "../src/core/projector.js";
import { getHarness } from "../src/harnesses/registry.js";
import type { HarnessDescriptor } from "../src/harnesses/types.js";

// Реальные дескрипторы пока не используют `copy`; движок копирования проверяем на синтетическом.
const base = getHarness("claude-code");
const claude: HarnessDescriptor = {
  ...base,
  placements: {
    ...base.placements,
    skills: { kind: "copy", dir: ".claude/skills" },
    rules: { kind: "copy", dir: ".claude/rules" },
  },
};
const codex = getHarness("codex");

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf-8");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "closet-projector-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveCopyPath", () => {
  it("убирает dot-сегмент ai и сохраняет структуру skill-папки", () => {
    expect(resolveCopyPath(claude, ".agents/skills/lint/SKILL.md")).toBe(".claude/skills/lint/SKILL.md");
    expect(resolveCopyPath(claude, ".agents/skills/lint/refs/a.md")).toBe(".claude/skills/lint/refs/a.md");
    expect(resolveCopyPath(claude, ".agents/rules/.claude-code/style.md")).toBe(".claude/rules/style.md");
    expect(resolveCopyPath(codex, ".agents/agents/reviewer.toml")).toBeNull();
  });

  it("не проецирует файлы другого harness'а", () => {
    expect(resolveCopyPath(claude, ".agents/agents/reviewer.toml")).toBeNull();
    expect(resolveCopyPath(codex, ".agents/agents/.claude-code/reviewer.md")).toBeNull();
  });

  it("native/store-only/unsupported копий не имеют", () => {
    expect(resolveCopyPath(codex, ".agents/skills/lint/SKILL.md")).toBeNull();
    expect(resolveCopyPath(claude, ".agents/scripts/run.sh")).toBeNull();
    expect(resolveCopyPath(codex, ".agents/commands/x.md")).toBeNull();
    expect(resolveCopyPath(claude, ".claude/skills/a/SKILL.md")).toBeNull();
  });
});

describe("projectFile", () => {
  const storage = ".agents/skills/lint/SKILL.md";

  it("создаёт копию и возвращает её sha256", () => {
    write(storage, "v1");
    expect(projectFile(root, claude, storage)).toEqual({
      status: "written",
      copy: { path: ".claude/skills/lint/SKILL.md", sha256: sha256Hex("v1") },
    });
    expect(read(".claude/skills/lint/SKILL.md")).toBe("v1");
  });

  it("обновляет нетронутую копию после изменения хранилища", () => {
    write(storage, "v1");
    const first = projectFile(root, claude, storage);
    if (first.status !== "written") throw new Error("ожидалась запись");
    write(storage, "v2");
    expect(projectFile(root, claude, storage, first.copy).status).toBe("written");
    expect(read(".claude/skills/lint/SKILL.md")).toBe("v2");
  });

  it("не затирает вручную изменённую копию без overwrite", () => {
    write(storage, "v1");
    const first = projectFile(root, claude, storage);
    if (first.status !== "written") throw new Error("ожидалась запись");
    write(".claude/skills/lint/SKILL.md", "hand edit");
    write(storage, "v2");

    expect(projectFile(root, claude, storage, first.copy)).toEqual({
      status: "conflict",
      copyPath: ".claude/skills/lint/SKILL.md",
    });
    expect(read(".claude/skills/lint/SKILL.md")).toBe("hand edit");

    expect(projectFile(root, claude, storage, first.copy, { overwrite: true }).status).toBe("written");
    expect(read(".claude/skills/lint/SKILL.md")).toBe("v2");
  });

  it("существующий файл без записи: другое содержимое — конфликт, то же — unchanged", () => {
    write(storage, "v1");
    write(".claude/skills/lint/SKILL.md", "other");
    expect(projectFile(root, claude, storage).status).toBe("conflict");

    write(".claude/skills/lint/SKILL.md", "v1");
    expect(projectFile(root, claude, storage).status).toBe("unchanged");
  });

  it("пропускает файлы без копии для harness'а", () => {
    write(storage, "v1");
    expect(projectFile(root, codex, storage)).toEqual({ status: "skipped" });
    expect(fs.existsSync(path.join(root, ".codex/skills"))).toBe(false);
  });
});

describe("removeCopy", () => {
  const copy = { path: ".claude/skills/lint/SKILL.md", sha256: sha256Hex("v1") };

  it("удаляет нетронутую копию и пустую папку skill'а, но оставляет .claude/skills", () => {
    write(copy.path, "v1");
    expect(removeCopy(root, copy)).toBe("removed");
    expect(fs.existsSync(path.join(root, ".claude/skills/lint"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude/skills"))).toBe(true);
  });

  it("не удаляет изменённую копию без force", () => {
    write(copy.path, "hand edit");
    expect(removeCopy(root, copy)).toBe("modified");
    expect(read(copy.path)).toBe("hand edit");
    expect(removeCopy(root, copy, { force: true })).toBe("removed");
  });

  it("отсутствующая копия — missing", () => {
    expect(removeCopy(root, copy)).toBe("missing");
    expect(inspectCopy(root, copy.path, copy.sha256)).toBe("missing");
  });
});
