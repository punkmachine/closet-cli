import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";

import { itemFileDestPath } from "../config/paths.js";
import { projectConfigExists, readProjectConfig, writeProjectConfig } from "../config/project-config.js";

interface RemoveCommandOptions {
  all?: boolean;
}

/**
 * Пытается удалить файл с диска и, если после этого родительская директория
 * стала пустой, удалить и её. Не критично, если не получится (например,
 * недостаточно прав) — тогда просто молча пропускаем уборку директории.
 */
function removeFileAndCleanupDir(destPath: string): void {
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath);
  }

  try {
    const dir = path.dirname(destPath);
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // Уборка директории не критична — молча игнорируем.
  }
}

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove [name]")
    .description("Remove an installed item, or all installed items with --all")
    .option("--all", "Remove all installed items")
    .action(async (name: string | undefined, opts: RemoveCommandOptions) => {
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

      if (name && opts.all) {
        console.error(pc.red("Нельзя одновременно указать имя item'а и --all."));
        process.exit(1);
      }

      if (!name && !opts.all) {
        console.error(pc.red("Укажите имя item'а для удаления или используйте --all."));
        process.exit(1);
      }

      let namesToRemove: string[];
      if (opts.all) {
        namesToRemove = Object.keys(config.installed);
      } else {
        const targetName = name as string;
        if (!(targetName in config.installed)) {
          console.error(pc.red(`Item "${targetName}" не установлен.`));
          process.exit(1);
        }
        namesToRemove = [targetName];
      }

      const remainingEntries = Object.entries(config.installed).filter(
        ([n]) => !namesToRemove.includes(n),
      );

      const usedDestPaths = new Set<string>();
      for (const [, item] of remainingEntries) {
        for (const f of item.files) {
          usedDestPaths.add(itemFileDestPath(projectRoot, item.type, f.path, { rootPath: f.rootPath }));
        }
      }

      interface RemovalSummary {
        name: string;
        version: string;
        removedCount: number;
        keptCount: number;
        mergedCount: number;
      }

      const summaries: RemovalSummary[] = [];

      const entriesToRemove = Object.entries(config.installed).filter(([n]) =>
        namesToRemove.includes(n),
      );

      for (const [nameToRemove, item] of entriesToRemove) {
        let removedCount = 0;
        let keptCount = 0;
        let mergedCount = 0;

        for (const f of item.files) {
          // merge-файлы (например .claude/settings.json) содержат ключи от
          // нескольких источников — punk-ai не удаляет их целиком, только
          // прекращает отслеживать.
          if (f.merge) {
            mergedCount += 1;
            continue;
          }

          const destPath = itemFileDestPath(projectRoot, item.type, f.path, {
            rootPath: f.rootPath,
          });

          if (usedDestPaths.has(destPath)) {
            keptCount += 1;
            continue;
          }

          removeFileAndCleanupDir(destPath);
          removedCount += 1;
        }

        summaries.push({ name: nameToRemove, version: item.version, removedCount, keptCount, mergedCount });
      }

      for (const nameToRemove of namesToRemove) {
        delete config.installed[nameToRemove];
      }

      writeProjectConfig(projectRoot, config);

      for (const summary of summaries) {
        console.log(pc.green(`✓ Удалён ${summary.name}@${summary.version}`));
        console.log(pc.dim(`  файлов удалено: ${summary.removedCount}`));
        if (summary.keptCount > 0) {
          console.log(
            pc.yellow(`  оставлено (используется другим item'ом): ${summary.keptCount}`),
          );
        }
        if (summary.mergedCount > 0) {
          console.log(
            pc.yellow(
              `  оставлено (изменяет общий файл, не удаляется целиком): ${summary.mergedCount}`,
            ),
          );
        }
      }
    });
}
