import type { Command } from "commander";
import pc from "picocolors";
import semver from "semver";

import { projectConfigExists, readProjectConfig, writeProjectConfig } from "../config/project-config.js";
import { ConflictResolutionError, type ConflictMode } from "../core/conflict.js";
import { DependencyResolutionError, resolveDependencies } from "../core/dependency-resolver.js";
import { installItems } from "../core/installer.js";
import type { RegistryClient } from "../registry/types.js";

interface UpdateCommandOptions {
  all?: boolean;
  force?: boolean;
  skip?: boolean;
}

export function registerUpdateCommand(program: Command, registry: RegistryClient): void {
  program
    .command("update [name]")
    .description("Update an installed item (or all with --all) to the latest registry version")
    .option("--all", "Update all installed items")
    .option("--force", "Overwrite conflicting files without prompting")
    .option("--skip", "Skip conflicting files without prompting")
    .action(async (name: string | undefined, opts: UpdateCommandOptions) => {
      if (opts.force && opts.skip) {
        console.error(pc.red("Нельзя одновременно указать --force и --skip."));
        process.exit(1);
      }

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

      let targetNames: string[];
      if (opts.all) {
        targetNames = Object.keys(config.installed);
      } else {
        const targetName = name as string;
        if (!(targetName in config.installed)) {
          console.error(
            pc.red(`Item "${targetName}" не установлен, используйте \`punk-ai add ${targetName}\`.`),
          );
          process.exit(1);
        }
        targetNames = [targetName];
      }

      const namesNeedingUpdate: string[] = [];

      for (const targetName of targetNames) {
        const latest = await registry.getItem(targetName);

        if (!latest) {
          console.warn(pc.yellow(`Item "${targetName}" больше не найден в registry, пропущен.`));
          continue;
        }

        // targetName гарантированно есть в config.installed (проверено выше).
        const currentVersion = config.installed[targetName]!.version;

        if (!semver.gt(latest.version, currentVersion)) {
          console.log(pc.dim(`${targetName}@${currentVersion} — уже последняя версия.`));
          continue;
        }

        namesNeedingUpdate.push(targetName);
      }

      if (namesNeedingUpdate.length === 0) {
        console.log(pc.dim("Обновлений не найдено."));
        return;
      }

      const mode: ConflictMode = opts.force ? "force" : opts.skip ? "skip" : "interactive";

      let items;
      try {
        items = await resolveDependencies(registry, namesNeedingUpdate);
      } catch (error) {
        if (error instanceof DependencyResolutionError) {
          console.error(pc.red(error.message));
          process.exit(1);
        }
        throw error;
      }

      let results;
      try {
        results = await installItems(projectRoot, registry, items, mode);
      } catch (error) {
        if (error instanceof ConflictResolutionError) {
          console.error(pc.red(error.message));
          process.exit(1);
        }
        throw error;
      }

      const previousVersions = new Map<string, string>();
      for (const itemName of namesNeedingUpdate) {
        // itemName пришёл из targetNames, гарантированно есть в config.installed.
        previousVersions.set(itemName, config.installed[itemName]!.version);
      }

      for (const result of results) {
        config.installed[result.item.name] = {
          type: result.item.type,
          version: result.item.version,
          files: result.item.files.map((f) => ({
            path: f.path,
            rootPath: f.rootPath,
            merge: f.merge,
          })),
        };
      }

      writeProjectConfig(projectRoot, config);

      for (const result of results) {
        const previousVersion = previousVersions.get(result.item.name);
        const skippedSuffix =
          result.skippedFiles.length > 0 ? `, ${result.skippedFiles.length} пропущено` : "";

        if (previousVersion) {
          console.log(
            pc.green(
              `✓ ${result.item.name}: ${previousVersion} → ${result.item.version} (${result.writtenFiles.length} файлов записано${skippedSuffix})`,
            ),
          );
        } else {
          console.log(
            pc.green(
              `✓ ${result.item.name}@${result.item.version} (новая зависимость) — записано файлов: ${result.writtenFiles.length}${skippedSuffix}`,
            ),
          );
        }
      }
    });
}
