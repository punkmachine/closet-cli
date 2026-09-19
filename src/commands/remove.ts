import type { Command } from "commander";
import pc from "picocolors";

import { projectConfigExists, readProjectConfig, writeProjectConfig } from "../config/project-config.js";
import { collectUsedDestPaths, removeTrackedFile } from "../core/removal.js";

interface RemoveCommandOptions {
  all?: boolean;
}

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove [name]")
    .description("Remove an installed plugin, or all installed plugins with --all")
    .option("--all", "Remove all installed plugins")
    .action(async (name: string | undefined, opts: RemoveCommandOptions) => {
      const projectRoot = process.cwd();

      if (!projectConfigExists(projectRoot)) {
        console.error(pc.red("Проект не инициализирован. Запустите `closet-cli init`."));
        process.exit(1);
      }

      let config;
      try {
        config = readProjectConfig(projectRoot);
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }

      if (name && opts.all) {
        console.error(pc.red("Нельзя одновременно указать имя плагина и --all."));
        process.exit(1);
      }

      if (!name && !opts.all) {
        console.error(pc.red("Укажите имя плагина для удаления или используйте --all."));
        process.exit(1);
      }

      let slugsToRemove: string[];
      if (opts.all) {
        slugsToRemove = Object.keys(config.plugins);
      } else {
        const targetSlug = name as string;
        if (!(targetSlug in config.plugins)) {
          console.error(pc.red(`Плагин "${targetSlug}" не установлен.`));
          process.exit(1);
        }
        slugsToRemove = [targetSlug];
      }

      const stillUsed = collectUsedDestPaths(projectRoot, config.plugins, new Set(slugsToRemove));

      interface RemovalSummary {
        slug: string;
        version: string;
        removedCount: number;
        keptCount: number;
        mergedCount: number;
      }

      const summaries: RemovalSummary[] = [];

      for (const slug of slugsToRemove) {
        // slug гарантированно есть в config.plugins (построено из его же ключей выше).
        const plugin = config.plugins[slug]!;
        let removedCount = 0;
        let keptCount = 0;
        let mergedCount = 0;

        for (const file of plugin.files) {
          const status = removeTrackedFile(projectRoot, file, stillUsed);
          if (status === "removed") removedCount += 1;
          else if (status === "kept-shared") keptCount += 1;
          else if (status === "merge-removed") mergedCount += 1;
          // "already-gone" — файл и так отсутствовал на диске, отдельно не считаем.
        }

        summaries.push({ slug, version: plugin.version, removedCount, keptCount, mergedCount });
      }

      for (const slug of slugsToRemove) {
        delete config.plugins[slug];
      }

      writeProjectConfig(projectRoot, config);

      for (const summary of summaries) {
        console.log(pc.green(`✓ Удалён ${summary.slug}@${summary.version}`));
        console.log(pc.dim(`  файлов удалено: ${summary.removedCount}`));
        if (summary.keptCount > 0) {
          console.log(pc.yellow(`  оставлено (используется другим плагином): ${summary.keptCount}`));
        }
        if (summary.mergedCount > 0) {
          console.log(
            pc.yellow(`  ключ удалён из общего файла (сам файл не удалялся целиком): ${summary.mergedCount}`),
          );
        }
      }
    });
}
