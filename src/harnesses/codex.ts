import type { HarnessDescriptor } from "./types.js";

/**
 * Опирается только на документацию (PLAN.md, §2, §8): на практике Codex не
 * проверялся. Если он не подхватит `.agents/skills`, исправляется одной
 * строкой: `skills` → `{ kind: "copy", dir: ".codex/skills" }`.
 */
export const codex = {
  id: "codex",
  label: "Codex",
  rootDir: ".codex",
  instructions: { file: "AGENTS.md" },
  placements: {
    skills: { kind: "native" },
    rules: { kind: "not-implemented" },
    commands: { kind: "unsupported" },
    agents: { kind: "copy", dir: ".codex/agents" },
    hooks: { kind: "store-only" },
    scripts: { kind: "store-only" },
    mcp: { kind: "unsupported" },
  },
  // `agents` — не merge-слот: по документации это файлы `.codex/agents/*.toml` (placements выше).
  mergePlacements: {
    hooks: { kind: "merge-toml", file: ".codex/config.toml" },
    mcp: { kind: "merge-toml", file: ".codex/config.toml" },
  },
  initDirs: [".codex/agents"],
} as const satisfies HarnessDescriptor;
