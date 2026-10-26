import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { HarnessDescriptor, PluginComponent } from "../harnesses/types.js";
import { parseStoragePath } from "./layout.js";

/**
 * Проектор: копирует файлы из хранилища `.agents/` в папки harness'ов
 * (PLAN.md, §3–4). Направление одно: `.agents/` → `.claude/`, `.codex/`.
 * Решения о конфликтах принимает вызывающий код (`core/conflict.ts`, фаза 2):
 * здесь только проверка расхождений и запись/удаление.
 */

const ALL_COMPONENTS: readonly PluginComponent[] = [
  "mcp",
  "rules",
  "hooks",
  "agents",
  "commands",
  "skills",
  "scripts",
];

/** Запись о копии в `closet-cli.json` (`copies[]`): путь копии и sha256 на момент записи. */
export interface CopyRecord {
  path: string;
  sha256: string;
}

export function sha256Hex(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Куда копировать файл хранилища для данного harness'а. `null` — копия не нужна
 * (native/store-only/unsupported/…) либо файл предназначен другому harness'у.
 */
export function resolveCopyPath(harness: HarnessDescriptor, storageRelPath: string): string | null {
  const location = parseStoragePath(storageRelPath, ALL_COMPONENTS);
  if (location === null) return null;
  if (location.ai !== null && location.ai !== harness.id) return null;

  const placement = harness.placements[location.component];
  if (placement.kind !== "copy") return null;

  return `${placement.dir}/${location.relativePath}`;
}

export type CopyState =
  /** Копии нет на диске. */
  | "missing"
  /** Совпадает с записанным sha — можно безопасно перезаписывать/удалять. */
  | "clean"
  /** Отличается от записанного sha (или записи нет, а файл есть) — правили руками. */
  | "modified";

export function inspectCopy(projectRoot: string, copyRelPath: string, recordedSha: string | undefined): CopyState {
  const abs = path.join(projectRoot, copyRelPath);
  if (!fs.existsSync(abs)) return "missing";
  if (recordedSha === undefined) return "modified";
  return sha256Hex(fs.readFileSync(abs)) === recordedSha ? "clean" : "modified";
}

export type ProjectResult =
  | { status: "skipped" }
  | { status: "written" | "unchanged"; copy: CopyRecord }
  | { status: "conflict"; copyPath: string };

/**
 * Проецирует один файл хранилища в папку harness'а.
 *
 * - `unchanged`: содержимое копии уже равно хранилищу (запись обновится без записи на диск);
 * - `conflict`: копию правили руками (не совпала с `recorded`) и она отличается от хранилища —
 *   без `overwrite` ничего не пишется;
 * - иначе — запись.
 */
export function projectFile(
  projectRoot: string,
  harness: HarnessDescriptor,
  storageRelPath: string,
  recorded?: CopyRecord,
  options: { overwrite?: boolean } = {},
): ProjectResult {
  const copyPath = resolveCopyPath(harness, storageRelPath);
  if (copyPath === null) return { status: "skipped" };

  const content = fs.readFileSync(path.join(projectRoot, storageRelPath));
  const sha256 = sha256Hex(content);
  const abs = path.join(projectRoot, copyPath);

  const state = inspectCopy(projectRoot, copyPath, recorded?.sha256);
  if (state !== "missing" && sha256Hex(fs.readFileSync(abs)) === sha256) {
    return { status: "unchanged", copy: { path: copyPath, sha256 } };
  }
  if (state === "modified" && !options.overwrite) {
    return { status: "conflict", copyPath };
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return { status: "written", copy: { path: copyPath, sha256 } };
}

export type RemoveResult = "removed" | "missing" | "modified";

/**
 * Удаляет копию, если она не менялась вручную (или с `force`). Пустые вложенные папки
 * (например, папка skill'а) подчищаются; папки первого и второго уровня
 * (`.claude`, `.claude/skills`) остаются — их создаёт `init`.
 */
export function removeCopy(
  projectRoot: string,
  copy: CopyRecord,
  options: { force?: boolean } = {},
): RemoveResult {
  const state = inspectCopy(projectRoot, copy.path, copy.sha256);
  if (state === "missing") return "missing";
  if (state === "modified" && !options.force) return "modified";

  const abs = path.join(projectRoot, copy.path);
  fs.rmSync(abs);

  const root = path.resolve(projectRoot);
  let dir = path.dirname(abs);
  while (path.relative(root, dir).split(path.sep).length > 2 && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
  return "removed";
}
