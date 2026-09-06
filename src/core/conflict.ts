import fs from "node:fs";
import * as p from "@clack/prompts";

import { isJsonMergeDestructive } from "./json-merge.js";

export interface PlannedFile {
  itemName: string;
  type: string;
  file: { path: string; content: string };
  destPath: string;
  merge?: boolean;
}

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

function isConflicting(file: PlannedFile): boolean {
  if (!fs.existsSync(file.destPath)) return false;
  const current = fs.readFileSync(file.destPath, "utf-8");

  if (file.merge) {
    return isJsonMergeDestructive(current, file.file.content);
  }

  return current !== file.file.content;
}

/**
 * Разбивает список запланированных файлов на те, что нужно записать
 * (`toWrite`), и те, что нужно пропустить (`toSkip`), в зависимости от
 * наличия конфликтов на диске и выбранного режима.
 *
 * Неконфликтные файлы (отсутствуют либо содержимое идентично) всегда
 * попадают в `toWrite` независимо от режима.
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
