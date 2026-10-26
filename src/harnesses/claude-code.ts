import type { HarnessDescriptor } from "./types.js";

/**
 * `.agents/*` Claude Code не читает (PLAN.md, §2), поэтому всё, что он должен
 * видеть, пишется сразу в `.claude/` (`direct`), без дубля в `.agents/`. Скрипты и
 * сами файлы хуков остаются в `.agents/`: регистрация хука в `settings.json` ссылается на путь.
 */
export const claudeCode = {
  id: "claude-code",
  label: "Claude Code",
  rootDir: ".claude",
  instructions: { file: "CLAUDE.md", bridge: "import-agents-md" },
  placements: {
    skills: { kind: "direct", dir: ".claude/skills" },
    rules: { kind: "direct", dir: ".claude/rules" },
    commands: { kind: "direct", dir: ".claude/commands" },
    agents: { kind: "direct", dir: ".claude/agents" },
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
