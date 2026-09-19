import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import semver from "semver";

import { projectConfigExists, readProjectConfig, writeProjectConfig } from "../config/project-config.js";
import { ConflictResolutionError, type ConflictMode } from "../core/conflict.js";
import { DependencyResolutionError, resolvePluginClosure } from "../core/dependency-resolver.js";
import { installBundles, isPreviouslyTrackedFileUnchanged, trackedFileIdentityKey } from "../core/installer.js";
import { collectUsedDestPaths, removeTrackedFile } from "../core/removal.js";
import { HttpRegistryClient } from "../registry/http-client.js";

interface UpdateCommandOptions {
  all?: boolean;
  force?: boolean;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update [name]")
    .description("Update an installed plugin (or all with --all) to the latest registry version")
    .option("--all", "Update all installed plugins with autoupdate enabled")
    .option("--force", "Overwrite even files modified by the user")
    .action(async (name: string | undefined, opts: UpdateCommandOptions) => {
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

      if (name && opts.all) {
        console.error(pc.red("Нельзя одновременно указать имя плагина и --all."));
        process.exitCode = 1;
        return;
      }
      if (!name && !opts.all) {
        console.error(pc.red("Укажите имя плагина для обновления или используйте --all."));
        process.exitCode = 1;
        return;
      }

      let targetSlugs: string[];
      if (opts.all) {
        // update --all — только autoupdate:true (plan.md, раздел 4 п.7); update <name> — всегда, ниже.
        targetSlugs = Object.entries(config.plugins)
          .filter(([, plugin]) => plugin.autoupdate)
          .map(([slug]) => slug);
      } else {
        const targetSlug = name as string;
        if (!(targetSlug in config.plugins)) {
          console.error(
            pc.red(`Плагин "${targetSlug}" не установлен, используйте \`closet-cli install ${targetSlug}\`.`),
          );
          process.exitCode = 1;
          return;
        }
        targetSlugs = [targetSlug];
      }

      if (targetSlugs.length === 0) {
        console.log(pc.dim("Нет плагинов для обновления (autoupdate выключен у всех установленных)."));
        return;
      }

      const registry = new HttpRegistryClient(config.registry.host, config.registry.token);

      // process.exitCode (не process.exit) начиная отсюда: после ≥2 вызовов
      // fetch (undici) в этом процессе на Windows/Node 24 воспроизводимо
      // падает `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
      // (libuv) при попытке завершить процесс через process.exit() —
      // подтверждено вручную. process.exitCode + естественное завершение
      // event loop этого не triggers.
      const namesNeedingUpdate: string[] = [];
      for (const slug of targetSlugs) {
        const bundle = await registry.getPluginBundle(slug, "latest");

        if (!bundle) {
          console.warn(pc.yellow(`Плагин "${slug}" больше не найден в registry, пропущен.`));
          continue;
        }

        // slug гарантированно есть в config.plugins (проверено выше).
        const currentVersion = config.plugins[slug]!.version;

        if (!semver.gt(bundle.version, currentVersion)) {
          console.log(pc.dim(`${slug}@${currentVersion} — уже последняя версия.`));
          continue;
        }

        namesNeedingUpdate.push(slug);
      }

      if (namesNeedingUpdate.length === 0) {
        console.log(pc.dim("Обновлений не найдено."));
        return;
      }

      let closureBundles;
      try {
        closureBundles = await resolvePluginClosure(registry, namesNeedingUpdate);
      } catch (error) {
        if (error instanceof DependencyResolutionError) {
          console.error(pc.red(error.message));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      // Плагин обновляется только если НИ ОДИН его отслеживаемый файл не был
      // изменён пользователем с момента установки (plan.md, 2.6/2.7) — иначе
      // весь плагин целиком пропускается (не по файлам, версия одна на плагин
      // и не может остаться в частично согласованном состоянии), с warning.
      const blockedReasons = new Map<string, string[]>();
      for (const bundle of closureBundles) {
        const previous = config.plugins[bundle.slug];
        if (!previous || opts.force) continue;

        const modifiedPaths = previous.files
          .filter((tracked) => !isPreviouslyTrackedFileUnchanged(projectRoot, tracked))
          .map((tracked) => tracked.path);

        if (modifiedPaths.length > 0) {
          blockedReasons.set(bundle.slug, modifiedPaths);
        }
      }

      const bundlesToInstall = closureBundles.filter((bundle) => !blockedReasons.has(bundle.slug));
      const mode: ConflictMode = opts.force ? "force" : "interactive";

      // Файлы, уже принадлежащие этим же плагинам по предыдущей установке и
      // прошедшие проверку "не изменён пользователем" выше — плановая
      // перезапись новой версией, а не столкновение с чужим содержимым.
      // Без этого installBundles ошибочно требовал бы --force на КАЖДЫЙ файл,
      // содержимое которого просто отличается в новой версии плагина.
      const preApprovedKeys = new Set<string>();
      for (const bundle of bundlesToInstall) {
        const previous = config.plugins[bundle.slug];
        if (!previous) continue;
        for (const tracked of previous.files) {
          preApprovedKeys.add(trackedFileIdentityKey(projectRoot, tracked));
        }
      }

      let results;
      try {
        results = await installBundles(projectRoot, config.ai, bundlesToInstall, mode, preApprovedKeys);
      } catch (error) {
        if (error instanceof ConflictResolutionError) {
          console.error(pc.red(error.message));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      const previousVersions = new Map<string, string>();

      for (const result of results) {
        const previous = config.plugins[result.bundle.slug];

        if (previous) {
          previousVersions.set(result.bundle.slug, previous.version);

          // Файлы, которые были в старой версии, но отсутствуют в новой
          // (компонент убрали из плагина) — удаляем той же логикой, что и `remove`.
          const writtenAbsPaths = new Set(result.writtenFiles.map((f) => path.join(projectRoot, f.path)));
          const droppedFiles = previous.files.filter(
            (tracked) => !writtenAbsPaths.has(path.join(projectRoot, tracked.path)),
          );

          if (droppedFiles.length > 0) {
            const stillUsed = collectUsedDestPaths(projectRoot, config.plugins, new Set([result.bundle.slug]));
            for (const dropped of droppedFiles) {
              removeTrackedFile(projectRoot, dropped, stillUsed);
            }
          }
        }

        config.plugins[result.bundle.slug] = {
          version: result.bundle.version,
          autoupdate: previous?.autoupdate ?? true,
          files: result.writtenFiles,
        };
      }

      writeProjectConfig(projectRoot, config);

      for (const [slug, modifiedPaths] of blockedReasons) {
        console.warn(
          pc.yellow(
            `⚠ ${slug} — обновление пропущено, изменены вручную: ${modifiedPaths.join(", ")}. Используйте --force для перезаписи.`,
          ),
        );
      }

      for (const result of results) {
        const previousVersion = previousVersions.get(result.bundle.slug);
        const skippedSuffix =
          result.skippedFiles.length > 0 ? `, ${result.skippedFiles.length} пропущено` : "";

        if (previousVersion) {
          console.log(
            pc.green(
              `✓ ${result.bundle.slug}: ${previousVersion} → ${result.bundle.version} (${result.writtenFiles.length} файлов записано${skippedSuffix})`,
            ),
          );
        } else {
          console.log(
            pc.green(
              `✓ ${result.bundle.slug}@${result.bundle.version} (новая зависимость) — записано файлов: ${result.writtenFiles.length}${skippedSuffix}`,
            ),
          );
        }
      }
    });
}
