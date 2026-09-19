import fs from "node:fs";
import path from "node:path";

import type { InstalledPlugin, InstalledPluginFile } from "../config/project-config.js";
import { removeJsonSlot } from "./json-merge.js";
import { removeTomlSlot } from "./toml-merge.js";

function mergeFormatForPath(destPath: string): "json" | "toml" {
  return destPath.endsWith(".toml") ? "toml" : "json";
}

/**
 * Пытается удалить файл с диска и, если после этого родительская директория
 * стала пустой, удалить и её. Не критично, если не получится (например,
 * недостаточно прав) — тогда просто молча пропускаем уборку директории.
 */
function removeFileAndCleanupDir(destPath: string): void {
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath);
  }

  try {
    const dir = path.dirname(destPath);
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // Уборка директории не критична — молча игнорируем.
  }
}

export type RemovalStatus = "removed" | "kept-shared" | "merge-removed" | "already-gone";

/**
 * Удаляет один отслеживаемый файл плагина с диска.
 *
 * - Обычный файл: удаляется, если ни один ДРУГОЙ оставшийся плагин на него
 *   не ссылается (`stillUsedDestPaths` — reference counting).
 * - Merge-файл: сам файл никогда не удаляется целиком — только именованный
 *   слот внутри него (`core/merge-slots.ts`: объектный слот удаляется
 *   безусловно по пути, массивный — только совпадающий по значению
 *   элемент). Остальные ключи файла (от других плагинов) не трогаются.
 */
export function removeTrackedFile(
  projectRoot: string,
  tracked: InstalledPluginFile,
  stillUsedDestPaths: Set<string>,
): RemovalStatus {
  const destPath = path.join(projectRoot, tracked.path);

  if (tracked.merge) {
    if (!fs.existsSync(destPath)) return "already-gone";

    const currentRaw = fs.readFileSync(destPath, "utf-8");
    const removeSlot = mergeFormatForPath(destPath) === "toml" ? removeTomlSlot : removeJsonSlot;
    // mergeKeyPath гарантированно присутствует для merge-записей — обеспечено zod-схемой (project-config.ts).
    const { content, removed } = removeSlot(currentRaw, tracked.mergeKeyPath as string, tracked.mergeValue);
    if (removed) {
      fs.writeFileSync(destPath, content, "utf-8");
    }
    return "merge-removed";
  }

  if (stillUsedDestPaths.has(destPath)) return "kept-shared";
  if (!fs.existsSync(destPath)) return "already-gone";

  removeFileAndCleanupDir(destPath);
  return "removed";
}

/**
 * Собирает абсолютные пути обычных (немерджащихся) файлов всех плагинов из
 * `plugins`, КРОМЕ перечисленных в `excludeSlugs` — используется для
 * reference counting перед удалением: файл не удаляется с диска, если он
 * всё ещё нужен другому оставшемуся плагину. Merge-файлы не участвуют —
 * для них reference counting не нужен (удаляется только свой слот).
 */
export function collectUsedDestPaths(
  projectRoot: string,
  plugins: Record<string, InstalledPlugin>,
  excludeSlugs: Set<string>,
): Set<string> {
  const used = new Set<string>();

  for (const [slug, plugin] of Object.entries(plugins)) {
    if (excludeSlugs.has(slug)) continue;
    for (const file of plugin.files) {
      if (file.merge) continue;
      used.add(path.join(projectRoot, file.path));
    }
  }

  return used;
}
