import { describe, expect, it } from "vitest";

import { AI_NAMES as REGISTRY_AI_NAMES } from "../src/registry/types.js";
import { HARNESS_IDS, HARNESSES } from "../src/harnesses/registry.js";
import { resolvePlacement } from "../src/core/path-mapper.js";

describe("resolvePlacement", () => {
  it("копирует skills/rules/commands/agents Claude Code в .claude", () => {
    expect(resolvePlacement("claude-code", "skills", false)).toEqual({ kind: "copy", dir: ".claude/skills" });
    expect(resolvePlacement("claude-code", "rules", false)).toEqual({ kind: "copy", dir: ".claude/rules" });
    expect(resolvePlacement("claude-code", "commands", false)).toEqual({ kind: "copy", dir: ".claude/commands" });
    expect(resolvePlacement("claude-code", "agents", false)).toEqual({ kind: "copy", dir: ".claude/agents" });
  });

  it("Codex читает skills из .agents/skills сам, agents копирует в .codex/agents", () => {
    expect(resolvePlacement("codex", "skills", false)).toEqual({ kind: "native" });
    expect(resolvePlacement("codex", "agents", false)).toEqual({ kind: "copy", dir: ".codex/agents" });
  });

  it("scripts и сами файлы хуков живут только в хранилище", () => {
    for (const ai of HARNESS_IDS) {
      expect(resolvePlacement(ai, "scripts", false)).toEqual({ kind: "store-only" });
      expect(resolvePlacement(ai, "hooks", false)).toEqual({ kind: "store-only" });
    }
  });

  it("merge-слоты: .claude/settings.json, .mcp.json, .codex/config.toml", () => {
    expect(resolvePlacement("claude-code", "hooks", true)).toEqual({ kind: "merge-json", file: ".claude/settings.json" });
    expect(resolvePlacement("claude-code", "mcp", true)).toEqual({ kind: "merge-json", file: ".mcp.json" });
    expect(resolvePlacement("codex", "mcp", true)).toEqual({ kind: "merge-toml", file: ".codex/config.toml" });
  });

  it("явно различает unsupported и not-implemented", () => {
    expect(resolvePlacement("codex", "commands", false)).toEqual({ kind: "unsupported" });
    expect(resolvePlacement("codex", "rules", false)).toEqual({ kind: "not-implemented" });
    expect(resolvePlacement("claude-code", "skills", true)).toEqual({ kind: "unsupported" });
    expect(resolvePlacement("codex", "agents", true)).toEqual({ kind: "unsupported" });
  });
});

describe("harnesses", () => {
  it("HARNESS_IDS совпадает с дескрипторами и с проводным контрактом реестра", () => {
    expect([...HARNESS_IDS]).toEqual(HARNESSES.map((h) => h.id));
    expect([...REGISTRY_AI_NAMES].sort()).toEqual([...HARNESS_IDS].sort());
  });
});
