/**
 * Дескрипторы harness'ов (PLAN.md, §4): «какая папка, какой формат, копия или
 * merge» для каждого ИИ-агента. Новый harness = новый дескриптор, без правок ядра.
 *
 * `PluginComponent` продублирован здесь намеренно (а не импортирован из
 * `config/*`/`registry/*`): `config/project-config.ts` сам берёт список ИИ из
 * `harnesses/registry.ts`, и обратная зависимость дала бы цикл.
 */
export type PluginComponent = "mcp" | "rules" | "hooks" | "agents" | "commands" | "skills" | "scripts";

/**
 * Что делать с файлом компонента, лежащим в `.agents/` (хранилище).
 */
export type Placement =
  /** Копировать из `.agents/<component>` в `dir` (путь относительно корня проекта). */
  | { kind: "copy"; dir: string }
  /** Harness сам читает `.agents/<component>`, копия не нужна. */
  | { kind: "native" }
  /** Файл живёт только в `.agents/`; на него ссылаются по пути (скрипты, файлы хуков). */
  | { kind: "store-only" }
  /** Запись в общий файл (хуки, MCP) — через merge-движки. `file` — относительно корня проекта. */
  | { kind: "merge-json" | "merge-toml"; file: string }
  /** У harness'а нет аналога (подтверждено документацией). */
  | { kind: "unsupported" }
  /** Аналог есть, но движка в closet-cli пока нет. */
  | { kind: "not-implemented" };

export interface HarnessDescriptor {
  /** Идентификатор; совпадает со значением `ai` в bundle-ответе реестра и ключом в `closet-cli.json`. */
  id: string;
  label: string;
  /** Корневая папка harness'а в проекте (`.claude`, `.codex`) — по ней `detect`. */
  rootDir: string;
  instructions: {
    /** Файл инструкций harness'а в корне проекта. */
    file: string;
    /** `import-agents-md`: файл содержит `@AGENTS.md` вместо собственного текста. Без поля — harness читает `AGENTS.md` сам. */
    bridge?: "import-agents-md";
  };
  /** Размещение обычных (немерджащихся) файлов по компонентам. */
  placements: Record<PluginComponent, Placement>;
  /** Размещение merge-файлов; компонента нет в списке — merge для него не поддерживается. */
  mergePlacements: Partial<Record<PluginComponent, Placement>>;
  /** Каталоги, которые `init` создаёт при включении harness'а (относительно корня проекта). */
  initDirs: readonly string[];
}
