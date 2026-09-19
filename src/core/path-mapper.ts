/**
 * Path-mapper (plan.md, 2.8/2.9): хардкод-таблица «компонент × ai × merge →
 * место на диске». Отдельно от `merge`, потому что этот флаг — свойство
 * конкретного файла плагина, а не компонента целиком: один и тот же
 * компонент `hooks` может нести и обычный файл (сам скрипт хука), и
 * merge-запись (регистрация хука в `settings.json`/`config.toml`).
 *
 * Типы `PluginComponent`/`AiName` продублированы здесь намеренно, а не
 * импортированы из `src/config/project-config.ts` — см. конвенцию
 * "изоляция модулей" в `CLAUDE.md`: этот модуль не должен тянуть зависимость
 * на `config/*` только ради пары union-типов.
 */

export type PluginComponent = "mcp" | "rules" | "hooks" | "agents" | "commands" | "skills" | "scripts";
export type AiName = "codex" | "claude-code";

/**
 * Обычный (немерджащийся) файл: кладётся как есть в `relativeDir` внутри
 * проекта, дальше — `relativePath` самого файла из bundle-ответа реестра.
 */
export interface DirTarget {
  kind: "dir";
  relativeDir: string;
}

/** Merge-файл в формате JSON — пишется через `core/json-merge.ts`. */
export interface MergeJsonTarget {
  kind: "merge-json";
  relativePath: string;
}

/** Merge-файл в формате TOML — пишется через `core/toml-merge.ts`. */
export interface MergeTomlTarget {
  kind: "merge-toml";
  relativePath: string;
}

/** ИИ в принципе не имеет аналога для этого компонента (подтверждено документацией, plan.md 2.9). */
export interface UnsupportedTarget {
  kind: "unsupported";
}

/**
 * Аналог у ИИ концептуально есть (см. plan.md 2.9), но closet-cli пока не
 * умеет писать в этот формат назначения — например, `rules` для Codex
 * должны стать фрагментом `AGENTS.md`, а merge-движок фрагментов markdown
 * ещё не реализован (только JSON/TOML, см. `json-merge.ts`/`toml-merge.ts`).
 */
export interface NotImplementedTarget {
  kind: "not-implemented";
}

export type ComponentTarget =
  | DirTarget
  | MergeJsonTarget
  | MergeTomlTarget
  | UnsupportedTarget
  | NotImplementedTarget;

const CLAUDE_CODE_DIR_TARGETS: Partial<Record<PluginComponent, string>> = {
  rules: ".claude/rules",
  skills: ".claude/skills",
  commands: ".claude/commands",
  agents: ".claude/agents",
  // Каталог для скриптов самих хуков; регистрация хука (событие -> команда) — отдельный merge-файл, см. ниже.
  hooks: ".claude/hooks",
  scripts: ".claude/scripts",
};

const CLAUDE_CODE_MERGE_TARGETS: Partial<Record<PluginComponent, string>> = {
  hooks: ".claude/settings.json",
  mcp: ".mcp.json",
};

const CODEX_DIR_TARGETS: Partial<Record<PluginComponent, string>> = {
  skills: ".codex/skills",
  scripts: ".codex/scripts",
};

/**
 * Все три merge-компонента Codex сведены в один `.codex/config.toml` (а не
 * заведён отдельный `.codex/hooks.json`, который упоминался в plan.md 2.9
 * как одна из двух рассматривавшихся альтернатив) — меньше файлов для
 * пользователя, единый merge-движок (`toml-merge.ts`) для всех.
 */
const CODEX_MERGE_TARGETS: Partial<Record<PluginComponent, string>> = {
  agents: ".codex/config.toml",
  hooks: ".codex/config.toml",
  mcp: ".codex/config.toml",
};

/**
 * Резолвит место на диске для файла плагина по компоненту, ИИ и флагу
 * `merge` (берётся из метаданных файла в bundle-ответе реестра, plan.md,
 * раздел 0). Путь в результате — относительно корня проекта пользователя.
 *
 * `rules` для Codex — особый случай: единственный компонент, у которого
 * есть содержательный аналог (фрагмент `AGENTS.md`), но нет ни каталога, ни
 * поддерживаемого сейчас merge-формата — поэтому целенаправленно возвращает
 * `not-implemented` независимо от `merge`, до того как появится отдельный
 * merge-движок для markdown-фрагментов.
 */
export function resolveComponentTarget(component: PluginComponent, ai: AiName, merge: boolean): ComponentTarget {
  if (component === "rules" && ai === "codex") {
    return { kind: "not-implemented" };
  }

  if (merge) {
    const relativePath =
      ai === "claude-code" ? CLAUDE_CODE_MERGE_TARGETS[component] : CODEX_MERGE_TARGETS[component];
    if (relativePath === undefined) {
      return { kind: "unsupported" };
    }
    return relativePath.endsWith(".toml")
      ? { kind: "merge-toml", relativePath }
      : { kind: "merge-json", relativePath };
  }

  const relativeDir = ai === "claude-code" ? CLAUDE_CODE_DIR_TARGETS[component] : CODEX_DIR_TARGETS[component];
  if (relativeDir === undefined) {
    return { kind: "unsupported" };
  }
  return { kind: "dir", relativeDir };
}
