import type { Command } from "commander";
import pc from "picocolors";
import semver from "semver";

import { projectConfigExists, readProjectConfig } from "../config/project-config.js";
import { HttpRegistryClient } from "../registry/http-client.js";

interface ListCommandOptions {
  all?: boolean;
}

/**
 * `closet-cli list` под новую bundle-модель (plan.md, раздел 3 п.2).
 *
 * Решение по архитектуре: без `--all` команда читает ТОЛЬКО локальное
 * состояние `closet-cli.json` (`config.plugins`) — сети не требуется.
 * `--all` требует знать обо всех опубликованных в реестре плагинах, что
 * принципиально невозможно из одного локального состояния — под это
 * добавлен эндпоинт `GET /v1/plugins` на `closet-registry` (листинг
 * slug + latest semver по всем неудалённым плагинам, без содержимого
 * файлов — полный bundle каждой версии для листинга не нужен и был бы
 * избыточно дорогим запросом). См. `closet-cli/CLAUDE.md`/`closet-registry/CLAUDE.md`.
 */
export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List installed plugins, or all plugins available in the registry with --all")
    .option("--all", "Show all plugins available in the registry, marking which are installed")
    .action(async (opts: ListCommandOptions) => {
      const projectRoot = process.cwd();

      if (!projectConfigExists(projectRoot)) {
        console.error(pc.red("Проект не инициализирован. Запустите `closet-cli init`."));
        process.exitCode = 1;
        return;
      }

      let config;
      try {
        config = readProjectConfig(projectRoot);
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
        return;
      }

      if (opts.all) {
        const registry = new HttpRegistryClient(config.registry.host, config.registry.token);

        let items;
        try {
          items = await registry.listPlugins();
        } catch (error) {
          console.error(pc.red(error instanceof Error ? error.message : String(error)));
          process.exitCode = 1;
          return;
        }

        if (items.length === 0) {
          console.log(pc.dim("В реестре пока нет опубликованных плагинов."));
          return;
        }

        for (const item of items) {
          const installed = config.plugins[item.slug];
          let status: string;

          if (installed) {
            status = pc.green(`[installed@${installed.version}]`);
            if (semver.lt(installed.version, item.latestVersion)) {
              status += ` ${pc.yellow(`(доступно обновление до ${item.latestVersion})`)}`;
            }
          } else {
            status = pc.dim("[not installed]");
          }

          console.log(`${pc.bold(item.slug)} v${item.latestVersion} — ${item.description} ${status}`);
        }

        return;
      }

      const entries = Object.entries(config.plugins);

      if (entries.length === 0) {
        console.log(
          pc.dim("Ничего не установлено. Используйте `closet-cli install <slug>` или `closet-cli list --all`."),
        );
        return;
      }

      for (const [slug, plugin] of entries) {
        const autoupdate = plugin.autoupdate ? pc.dim("(autoupdate)") : pc.dim("(autoupdate выключен)");
        console.log(`${pc.bold(slug)} v${plugin.version} — файлов: ${plugin.files.length} ${autoupdate}`);
      }
    });
}
