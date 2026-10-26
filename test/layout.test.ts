import { describe, expect, it } from "vitest";

import { parseStoragePath, storagePath } from "../src/core/layout.js";
import { PLUGIN_COMPONENTS } from "../src/registry/types.js";

describe("layout", () => {
  it("общий файл → .agents/<component>/<path>", () => {
    expect(storagePath({ component: "skills", ai: null, relativePath: "lint/SKILL.md" })).toBe(
      ".agents/skills/lint/SKILL.md",
    );
  });

  it("ai-специфичный файл → в dot-подпапке harness'а", () => {
    expect(storagePath({ component: "agents", ai: "codex", relativePath: "reviewer.toml" })).toBe(
      ".agents/agents/.codex/reviewer.toml",
    );
  });

  it("parseStoragePath обратна storagePath", () => {
    for (const loc of [
      { component: "agents", ai: "claude-code", relativePath: "reviewer.md" },
      { component: "skills", ai: null, relativePath: "lint/refs/a.md" },
    ] as const) {
      expect(parseStoragePath(storagePath(loc), PLUGIN_COMPONENTS)).toEqual(loc);
    }
  });

  it("неизвестный dot-сегмент — часть пути, а не ai", () => {
    expect(parseStoragePath(".agents/skills/.hidden/x.md", PLUGIN_COMPONENTS)).toEqual({
      component: "skills",
      ai: null,
      relativePath: ".hidden/x.md",
    });
  });

  it("пути вне .agents/<component>/ → null", () => {
    expect(parseStoragePath(".claude/skills/a/SKILL.md", PLUGIN_COMPONENTS)).toBeNull();
    expect(parseStoragePath(".agents/unknown/a.md", PLUGIN_COMPONENTS)).toBeNull();
  });
});
