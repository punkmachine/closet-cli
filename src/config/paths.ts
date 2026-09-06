import path from "node:path";

/**
 * Имя каталога, в котором CLI хранит окружение Claude Code внутри проекта пользователя.
 */
export const CLAUDE_DIR_NAME = ".claude";

/**
 * Имя lock-файла конфигурации punk-ai в корне проекта пользователя.
 */
export const PROJECT_CONFIG_FILE_NAME = ".punk-ai.json";

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
 * Итоговый путь назначения для конкретного файла item'а: либо внутри
 * `.claude/<type>/...` (по умолчанию), либо относительно корня проекта,
 * если передан `options.rootPath` (например, `.mcp.json`, `.claude/scripts/foo.py`).
 *
 * @param relativeFilePath — путь файла относительно `.claude/<type>/`
 * (или относительно корня проекта при `options.rootPath`).
 */
export function itemFileDestPath(
  projectRoot: string,
  type: string,
  relativeFilePath: string,
  options?: { rootPath?: boolean },
): string {
  if (options?.rootPath) {
    return path.join(projectRoot, relativeFilePath);
  }
  return path.join(itemTypeDir(projectRoot, type), relativeFilePath);
}

/**
 * Путь до каталога `.claude/scripts/` (для пользовательских скриптов,
 * например, используемых hooks).
 */
export function scriptsDir(projectRoot: string): string {
  return path.join(claudeDir(projectRoot), "scripts");
}
