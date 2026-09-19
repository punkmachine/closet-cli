import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import * as p from "@clack/prompts";

import { claudeDir, itemTypeDir, scriptsDir } from "../config/paths.js";
import {
  AI_NAMES,
  type AiConfig,
  type AiName,
  createInitialProjectConfig,
  projectConfigExists,
  type RegistryConfig,
  writeProjectConfig,
} from "../config/project-config.js";

/**
 * Типы items Claude Code, для которых `init` создаёт пустые каталоги внутри `.claude/`.
 *
 * Список продублирован здесь намеренно (а не импортирован из `src/registry/types.ts`),
 * чтобы команда `init` оставалась самодостаточной и не тянула лишнюю зависимость на registry.
 */
const CLAUDE_ITEM_TYPE_DIRS = ["rules", "skills", "commands", "agents", "hooks"] as const;

const CODEX_DIR_NAME = ".codex";

/**
 * Компоненты Codex, у которых есть выделенный каталог на диске (см. plan.md, 2.9).
 * Остальные компоненты (`rules`/`agents`/`hooks`/`mcp`) — merge-записи в
 * `AGENTS.md`/`.codex/config.toml`, отдельного каталога не требуют.
 * `commands` у Codex не имеет аналога вовсе.
 */
const CODEX_SUBDIRS_WITH_FOLDER = ["skills", "scripts"] as const;

const GITIGNORE_ENTRY = ".claude/settings.local.json";

const AI_LABELS: Record<AiName, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

interface InitCommandOptions {
  force?: boolean;
  yes?: boolean;
  host?: string;
  token?: string;
  ai?: string;
  agentsMd?: boolean;
}

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function isValidHost(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parseAiFlag(value: string): AiName[] {
  const names = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (names.length === 0) {
    fail("Флаг --ai не может быть пустым.");
  }

  const result: AiName[] = [];
  for (const name of names) {
    if (!(AI_NAMES as readonly string[]).includes(name)) {
      fail(`Неизвестный ИИ "${name}" в --ai. Допустимые значения: ${AI_NAMES.join(", ")}.`);
    }
    result.push(name as AiName);
  }
  return result;
}

/**
 * Резолвит секцию `registry` конфига: из флагов, интерактивным диалогом
 * либо ошибкой, если ни того ни другого не хватает (та же TTY-дисциплина,
 * что в `core/conflict.ts`: без TTY и без нужных флагов — явная ошибка,
 * а не тихий дефолт).
 */
async function resolveRegistryConfig(
  opts: InitCommandOptions,
  interactive: boolean,
): Promise<RegistryConfig> {
  let host = opts.host;
  if (host !== undefined && !isValidHost(host)) {
    fail(`--host "${host}" не является корректным URL.`);
  }

  if (host === undefined) {
    if (opts.yes) {
      fail("--host обязателен при использовании --yes.");
    }
    if (!interactive) {
      fail(
        "Registry host не указан, а интерактивный промпт недоступен (нет TTY). " +
          "Используйте --host <url>.",
      );
    }

    const answer = await p.text({
      message: "Адрес closet-registry (host)",
      placeholder: "https://registry.example.com",
      validate(value) {
        if (value.length === 0) return "Host обязателен.";
        if (!isValidHost(value)) return "Некорректный URL.";
      },
    });

    if (p.isCancel(answer)) {
      p.cancel("Инициализация отменена.");
      process.exit(0);
    }
    host = answer;
  }

  let token = opts.token;
  if (token === undefined && !opts.yes && interactive) {
    const answer = await p.text({
      message: "Токен реестра (Authorization: Bearer)",
      placeholder: "оставьте пустым, если не нужен",
    });

    if (p.isCancel(answer)) {
      p.cancel("Инициализация отменена.");
      process.exit(0);
    }
    token = answer.length > 0 ? answer : undefined;
  }

  return token === undefined ? { host } : { host, token };
}

/**
 * Резолвит секцию `ai`: набор включённых ИИ-агентов. Хранит явные `true`/`false`
 * для всех `AI_NAMES`, а не только выбранные — формат совпадает с примером
 * из plan.md (2.3).
 */
async function resolveAiConfig(opts: InitCommandOptions, interactive: boolean): Promise<AiConfig> {
  let selected: AiName[];

  if (opts.ai !== undefined) {
    selected = parseAiFlag(opts.ai);
  } else if (opts.yes) {
    selected = [...AI_NAMES];
  } else if (interactive) {
    const answer = await p.multiselect({
      message: "Какие ИИ-агенты включить в проекте?",
      options: AI_NAMES.map((name) => ({ value: name, label: AI_LABELS[name] })),
      initialValues: [...AI_NAMES],
      required: true,
    });

    if (p.isCancel(answer)) {
      p.cancel("Инициализация отменена.");
      process.exit(0);
    }
    selected = answer as AiName[];
  } else {
    fail("Не указаны ИИ-агенты, а интерактивный промпт недоступен (нет TTY). Используйте --ai codex,claude-code.");
  }

  const ai = {} as AiConfig;
  for (const name of AI_NAMES) {
    ai[name] = selected.includes(name);
  }
  return ai;
}

/**
 * Резолвит, нужно ли генерировать корневой `AGENTS.md` + файлы-мосты.
 * Подчинено правилу «либо весь комплект, либо ничего» (plan.md, 2.5).
 */
async function resolveGenerateAgentsMd(
  opts: InitCommandOptions,
  interactive: boolean,
): Promise<boolean> {
  if (opts.agentsMd !== undefined) return opts.agentsMd;
  if (opts.yes) return true;
  if (!interactive) {
    fail(
      "Не указано, генерировать ли AGENTS.md, а интерактивный промпт недоступен (нет TTY). " +
        "Используйте --agents-md/--no-agents-md.",
    );
  }

  const answer = await p.confirm({
    message: "Сгенерировать корневой AGENTS.md (+ файл-мост CLAUDE.md)?",
    initialValue: true,
  });

  if (p.isCancel(answer)) {
    p.cancel("Инициализация отменена.");
    process.exit(0);
  }
  return answer;
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
 * Как `copyTemplateFile`, но не трогает файл, если он уже существует.
 * Используется для `AGENTS.md`/`CLAUDE.md`: повторный
 * `init --force` не должен затирать уже существующий контент — только
 * досоздавать недостающие файлы-мосты (plan.md, 2.5).
 */
function copyTemplateFileIfMissing(
  templatesDir: string,
  templateName: string,
  destPath: string,
): boolean {
  if (fs.existsSync(destPath)) return false;
  copyTemplateFile(templatesDir, templateName, destPath);
  return true;
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

function setupClaudeCode(projectRoot: string, templatesDir: string): void {
  for (const type of CLAUDE_ITEM_TYPE_DIRS) {
    fs.mkdirSync(itemTypeDir(projectRoot, type), { recursive: true });
  }

  copyTemplateFile(templatesDir, "settings.json", path.join(claudeDir(projectRoot), "settings.json"));
  copyTemplateFile(
    templatesDir,
    "settings.local.json",
    path.join(claudeDir(projectRoot), "settings.local.json"),
  );

  fs.mkdirSync(scriptsDir(projectRoot), { recursive: true });

  copyTemplateFile(templatesDir, "mcp.json", path.join(projectRoot, ".mcp.json"));

  ensureGitignoreEntry(projectRoot);
}

function setupCodex(projectRoot: string): void {
  const codexRoot = path.join(projectRoot, CODEX_DIR_NAME);
  fs.mkdirSync(codexRoot, { recursive: true });
  for (const sub of CODEX_SUBDIRS_WITH_FOLDER) {
    fs.mkdirSync(path.join(codexRoot, sub), { recursive: true });
  }
}

/**
 * Создаёт корневой `AGENTS.md` и файлы-мосты для выбранных ИИ. Ничего не
 * перезаписывает — только досоздаёт недостающее. Возвращает список реально
 * созданных файлов (для итогового отчёта пользователю).
 */
function setupAgentsMdBundle(projectRoot: string, templatesDir: string, ai: AiConfig): string[] {
  const created: string[] = [];

  if (copyTemplateFileIfMissing(templatesDir, "AGENTS.md", path.join(projectRoot, "AGENTS.md"))) {
    created.push("AGENTS.md");
  }
  if (
    ai["claude-code"] &&
    copyTemplateFileIfMissing(templatesDir, "CLAUDE.md", path.join(projectRoot, "CLAUDE.md"))
  ) {
    created.push("CLAUDE.md");
  }

  return created;
}

export function registerInitCommand(program: Command, templatesDir: string): void {
  program
    .command("init")
    .description("Interactively initialize closet-cli in the current project")
    .option("--force", "Переинициализировать поверх существующего .claude/.codex/closet-cli.json")
    .option("-y, --yes", "Неинтерактивный режим: без промптов, только флаги и значения по умолчанию")
    .option("--host <url>", "Адрес closet-registry")
    .option("--token <token>", "Токен реестра (Authorization: Bearer)")
    .option("--ai <list>", "Список ИИ через запятую, например codex,claude-code")
    .option("--agents-md", "Сгенерировать AGENTS.md и файлы-мосты без вопроса")
    .option("--no-agents-md", "Не генерировать AGENTS.md и файлы-мосты")
    .action(async (opts: InitCommandOptions) => {
      const projectRoot = process.cwd();
      const interactive = isInteractive();

      const alreadyInitialized =
        fs.existsSync(claudeDir(projectRoot)) ||
        fs.existsSync(path.join(projectRoot, CODEX_DIR_NAME)) ||
        projectConfigExists(projectRoot);

      if (alreadyInitialized && !opts.force) {
        fail(
          "Проект уже инициализирован (найден .claude/, .codex/ или closet-cli.json). " +
            "Используйте --force для повторной инициализации.",
        );
      }

      if (interactive && !opts.yes) {
        p.intro(pc.cyan("closet-cli init"));
      }

      const registry = await resolveRegistryConfig(opts, interactive);
      const ai = await resolveAiConfig(opts, interactive);
      const generateAgentsMd = await resolveGenerateAgentsMd(opts, interactive);

      try {
        if (ai["claude-code"]) {
          setupClaudeCode(projectRoot, templatesDir);
        }
        if (ai.codex) {
          setupCodex(projectRoot);
        }

        let createdAgentsFiles: string[] = [];
        if (generateAgentsMd) {
          createdAgentsFiles = setupAgentsMdBundle(projectRoot, templatesDir, ai);
        }

        writeProjectConfig(projectRoot, createInitialProjectConfig(registry, ai));
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        if (interactive && !opts.yes) {
          p.cancel(`Не удалось инициализировать проект: ${details}`);
          process.exit(1);
        }
        fail(`Не удалось инициализировать проект: ${details}`);
      }

      const selectedAiNames = AI_NAMES.filter((name) => ai[name]);
      const summary = [`Включены ИИ: ${selectedAiNames.map((n) => AI_LABELS[n]).join(", ")}`];
      if (ai["claude-code"]) {
        summary.push("Claude Code: .claude/{rules,skills,commands,agents,hooks,scripts}/, .claude/settings*.json, .mcp.json");
      }
      if (ai.codex) {
        summary.push("Codex: .codex/{skills,scripts}/");
      }
      summary.push("closet-cli.json");

      if (interactive && !opts.yes) {
        p.outro(pc.green("Проект инициализирован."));
      } else {
        console.log(pc.green("Проект успешно инициализирован."));
      }

      for (const line of summary) {
        console.log(pc.green(`  ${line}`));
      }
    });
}
