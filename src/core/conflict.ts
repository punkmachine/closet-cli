import fs from "node:fs";
import * as p from "@clack/prompts";

import { isJsonSlotOccupied, isJsonSlotUnchanged } from "./json-merge.js";
import { isTomlSlotOccupied, isTomlSlotUnchanged } from "./toml-merge.js";
import type { AiName, PluginComponent } from "../registry/types.js";

/** Обычный (немерджащийся) файл — пишется как есть в `destPath`. */
export interface DirPlannedFile {
  kind: "dir";
  pluginSlug: string;
  component: PluginComponent;
  /** Исходный тег `ai` файла в bundle (`null` = общий для всех ИИ). */
  ai: AiName | null;
  /** Конкретный ИИ, под который резолвился этот destPath (см. `core/installer.ts`, planBundleFiles). */
  targetAi: AiName;
  destPath: string;
  content: string | Buffer;
}

/** Merge-файл (JSON или TOML) — владение ограничено именованным слотом `mergeKeyPath`, см. `core/merge-slots.ts`. */
export interface MergePlannedFile {
  kind: "merge-json" | "merge-toml";
  pluginSlug: string;
  component: PluginComponent;
  ai: AiName | null;
  targetAi: AiName;
  destPath: string;
  mergeKeyPath: string;
  mergeValue: unknown;
}

export type PlannedFile = DirPlannedFile | MergePlannedFile;

export type ConflictMode = "interactive" | "force" | "skip";

export interface ConflictResolutionResult {
  toWrite: PlannedFile[];
  toSkip: PlannedFile[];
}

/**
 * Ошибка разрешения конфликтов: неинтерактивный режим без TTY без
 * `--force`/`--skip`, либо пользователь отменил интерактивный диалог.
 */
export class ConflictResolutionError extends Error {}

/**
 * "Конфликт" при первой установке — это ТОЛЬКО столкновение с чужим уже
 * существующим содержимым:
 * - `dir` — файл на диске существует и отличается от нового содержимого;
 * - merge-слот — слот уже занят (см. `isSlotOccupied`) значением, которое
 *   не совпадает с тем, что мы собираемся туда положить. Массивный слот
 *   никогда не считается занятым (модель B+C: элементы массива законно
 *   принадлежат разным плагинам) — идемпотентность конкретного элемента
 *   проверяется отдельно, на записи (`core/installer.ts`), а не здесь.
 */
function isConflicting(file: PlannedFile): boolean {
  if (file.kind === "dir") {
    if (!fs.existsSync(file.destPath)) return false;
    const current = fs.readFileSync(file.destPath);
    const next = typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content;
    return !current.equals(next);
  }

  const currentRaw = fs.existsSync(file.destPath) ? fs.readFileSync(file.destPath, "utf-8") : undefined;
  const isOccupied = file.kind === "merge-json" ? isJsonSlotOccupied : isTomlSlotOccupied;
  const isUnchanged = file.kind === "merge-json" ? isJsonSlotUnchanged : isTomlSlotUnchanged;

  if (!isOccupied(currentRaw, file.mergeKeyPath)) return false;
  return !isUnchanged(currentRaw, file.mergeKeyPath, file.mergeValue);
}

/**
 * Разбивает список запланированных файлов на те, что нужно записать
 * (`toWrite`), и те, что нужно пропустить (`toSkip`), в зависимости от
 * наличия конфликтов на диске и выбранного режима.
 *
 * Неконфликтные файлы (отсутствуют, содержимое идентично, либо слот
 * свободен/уже равен нашему значению) всегда попадают в `toWrite`
 * независимо от режима.
 */
export async function resolveConflicts(
  files: PlannedFile[],
  mode: ConflictMode,
): Promise<ConflictResolutionResult> {
  const toWrite: PlannedFile[] = [];
  const toSkip: PlannedFile[] = [];
  const conflicting: PlannedFile[] = [];

  for (const file of files) {
    if (isConflicting(file)) {
      conflicting.push(file);
    } else {
      toWrite.push(file);
    }
  }

  if (conflicting.length === 0) {
    return { toWrite, toSkip };
  }

  if (mode === "force") {
    toWrite.push(...conflicting);
    return { toWrite, toSkip };
  }

  if (mode === "skip") {
    toSkip.push(...conflicting);
    return { toWrite, toSkip };
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const list = conflicting.map((f) => `  - ${f.destPath}`).join("\n");
    throw new ConflictResolutionError(
      `Обнаружены конфликтующие файлы, но окружение не интерактивно (нет TTY):\n${list}\n` +
        `Используйте флаг --force для перезаписи или --skip для пропуска этих файлов.`,
    );
  }

  p.intro("Обнаружены конфликтующие файлы");
  p.log.warn(
    `Следующие файлы уже существуют и отличаются от новой версии:\n${conflicting
      .map((f) => `  - ${f.destPath}`)
      .join("\n")}`,
  );

  for (const file of conflicting) {
    const answer = await p.confirm({
      message: `Файл ${file.destPath} уже существует и отличается от новой версии. Перезаписать?`,
    });

    if (p.isCancel(answer)) {
      throw new ConflictResolutionError("Операция отменена пользователем.");
    }

    if (answer) {
      toWrite.push(file);
    } else {
      toSkip.push(file);
    }
  }

  return { toWrite, toSkip };
}
