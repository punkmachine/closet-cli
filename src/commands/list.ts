import type { Command } from "commander";
import pc from "picocolors";
import semver from "semver";

import { projectConfigExists, readProjectConfig } from "../config/project-config.js";
import type { RegistryClient } from "../registry/types.js";

interface ListCommandOptions {
  all?: boolean;
}

export function registerListCommand(program: Command, registry: RegistryClient): void {
  program
    .command("list")
    .description("List installed items, or all available items with --all")
    .option("--all", "Show all items available in the registry, marking which are installed")
    .action(async (opts: ListCommandOptions) => {
      const projectRoot = process.cwd();

      if (!projectConfigExists(projectRoot)) {
        console.error(pc.red("Проект не инициализирован. Запустите `punk-ai init`."));
        process.exit(1);
      }

      let config;
      try {
        config = readProjectConfig(projectRoot);
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error(pc.red(details));
        process.exit(1);
      }

      if (opts.all) {
        const allItems = await registry.listItems();

        for (const item of allItems) {
          const installed = config.installed[item.name];
          let status: string;

          if (installed) {
            status = pc.green(`[installed@${installed.version}]`);
            if (semver.lt(installed.version, item.version)) {
              status += ` ${pc.yellow(`(доступно обновление до ${item.version})`)}`;
            }
          } else {
            status = pc.dim("[not installed]");
          }

          console.log(
            `${pc.bold(item.name)} ${pc.dim(`(${item.type})`)} v${item.version} — ${item.description} ${status}`,
          );
        }

        return;
      }

      const entries = Object.entries(config.installed);

      if (entries.length === 0) {
        console.log(
          pc.dim("Ничего не установлено. Используйте `punk-ai add <name>` или `punk-ai list --all`."),
        );
        return;
      }

      for (const [name, item] of entries) {
        console.log(
          `${pc.bold(name)} ${pc.dim(`(${item.type})`)} v${item.version} — файлов: ${item.files.length}`,
        );
      }
    });
}
