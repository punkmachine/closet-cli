import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import semver from "semver";

import { PROJECT_CONFIG_FILE_NAME } from "./paths.js";

/**
 * Компоненты плагина, которые может хранить registry и устанавливать closet-cli.
 *
 * ВАЖНО: этот список продублирован здесь намеренно, а не импортирован из
 * `src/registry/*`, чтобы `config/*` оставался полностью самодостаточным
 * модулем без зависимости от registry. Значения синхронизированы с
 * `PLUGIN_COMPONENTS` на стороне closet-registry.
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

/**
 * Поддерживаемые ИИ-агенты. Список хардкодится в коде CLI, а не тянется с сервера.
 */
export const AI_NAMES = ["codex", "claude-code"] as const;

export type AiName = (typeof AI_NAMES)[number];

/**
 * Схема одного файла в составе установленного плагина.
 *
 * `ai: null` — файл общий для всех ИИ, иначе — ai-специфичный вариант.
 * Обычные (немерджащиеся) файлы отслеживаются по `sha256`; merge-файлы
 * (`.mcp.json`, `.claude/settings.json`, `.codex/config.toml`) — по
 * `mergeKeyPath`/`mergeValue`, без хеша.
 */
export const installedPluginFileSchema = z.object({
  component: z.enum(PLUGIN_COMPONENTS),
  ai: z.enum(AI_NAMES).nullable(),
  path: z.string(),
  sha256: z.string().optional(),
  merge: z.boolean().optional(),
  mergeKeyPath: z.string().optional(),
  mergeValue: z.unknown().optional(),
});

export type InstalledPluginFile = z.infer<typeof installedPluginFileSchema>;

/**
 * Схема одного установленного плагина в `closet-cli.json`.
 */
export const installedPluginSchema = z.object({
  version: z.string().refine((value) => semver.valid(value) !== null, {
    message: "version должен быть валидной semver-версией (например, \"1.2.3\")",
  }),
  autoupdate: z.boolean(),
  files: z.array(installedPluginFileSchema),
});

export type InstalledPlugin = z.infer<typeof installedPluginSchema>;

/**
 * Схема секции `registry`: адрес self-hosted реестра и токен авторизации.
 * Токен опционален в схеме, но сервер сейчас требует Bearer-токен на всех
 * `/v1/*`, так что на практике поле обязательно для непустого реестра.
 */
export const registryConfigSchema = z.object({
  host: z.string().url(),
  token: z.string().optional(),
});

export type RegistryConfig = z.infer<typeof registryConfigSchema>;

/**
 * Схема секции `ai`: какие ИИ-агенты включены в проекте. Ключи ограничены
 * `AI_NAMES` — только `codex`/`claude-code`.
 */
export const aiConfigSchema = z.record(z.enum(AI_NAMES), z.boolean());

export type AiConfig = z.infer<typeof aiConfigSchema>;

/**
 * Схема всего файла `closet-cli.json`.
 */
export const projectConfigSchema = z.object({
  registry: registryConfigSchema,
  ai: aiConfigSchema,
  plugins: z.record(z.string(), installedPluginSchema),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/**
 * Путь до `closet-cli.json` в корне проекта пользователя.
 */
export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_CONFIG_FILE_NAME);
}

/**
 * Синхронно проверяет, существует ли `closet-cli.json` в корне проекта.
 */
export function projectConfigExists(projectRoot: string): boolean {
  return fs.existsSync(projectConfigPath(projectRoot));
}

/**
 * Синхронно читает и валидирует `closet-cli.json`.
 *
 * Бросает понятную ошибку, если файл отсутствует, содержит невалидный JSON
 * или не проходит zod-валидацию.
 */
export function readProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = projectConfigPath(projectRoot);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Файл ${PROJECT_CONFIG_FILE_NAME} не найден в ${projectRoot}. Запустите \`closet-cli init\`.`,
    );
  }

  const raw = fs.readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Файл ${PROJECT_CONFIG_FILE_NAME} повреждён: невалидный JSON (${details}).`);
  }

  const result = projectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Файл ${PROJECT_CONFIG_FILE_NAME} повреждён: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Синхронно сериализует и записывает конфиг в `closet-cli.json`.
 */
export function writeProjectConfig(projectRoot: string, config: ProjectConfig): void {
  const configPath = projectConfigPath(projectRoot);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Создаёт начальный конфиг для команды `init`: без установленных плагинов,
 * с указанным адресом реестра и набором включённых ИИ.
 */
export function createInitialProjectConfig(registry: RegistryConfig, ai: AiConfig): ProjectConfig {
  return {
    registry,
    ai,
    plugins: {},
  };
}
