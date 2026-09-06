import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import semver from "semver";

import { PROJECT_CONFIG_FILE_NAME } from "./paths.js";

/**
 * Типы items, которые может хранить registry и устанавливать punk-ai.
 *
 * ВАЖНО: этот список продублирован здесь намеренно, а не импортирован из
 * `src/registry/*`, чтобы `config/*` оставался полностью самодостаточным
 * модулем без зависимости от registry.
 */
export const ITEM_TYPES = ["rules", "skills", "commands", "agents", "hooks", "mcp", "statusline"] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/**
 * Схема одного файла в составе установленного item'а. `rootPath`/`merge`
 * зеркалят одноимённые поля `ItemFile` из `src/registry/types.ts` — они
 * нужны здесь, чтобы `remove` мог заново вычислить путь назначения файла
 * и определить, что merge-файлы (например, `.claude/settings.json`) нельзя
 * удалять целиком, не имея доступа к registry.
 */
export const installedFileSchema = z.object({
  path: z.string(),
  rootPath: z.boolean().optional(),
  merge: z.boolean().optional(),
});

export type InstalledFile = z.infer<typeof installedFileSchema>;

/**
 * Схема одной установленной записи в `.punk-ai.json`.
 */
export const installedItemSchema = z.object({
  type: z.enum(ITEM_TYPES),
  version: z.string().refine((value) => semver.valid(value) !== null, {
    message: "version должен быть валидной semver-версией (например, \"1.2.3\")",
  }),
  files: z.array(installedFileSchema),
});

export type InstalledItem = z.infer<typeof installedItemSchema>;

/**
 * Схема всего файла `.punk-ai.json`.
 */
export const projectConfigSchema = z.object({
  registryUrl: z.string().url(),
  installed: z.record(z.string(), installedItemSchema),
  createdAt: z.string().datetime(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/**
 * Путь до `.punk-ai.json` в корне проекта пользователя.
 */
export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_CONFIG_FILE_NAME);
}

/**
 * Синхронно проверяет, существует ли `.punk-ai.json` в корне проекта.
 */
export function projectConfigExists(projectRoot: string): boolean {
  return fs.existsSync(projectConfigPath(projectRoot));
}

/**
 * Синхронно читает и валидирует `.punk-ai.json`.
 *
 * Бросает понятную ошибку, если файл отсутствует, содержит невалидный JSON
 * или не проходит zod-валидацию.
 */
export function readProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = projectConfigPath(projectRoot);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Файл ${PROJECT_CONFIG_FILE_NAME} не найден в ${projectRoot}. Запустите \`punk-ai init\`.`,
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
 * Синхронно сериализует и записывает конфиг в `.punk-ai.json`.
 */
export function writeProjectConfig(projectRoot: string, config: ProjectConfig): void {
  const configPath = projectConfigPath(projectRoot);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Создаёт начальный конфиг для команды `init`: пустой `installed` и
 * `createdAt`, выставленный в текущий момент времени.
 */
export function createInitialProjectConfig(registryUrl: string): ProjectConfig {
  return {
    registryUrl,
    installed: {},
    createdAt: new Date().toISOString(),
  };
}
