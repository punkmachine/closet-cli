import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";

import { claudeDir, itemTypeDir, scriptsDir } from "../config/paths.js";
import {
  createInitialProjectConfig,
  projectConfigExists,
  writeProjectConfig,
} from "../config/project-config.js";

/**
 * Типы items, для которых `init` создаёт пустые каталоги внутри `.claude/`.
 *
 * Список продублирован здесь намеренно (а не импортирован из `src/registry/types.ts`),
 * чтобы команда `init` оставалась самодостаточной и не тянула лишнюю зависимость на registry.
 */
const ITEM_TYPE_DIRS = ["rules", "skills", "commands", "agents", "hooks"] as const;

const GITIGNORE_ENTRY = ".claude/settings.local.json";

interface InitCommandOptions {
  force?: boolean;
  registryUrl: string;
}

/**
 * Копирует файл шаблона из `templatesDir/<templateName>` в `destPath`.
 */
function copyTemplateFile(templatesDir: string, templateName: string, destPath: string): void {
  const srcPath = path.join(templatesDir, templateName);
  const content = fs.readFileSync(srcPath, "utf-8");
  fs.writeFileSync(destPath, content, "utf-8");
}

/**
 * Создаёт `.gitignore` в корне проекта (если его нет) либо дописывает в него
 * запись `.claude/settings.local.json`, если её там ещё нет.
 */
function ensureGitignoreEntry(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`, "utf-8");
    return;
  }

  const content = fs.readFileSync(gitignorePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const alreadyPresent = lines.some((line) => line === GITIGNORE_ENTRY);

  if (alreadyPresent) {
    return;
  }

  const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
  const suffix = `${needsLeadingNewline ? "\n" : ""}${GITIGNORE_ENTRY}\n`;
  fs.appendFileSync(gitignorePath, suffix, "utf-8");
}

export function registerInitCommand(
  program: Command,
  templatesDir: string,
  registryUrl: string,
): void {
  program
    .command("init")
    .description("Initialize .claude/ environment in the current project")
    .option("--force", "Overwrite existing .claude/ and .punk-ai.json")
    .option("--registry-url <url>", "Registry URL to store in .punk-ai.json", registryUrl)
    .action(async (opts: InitCommandOptions) => {
      const projectRoot = process.cwd();

      const alreadyInitialized =
        fs.existsSync(claudeDir(projectRoot)) || projectConfigExists(projectRoot);

      if (alreadyInitialized && !opts.force) {
        console.error(
          pc.red(
            "Проект уже инициализирован (найден .claude/ или .punk-ai.json). " +
              "Используйте --force для повторной инициализации.",
          ),
        );
        process.exit(1);
      }

      try {
        // 1. Структура .claude/<type>/
        for (const type of ITEM_TYPE_DIRS) {
          fs.mkdirSync(itemTypeDir(projectRoot, type), { recursive: true });
        }

        // 2. Бандл-шаблоны
        copyTemplateFile(templatesDir, "CLAUDE.md", path.join(projectRoot, "CLAUDE.md"));
        copyTemplateFile(
          templatesDir,
          "settings.json",
          path.join(claudeDir(projectRoot), "settings.json"),
        );
        copyTemplateFile(
          templatesDir,
          "settings.local.json",
          path.join(claudeDir(projectRoot), "settings.local.json"),
        );

        fs.mkdirSync(scriptsDir(projectRoot), { recursive: true });
        copyTemplateFile(
          templatesDir,
          "scripts-readme.md",
          path.join(scriptsDir(projectRoot), "README.md"),
        );

        // 3. .mcp.json
        copyTemplateFile(templatesDir, "mcp.json", path.join(projectRoot, ".mcp.json"));

        // 4. .punk-ai.json
        writeProjectConfig(projectRoot, createInitialProjectConfig(opts.registryUrl));

        // 5. .gitignore
        ensureGitignoreEntry(projectRoot);
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error(pc.red(`Не удалось инициализировать проект: ${details}`));
        process.exit(1);
      }

      console.log(pc.green("Проект успешно инициализирован."));
      console.log(pc.green("Создано:"));
      console.log(pc.green("  .claude/{rules,skills,commands,agents,hooks}/"));
      console.log(pc.green("  .claude/settings.json"));
      console.log(pc.green("  .claude/settings.local.json"));
      console.log(pc.green("  CLAUDE.md"));
      console.log(pc.green("  .claude/scripts/README.md"));
      console.log(pc.green("  .mcp.json"));
      console.log(pc.green("  .punk-ai.json"));
      console.log(pc.green("  .gitignore (обновлён при необходимости)"));
    });
}
