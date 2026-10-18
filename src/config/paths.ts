import path from "node:path";

/**
 * Имя каталога, в котором CLI хранит окружение Claude Code внутри проекта пользователя.
 */
export const CLAUDE_DIR_NAME = ".claude";

/**
 * Имя файла конфигурации closet-cli в корне проекта пользователя.
 * Без ведущей точки — файл коммитится в репозиторий (токен в него не пишется,
 * персональные данные лежат в `closet-cli.local.json`, см. `config/credentials.ts`).
 */
export const PROJECT_CONFIG_FILE_NAME = "closet-cli.json";

/**
 * Имя локального файла с токенами реестров в корне проекта. Не коммитится:
 * `closet-cli` сам добавляет его в `.gitignore`.
 */
export const LOCAL_CONFIG_FILE_NAME = "closet-cli.local.json";

/** Переменная окружения: токен реестра для CI и разовых запусков. */
export const TOKEN_ENV_VAR = "CLOSET_CLI_TOKEN";

/**
 * Путь до каталога `.claude/` внутри проекта пользователя.
 */
export function claudeDir(projectRoot: string): string {
  return path.join(projectRoot, CLAUDE_DIR_NAME);
}

/**
 * Путь до каталога конкретного типа items внутри `.claude/` (например `.claude/rules`).
 *
 * `type` намеренно типизирован как `string`, а не как `ItemType` из `registry/*`,
 * чтобы этот модуль оставался самодостаточным и не зависел от registry.
 */
export function itemTypeDir(projectRoot: string, type: string): string {
  return path.join(claudeDir(projectRoot), type);
}

/**
 * Путь до каталога `.claude/scripts/` (для пользовательских скриптов,
 * например, используемых hooks).
 */
export function scriptsDir(projectRoot: string): string {
  return path.join(claudeDir(projectRoot), "scripts");
}
