import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";

import {
  projectConfigExists,
  readProjectConfig,
  writeProjectConfig,
  type InstalledPluginFile,
} from "../config/project-config.js";
import { ConflictResolutionError, type ConflictMode } from "../core/conflict.js";
import { collectRecordedCopies, projectRecords } from "../core/sync.js";

interface SyncCommandOptions {
  force?: boolean;
  skip?: boolean;
}

/**
 * `closet-cli sync` (PLAN.md, §4): заново проецирует `.agents/` → папки
 * harness'ов по `closet-cli.json`. Нужна после ручной правки `.agents/`,
 * свежего clone без копий или включения нового harness'а в проекте.
 * Односторонняя; расхождения копий разрешаются как конфликты.
 */
export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Re-copy files from .agents/ into harness folders (.claude/, .codex/)")
    .option("--force", "Overwrite copies modified by hand without prompting")
    .option("--skip", "Skip copies modified by hand without prompting")
    .action(async (opts: SyncCommandOptions) => {
      if (opts.force && opts.skip) {
        console.error(pc.red("Нельзя одновременно указать --force и --skip."));
        process.exitCode = 1;
        return;
      }

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

      if (config.layout !== "agents") {
        console.error(
          pc.red("sync работает только с раскладкой `agents` (хранилище .agents/); в closet-cli.json её нет (legacy)."),
        );
        process.exitCode = 1;
        return;
      }

      const mode: ConflictMode = opts.force ? "force" : opts.skip ? "skip" : "interactive";

      const records: InstalledPluginFile[] = [];
      const missingInStorage: string[] = [];
      for (const plugin of Object.values(config.plugins)) {
        for (const file of plugin.files) {
          if (file.merge) continue;
          if (fs.existsSync(path.join(projectRoot, file.path))) {
            records.push(file);
          } else {
            missingInStorage.push(file.path);
          }
        }
      }

      let projection;
      try {
        projection = await projectRecords(projectRoot, config.ai, records, mode, collectRecordedCopies(config.plugins));
      } catch (error) {
        if (error instanceof ConflictResolutionError) {
          console.error(pc.red(error.message));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      let copiesCount = 0;
      for (const [record, copies] of projection.copies) {
        copiesCount += copies.length;
        if (copies.length > 0) {
          record.copies = copies;
        } else {
          delete record.copies;
        }
      }

      writeProjectConfig(projectRoot, config);

      const skippedPaths = [...new Set([...projection.skipped.values()].flat())];

      console.log(pc.green(`✓ Копий синхронизировано: ${copiesCount}`));

      if (skippedPaths.length > 0) {
        console.log(
          pc.yellow(
            `⚠ Копии изменены вручную и не перезаписаны (правки вносите в .agents/): ${skippedPaths.join(", ")}`,
          ),
        );
      }
      if (missingInStorage.length > 0) {
        console.log(
          pc.yellow(
            `⚠ Нет в хранилище (удалены вручную), пропущены: ${missingInStorage.join(", ")}. ` +
              "Восстановите их, переустановив плагин (`closet-cli remove` + `closet-cli install`).",
          ),
        );
      }
    });
}
