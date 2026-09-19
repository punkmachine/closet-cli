import type { Command } from "commander";
import pc from "picocolors";

import { projectConfigExists, readProjectConfig, writeProjectConfig } from "../config/project-config.js";
import { ConflictResolutionError, type ConflictMode } from "../core/conflict.js";
import { DependencyResolutionError, resolvePluginClosure } from "../core/dependency-resolver.js";
import { installBundles } from "../core/installer.js";
import { HttpRegistryClient } from "../registry/http-client.js";

interface InstallCommandOptions {
  force?: boolean;
  skip?: boolean;
}

export function registerInstallCommand(program: Command, cliVersion: string): void {
  program
    .command("install <slug>")
    .description("Install a plugin and its dependencies from the registry")
    .option("--force", "Overwrite conflicting files without prompting")
    .option("--skip", "Skip conflicting files without prompting")
    .action(async (slug: string, opts: InstallCommandOptions) => {
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

      // Уже установлен — дальше действует защита от затирания пользовательских
      // правок (plan.md, 2.7), которой у install нет: направляем на update.
      if (slug in config.plugins) {
        console.error(pc.red(`Плагин "${slug}" уже установлен. Используйте \`closet-cli update ${slug}\`.`));
        process.exitCode = 1;
        return;
      }

      const registry = new HttpRegistryClient(config.registry.host, config.registry.token);
      const mode: ConflictMode = opts.force ? "force" : opts.skip ? "skip" : "interactive";

      // process.exitCode (не process.exit) начиная отсюда: после ≥2 вызовов
      // fetch (undici) в этом процессе на Windows/Node 24 воспроизводимо
      // падает `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
      // (libuv) при попытке завершить процесс через process.exit() —
      // подтверждено вручную. process.exitCode + естественное завершение
      // event loop этого не triggers.
      let bundles;
      try {
        bundles = await resolvePluginClosure(registry, [slug]);
      } catch (error) {
        if (error instanceof DependencyResolutionError) {
          console.error(pc.red(error.message));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      let results;
      try {
        results = await installBundles(projectRoot, config.ai, bundles, mode);
      } catch (error) {
        if (error instanceof ConflictResolutionError) {
          console.error(pc.red(error.message));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      for (const result of results) {
        config.plugins[result.bundle.slug] = {
          version: result.bundle.version,
          autoupdate: config.plugins[result.bundle.slug]?.autoupdate ?? true,
          files: result.writtenFiles,
        };
      }

      writeProjectConfig(projectRoot, config);

      const rootResult = results.find((r) => r.bundle.slug === slug);
      if (rootResult) {
        try {
          await registry.recordInstall(rootResult.bundle.slug, rootResult.bundle.version, cliVersion);
        } catch (error) {
          console.warn(
            pc.yellow(
              `⚠ Не удалось зафиксировать статистику установки: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }

      console.log(pc.green(`Установлено: ${slug}`));
      for (const result of results) {
        const isRoot = result.bundle.slug === slug;
        const label = `${result.bundle.slug}@${result.bundle.version}${isRoot ? "" : " (зависимость)"}`;

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

        for (const notice of result.notices) {
          const reason =
            notice.reason === "unsupported"
              ? "нет аналога у этого ИИ, пропущен"
              : "аналог есть, но closet-cli пока не умеет его писать, пропущен";
          console.log(pc.dim(`  · ${label}: компонент "${notice.component}" для ${notice.ai} — ${reason}`));
        }
      }
    });
}
