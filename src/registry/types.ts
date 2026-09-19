/**
 * Контракт HTTP-реестра closet-registry (plan.md, раздел 0): единый
 * bundle-эндпоинт `GET /v1/plugins/:slug/:version`, `:version` может быть
 * `"latest"`. Один запрос отдаёт метаданные версии плагина + содержимое
 * ВСЕХ его файлов сразу (текст как есть, бинарные — base64).
 *
 * `PluginComponent`/`AiName` продублированы здесь намеренно, а не
 * импортированы из `src/config/project-config.ts` — см. конвенцию
 * "изоляция модулей" в `CLAUDE.md`. Значения синхронизированы с
 * `PLUGIN_COMPONENTS`/`PLUGIN_FILE_AI_VALUES` на стороне closet-registry.
 */
export const PLUGIN_COMPONENTS = [
  "mcp",
  "rules",
  "hooks",
  "agents",
  "commands",
  "skills",
  "scripts",
] as const;

export type PluginComponent = (typeof PLUGIN_COMPONENTS)[number];

export const AI_NAMES = ["codex", "claude-code"] as const;

export type AiName = (typeof AI_NAMES)[number];

export interface PluginBundleFile {
  component: PluginComponent;
  /** `null` — файл общий для всех ИИ, иначе — ai-специфичный вариант. */
  ai: AiName | null;
  /** Путь файла внутри своего компонента на сервере (не путь назначения на диске клиента). */
  relativePath: string;
  /**
   * Присутствует в контракте сервера, но НЕ используется closet-cli: место
   * файла на диске клиента полностью определяется `core/path-mapper.ts`
   * (component × ai × merge), а не этим флагом — решение уже закреплено
   * реализацией path-mapper.ts, см. CLAUDE.md.
   */
  rootPath: boolean;
  merge: boolean;
  mergeKeyPath: string | null;
  /** Если true — литерал `{{projectRoot}}` в `content` заменяется на абсолютный путь проекта перед использованием. */
  template: boolean;
  sha256: string;
  sizeBytes: string;
  encoding: "utf8" | "base64";
  content: string;
}

export interface PluginBundle {
  slug: string;
  description: string;
  version: string;
  changelog: string | null;
  /** Slug'и зависимостей — без версии, зависимость резолвится всегда на "latest" (plan.md, раздел 0/4 п.9). */
  dependencies: string[];
  files: PluginBundleFile[];
}

/**
 * Один элемент листинга `GET /v1/plugins` (plan.md, раздел 3 п.2) — только
 * метаданные, без файлов: для `list --all` не нужен полный bundle каждой
 * версии, только slug + latest semver, чтобы сравнить с локальным состоянием.
 */
export interface PluginListItem {
  slug: string;
  description: string;
  latestVersion: string;
  updatedAt: string;
}

export interface RegistryClient {
  /**
   * `version` — конкретный semver либо `"latest"`. `undefined`, если плагин
   * или указанная версия не найдены (сервер отвечает 404).
   */
  getPluginBundle(slug: string, version: string): Promise<PluginBundle | undefined>;
  /**
   * Фиксирует факт установки версии плагина на сервере (статистика,
   * `POST /v1/stats/installs`). Не критично для успеха install/update —
   * вызывающий код сам решает, насколько мягко обрабатывать ошибку.
   */
  recordInstall(slug: string, version: string, cliVersion: string): Promise<void>;
  /**
   * Все опубликованные плагины реестра (`GET /v1/plugins`) — используется
   * только `closet-cli list --all`.
   */
  listPlugins(): Promise<PluginListItem[]>;
}
