import type { AiConfig, FileCopy, InstalledPlugin, InstalledPluginFile } from "../config/project-config.js";
import { HARNESSES } from "../harnesses/registry.js";
import type { HarnessDescriptor } from "../harnesses/types.js";
import { resolvePathConflicts, type ConflictMode } from "./conflict.js";
import { projectFile, resolveCopyPath } from "./projector.js";

/**
 * Проецирование хранилища `.agents/` в папки harness'ов (раскладка `agents`,
 * PLAN.md §4). Общее для `install`/`update` (после записи файлов хранилища) и
 * команды `sync`. Направление одно: `.agents/` → `.claude/`, `.codex/`.
 */

/** Записанные sha256 копий по всем плагинам: путь копии → sha. Нужны, чтобы отличить ручную правку от обновления. */
export function collectRecordedCopies(plugins: Record<string, InstalledPlugin>): Map<string, string> {
  const recorded = new Map<string, string>();
  for (const plugin of Object.values(plugins)) {
    for (const file of plugin.files) {
      for (const copy of file.copies ?? []) {
        recorded.set(copy.path, copy.sha256);
      }
    }
  }
  return recorded;
}

export interface ProjectionResult {
  /** Актуальные копии каждой записи (для `copies[]` в `closet-cli.json`). */
  copies: Map<InstalledPluginFile, FileCopy[]>;
  /** Пути копий, которые не перезаписаны из-за ручных правок (`--skip` / отказ в диалоге), по записям. */
  skipped: Map<InstalledPluginFile, string[]>;
}

interface PendingConflict {
  record: InstalledPluginFile;
  harness: HarnessDescriptor;
  copyPath: string;
}

/**
 * Проецирует файлы хранилища (немерджащиеся записи) во все включённые harness'ы.
 *
 * Копии, которые правили руками, не перезаписываются молча: список конфликтов
 * разрешается через `resolvePathConflicts` (спросить / `--force` / `--skip`).
 * Для пропущенной копии сохраняется прежняя запись (если была), чтобы
 * следующий `sync` снова увидел расхождение.
 */
export async function projectRecords(
  projectRoot: string,
  ai: AiConfig,
  records: readonly InstalledPluginFile[],
  mode: ConflictMode,
  recordedCopies: ReadonlyMap<string, string>,
): Promise<ProjectionResult> {
  const harnesses = HARNESSES.filter((harness) => ai[harness.id]);
  const copies = new Map<InstalledPluginFile, FileCopy[]>();
  const skipped = new Map<InstalledPluginFile, string[]>();
  const conflicts: PendingConflict[] = [];

  for (const record of records) {
    if (record.merge) continue;
    const current: FileCopy[] = [];
    copies.set(record, current);

    for (const harness of harnesses) {
      const copyPath = resolveCopyPath(harness, record.path);
      if (copyPath === null) continue;

      const recordedSha = record.copies?.find((copy) => copy.path === copyPath)?.sha256 ?? recordedCopies.get(copyPath);
      const result = projectFile(
        projectRoot,
        harness,
        record.path,
        recordedSha === undefined ? undefined : { path: copyPath, sha256: recordedSha },
      );
      if (result.status === "written" || result.status === "unchanged") {
        current.push(result.copy);
      } else if (result.status === "conflict") {
        conflicts.push({ record, harness, copyPath });
      }
    }
  }

  const { overwrite } = await resolvePathConflicts([...new Set(conflicts.map((c) => c.copyPath))], mode);
  const overwriteSet = new Set(overwrite);

  for (const { record, harness, copyPath } of conflicts) {
    const current = copies.get(record) as FileCopy[];
    if (overwriteSet.has(copyPath)) {
      const result = projectFile(projectRoot, harness, record.path, undefined, { overwrite: true });
      if (result.status === "written" || result.status === "unchanged") current.push(result.copy);
    } else {
      const kept = record.copies?.find((copy) => copy.path === copyPath);
      if (kept) current.push(kept);
      skipped.set(record, [...(skipped.get(record) ?? []), copyPath]);
    }
  }

  return { copies, skipped };
}
