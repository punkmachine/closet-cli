import type { HarnessDescriptor } from "./types.js";

/**
 * `.agents/*` Claude Code не читает (PLAN.md, §2), поэтому всё, что он должен
 * видеть, копируется в `.claude/`. Скрипты и сами файлы хуков остаются в
 * `.agents/`: регистрация хука в `settings.json` ссылается на путь.
 */
export const claudeCode = {
  id: "claude-code",
  label: "Claude Code",
  rootDir: ".claude",
  instructions: { file: "CLAUDE.md", bridge: "import-agents-md" },
  placements: {
    skills: { kind: "copy", dir: ".claude/skills" },
    rules: { kind: "copy", dir: ".claude/rules" },
    commands: { kind: "copy", dir: ".claude/commands" },
    agents: { kind: "copy", dir: ".claude/agents" },
    hooks: { kind: "store-only" },
    scripts: { kind: "store-only" },
    mcp: { kind: "unsupported" },
  },
  mergePlacements: {
    hooks: { kind: "merge-json", file: ".claude/settings.json" },
    mcp: { kind: "merge-json", file: ".mcp.json" },
  },
  initDirs: [".claude/skills", ".claude/rules", ".claude/commands", ".claude/agents"],
} as const satisfies HarnessDescriptor;
