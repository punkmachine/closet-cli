import type { Command } from "commander";
import pc from "picocolors";

import { projectConfigExists, readProjectConfig, writeProjectConfig } from "../config/project-config.js";
import { ConflictResolutionError, type ConflictMode } from "../core/conflict.js";
import { DependencyResolutionError, resolveDependencies } from "../core/dependency-resolver.js";
import { installItems } from "../core/installer.js";
import type { RegistryClient } from "../registry/types.js";

interface AddCommandOptions {
  force?: boolean;
  skip?: boolean;
}

export function registerAddCommand(program: Command, registry: RegistryClient): void {
  program
    .command("add <name>")
    .description("Install an item and its dependencies from the registry")
    .option("--force", "Overwrite conflicting files without prompting")
    .option("--skip", "Skip conflicting files without prompting")
    .action(async (name: string, opts: AddCommandOptions) => {
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

      const mode: ConflictMode = opts.force ? "force" : opts.skip ? "skip" : "interactive";

      let items;
      try {
        items = await resolveDependencies(registry, [name]);
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

      console.log(pc.green(`Установлено: ${name}`));
      for (const result of results) {
        const isRoot = result.item.name === name;
        const label = `${result.item.name}@${result.item.version}${isRoot ? "" : " (зависимость)"}`;

        if (result.writtenFiles.length > 0) {
          console.log(pc.green(`✓ ${label} — записано файлов: ${result.writtenFiles.length}`));
        }

        if (result.skippedFiles.length > 0) {
          console.log(
            pc.yellow(
              `⚠ ${label} — пропущено файлов (конфликт, оставлены существующие): ${result.skippedFiles.length}`,
            ),
          );
        }
      }
    });
}
