import pc from "picocolors";

import { resolveToken } from "../config/credentials.js";
import type { ProjectConfig } from "../config/project-config.js";
import { HttpRegistryClient } from "../registry/http-client.js";
import type { PluginBundle } from "../registry/types.js";

/**
 * Создаёт клиент реестра с токеном по приоритету из `resolveToken`.
 *
 * Нет токена — печатает подсказку про `login` и возвращает `undefined` ДО
 * сетевого запроса (вызывающий выставляет `exitCode`). Устаревший токен в
 * `closet-cli.json` работает, но с предупреждением (один раз за запуск).
 */
export function createAuthorizedClient(projectRoot: string, config: ProjectConfig): HttpRegistryClient | undefined {
  const resolved = resolveToken(projectRoot, config.registry.host, config);

  if (!resolved) {
    console.error(
      pc.red(
        `Нет токена для ${config.registry.host}. Выполните \`closet-cli login\` ` +
          "или задайте переменную окружения CLOSET_CLI_TOKEN.",
      ),
    );
    return undefined;
  }

  if (resolved.source === "legacy-project-config") {
    console.warn(
      pc.yellow(
        "⚠ Токен в closet-cli.json устарел и небезопасен (файл коммитится). " +
          "Выполните `closet-cli login` и удалите поле registry.token из файла.",
      ),
    );
  }

  return new HttpRegistryClient(config.registry.host, resolved.token);
}

/**
 * Файлы bundle'а, которых CLI не понимает (реестр новее CLI, `sanitizeBundle`),
 * не роняют установку — пропускаются с предупреждением.
 */
export function warnUnsupportedBundleFiles(bundles: readonly PluginBundle[]): void {
  for (const bundle of bundles) {
    const unsupported = bundle.unsupportedFiles ?? [];
    if (unsupported.length === 0) continue;
    console.warn(
      pc.yellow(
        `⚠ ${bundle.slug}@${bundle.version} — пропущено файлов с неизвестным ИИ/компонентом: ${unsupported.length} ` +
          "(обновите closet-cli: `pnpm add -g @punkdevs/closet-cli@latest`).",
      ),
    );
  }
}
