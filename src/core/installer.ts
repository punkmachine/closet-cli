import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AiConfig, InstalledPluginFile, Layout } from "../config/project-config.js";
import { HARNESSES } from "../harnesses/registry.js";
import { STORAGE_DIR, storageAiSegments } from "./layout.js";
import { inspectCopy } from "./projector.js";
import { projectRecords } from "./sync.js";
import { installJsonSlot, isJsonSlotUnchanged } from "./json-merge.js";
import { installTomlSlot, isTomlSlotUnchanged } from "./toml-merge.js";
import { resolveComponentTarget, resolvePlacement } from "./path-mapper.js";
import { resolveConflicts, type ConflictMode, type PlannedFile } from "./conflict.js";
import { AI_NAMES, type PluginBundle, type PluginBundleFile, type PluginComponent, type AiName } from "../registry/types.js";

function sha256Hex(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function toPosixRelative(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join("/");
}

/**
 * Идентичность файла для сверки "это уже наш файл" между старым
 * (`InstalledPluginFile`) и новым (`PlannedFile`) представлением при
 * `update` (см. `installBundles`/`update.ts`). Для merge-файлов один
 * `destPath` может нести НЕСКОЛЬКО именованных слотов разных плагинов —
 * поэтому ключ включает `mergeKeyPath`, а не только путь.
 */
function fileIdentityKey(destPath: string, mergeKeyPath?: string): string {
  return mergeKeyPath === undefined ? destPath : `${destPath}\u0000${mergeKeyPath}`;
}

function plannedFileIdentityKey(file: PlannedFile): string {
  return fileIdentityKey(file.destPath, file.kind === "dir" ? undefined : file.mergeKeyPath);
}

/**
 * Как `plannedFileIdentityKey`, но для ранее установленного файла,
 * записанного в `closet-cli.json` (`InstalledPluginFile`). Используется
 * `update.ts`, чтобы собрать набор "заведомо наших" ключей перед вызовом
 * `installBundles`.
 */
export function trackedFileIdentityKey(projectRoot: string, tracked: InstalledPluginFile): string {
  const destPath = path.join(projectRoot, tracked.path);
  return fileIdentityKey(destPath, tracked.merge ? (tracked.mergeKeyPath as string) : undefined);
}

/**
 * `path.join` не защищает от `relativePath`, приходящего из bundle-ответа
 * registry (внешние данные), выходящего за пределы `baseDir` через `../`.
 * Сервер валидирует path traversal только на своём диске (`resolveSafePath`
 * в `closet-registry/src/registry/file-store.ts`) — это не защищает клиента,
 * поэтому та же проверка нужна и здесь.
 */
function resolveSafeJoin(baseDir: string, relativePath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`небезопасный путь файла из registry: "${relativePath}" выходит за пределы "${baseDir}"`);
  }
  return resolved;
}

function applyTemplate(text: string, projectRoot: string): string {
  return text.replaceAll("{{projectRoot}}", projectRoot.replace(/\\/g, "/"));
}

function decodeDirContent(file: PluginBundleFile, projectRoot: string): string | Buffer {
  if (file.encoding === "base64") {
    return Buffer.from(file.content, "base64");
  }
  return file.template ? applyTemplate(file.content, projectRoot) : file.content;
}

/**
 * Разбирает содержимое merge-файла в значение слота (`mergeValue`).
 *
 * Решение: содержимое merge-файла в bundle-ответе ВСЕГДА JSON, независимо
 * от формата файла назначения (`merge-json` или `merge-toml`) — TOML не
 * умеет представлять "голое" значение верхнего уровня (только key=value/
 * таблицы), а merge-значение может быть произвольным (объект, массив,
 * скаляр). JSON.parse годится для обоих направлений; формат СЕРИАЛИЗАЦИИ
 * определяется только целевым файлом (`json-merge.ts` vs `toml-merge.ts`).
 */
function parseMergeValue(bundle: PluginBundle, file: PluginBundleFile, projectRoot: string): unknown {
  if (file.encoding !== "utf8") {
    throw new Error(
      `${bundle.slug}: merge-файл ${file.component}/${file.relativePath} должен быть текстовым (utf8), а не base64`,
    );
  }
  if (file.mergeKeyPath === null) {
    throw new Error(`${bundle.slug}: merge-файл ${file.component}/${file.relativePath} без mergeKeyPath`);
  }

  const raw = file.template ? applyTemplate(file.content, projectRoot) : file.content;
  try {
    return JSON.parse(raw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${bundle.slug}: не удалось разобрать содержимое merge-файла ${file.component}/${file.relativePath} как JSON (${details})`,
    );
  }
}

export interface PlanNotice {
  pluginSlug: string;
  component: PluginComponent;
  ai: AiName;
  reason: "unsupported" | "not-implemented";
}

export interface PlanResult {
  files: PlannedFile[];
  notices: PlanNotice[];
}

/**
 * Строит план файлов ОДНОГО bundle'а: для каждого файла bundle'а резолвит
 * место(-а) назначения под каждый ВКЛЮЧЁННЫЙ в проекте ИИ (`ai: null` в
 * bundle-файле — общий файл, устанавливается под КАЖДЫЙ включённый ИИ
 * отдельно, т.к. у Claude Code и Codex непересекающиеся деревья каталогов
 * — общий файл физически дублируется). Компоненты без маппинга для
 * конкретного ИИ (`unsupported`/`not-implemented`, `core/path-mapper.ts`)
 * попадают в `notices`, а не бросают ошибку.
 */
export function planBundleFiles(
  projectRoot: string,
  ai: AiConfig,
  bundle: PluginBundle,
  layout: Layout = "legacy",
): PlanResult {
  return layout === "agents"
    ? planAgentsBundleFiles(projectRoot, ai, bundle)
    : planLegacyBundleFiles(projectRoot, ai, bundle);
}

/**
 * Раскладка `agents` (PLAN.md §3): обычный файл пишется ОДИН раз в хранилище
 * `.agents/<component>/[.<ai>/]<path>` (копии в папки harness'ов делает
 * проектор после записи), merge-файлы — как в legacy, по дескриптору harness'а.
 * Файл попадает в хранилище, только если хотя бы один из целевых включённых
 * harness'ов умеет с ним что-то делать (copy/native/store-only). `direct` пишется
 * сразу в папку harness'а, минуя хранилище.
 */
function planAgentsBundleFiles(projectRoot: string, ai: AiConfig, bundle: PluginBundle): PlanResult {
  const enabled = HARNESSES.filter((harness) => ai[harness.id]);
  const files: PlannedFile[] = [];
  const notices: PlanNotice[] = [];

  for (const bundleFile of bundle.files) {
    const targets = bundleFile.ai === null ? enabled : enabled.filter((harness) => harness.id === bundleFile.ai);
    let usableByAnyTarget = false;

    for (const harness of targets) {
      const placement = resolvePlacement(harness.id, bundleFile.component, bundleFile.merge);

      if (placement.kind === "unsupported" || placement.kind === "not-implemented") {
        notices.push({
          pluginSlug: bundle.slug,
          component: bundleFile.component,
          ai: harness.id,
          reason: placement.kind,
        });
        continue;
      }

      if (placement.kind === "merge-json" || placement.kind === "merge-toml") {
        files.push({
          kind: placement.kind,
          pluginSlug: bundle.slug,
          component: bundleFile.component,
          ai: bundleFile.ai,
          targetAi: harness.id,
          destPath: path.join(projectRoot, placement.file),
          mergeKeyPath: bundleFile.mergeKeyPath as string,
          mergeValue: parseMergeValue(bundle, bundleFile, projectRoot),
        });
        continue;
      }

      if (placement.kind === "direct") {
        files.push({
          kind: "dir",
          pluginSlug: bundle.slug,
          component: bundleFile.component,
          ai: bundleFile.ai,
          targetAi: harness.id,
          destPath: resolveSafeJoin(path.join(projectRoot, placement.dir), bundleFile.relativePath),
          content: decodeDirContent(bundleFile, projectRoot),
        });
        continue;
      }

      usableByAnyTarget = true;
    }

    if (!usableByAnyTarget) continue;

    const storageDir = path.join(
      projectRoot,
      STORAGE_DIR,
      bundleFile.component,
      ...storageAiSegments(bundleFile.component, bundleFile.ai),
    );
    files.push({
      kind: "dir",
      pluginSlug: bundle.slug,
      component: bundleFile.component,
      ai: bundleFile.ai,
      targetAi: null,
      destPath: resolveSafeJoin(storageDir, bundleFile.relativePath),
      content: decodeDirContent(bundleFile, projectRoot),
    });
  }

  return { files, notices };
}

function planLegacyBundleFiles(projectRoot: string, ai: AiConfig, bundle: PluginBundle): PlanResult {
  const enabledAiNames = AI_NAMES.filter((name) => ai[name]);
  const files: PlannedFile[] = [];
  const notices: PlanNotice[] = [];

  for (const bundleFile of bundle.files) {
    const targetAiNames =
      bundleFile.ai === null ? enabledAiNames : enabledAiNames.filter((name) => name === bundleFile.ai);

    for (const targetAi of targetAiNames) {
      const target = resolveComponentTarget(bundleFile.component, targetAi, bundleFile.merge);

      if (target.kind === "unsupported" || target.kind === "not-implemented") {
        notices.push({ pluginSlug: bundle.slug, component: bundleFile.component, ai: targetAi, reason: target.kind });
        continue;
      }

      if (target.kind === "dir") {
        const destPath = resolveSafeJoin(
          path.join(projectRoot, target.relativeDir),
          bundleFile.relativePath,
        );
        files.push({
          kind: "dir",
          pluginSlug: bundle.slug,
          component: bundleFile.component,
          ai: bundleFile.ai,
          targetAi,
          destPath,
          content: decodeDirContent(bundleFile, projectRoot),
        });
        continue;
      }

      const destPath = path.join(projectRoot, target.relativePath);
      files.push({
        kind: target.kind,
        pluginSlug: bundle.slug,
        component: bundleFile.component,
        ai: bundleFile.ai,
        targetAi,
        destPath,
        mergeKeyPath: bundleFile.mergeKeyPath as string,
        mergeValue: parseMergeValue(bundle, bundleFile, projectRoot),
      });
    }
  }

  return { files, notices };
}

/**
 * Пишет один `PlannedFile` на диск и возвращает запись для
 * `closet-cli.json` (`InstalledPluginFile`). Для merge-слота, который уже
 * равен нашему значению (идемпотентный повторный install/update, либо
 * элемент массива уже присутствует) — реальной записи не происходит, но
 * запись для tracking всё равно возвращается.
 */
export function writePlannedFile(projectRoot: string, file: PlannedFile): InstalledPluginFile {
  if (file.kind === "dir") {
    fs.mkdirSync(path.dirname(file.destPath), { recursive: true });
    fs.writeFileSync(file.destPath, file.content);
    return {
      component: file.component,
      ai: file.ai,
      path: toPosixRelative(projectRoot, file.destPath),
      sha256: sha256Hex(file.content),
    };
  }

  const currentRaw = fs.existsSync(file.destPath) ? fs.readFileSync(file.destPath, "utf-8") : undefined;
  const isUnchanged = file.kind === "merge-json" ? isJsonSlotUnchanged : isTomlSlotUnchanged;

  if (!isUnchanged(currentRaw, file.mergeKeyPath, file.mergeValue)) {
    const install = file.kind === "merge-json" ? installJsonSlot : installTomlSlot;
    const nextRaw = install(currentRaw, file.mergeKeyPath, file.mergeValue);
    fs.mkdirSync(path.dirname(file.destPath), { recursive: true });
    fs.writeFileSync(file.destPath, nextRaw, "utf-8");
  }

  return {
    component: file.component,
    ai: file.ai,
    path: toPosixRelative(projectRoot, file.destPath),
    merge: true,
    mergeKeyPath: file.mergeKeyPath,
    mergeValue: file.mergeValue,
  };
}

export interface InstallResultItem {
  bundle: PluginBundle;
  writtenFiles: InstalledPluginFile[];
  skippedFiles: PlannedFile[];
  /** Пути копий (раскладка `agents`), не перезаписанные из-за ручных правок. */
  skippedCopies: string[];
  notices: PlanNotice[];
}

export interface InstallOptions {
  layout?: Layout;
  /** Ключи файлов, чья перезапись заранее одобрена (`update`: плагин не менялся вручную). */
  preApprovedKeys?: ReadonlySet<string>;
  /** Записанные sha256 копий по всем плагинам (`core/sync.ts`, `collectRecordedCopies`). */
  recordedCopies?: ReadonlyMap<string, string>;
}

/**
 * Планирует и записывает файлы набора bundle'ов (уже в порядке разрешения
 * зависимостей) на диск, разрешая конфликты одним общим проходом через
 * `resolveConflicts`. Ничего не знает про `closet-cli.json` — вызывающий
 * код (`install`/`update`) сам решает, что делать с результатом.
 */
export async function installBundles(
  projectRoot: string,
  ai: AiConfig,
  bundles: PluginBundle[],
  mode: ConflictMode,
  options: InstallOptions = {},
): Promise<InstallResultItem[]> {
  const { layout = "legacy", preApprovedKeys = new Set<string>(), recordedCopies = new Map<string, string>() } = options;
  const plannedByBundle = new Map<string, PlannedFile[]>();
  const noticesByBundle = new Map<string, PlanNotice[]>();
  const allPlanned: PlannedFile[] = [];

  for (const bundle of bundles) {
    const { files, notices } = planBundleFiles(projectRoot, ai, bundle, layout);
    plannedByBundle.set(bundle.slug, files);
    noticesByBundle.set(bundle.slug, notices);
    allPlanned.push(...files);
  }

  // Файлы, чей destPath (+ mergeKeyPath для merge) уже принадлежит этому же
  // плагину по данным `closet-cli.json` И заранее проверен как не изменённый
  // пользователем (`update.ts`, `isPreviouslyTrackedFileUnchanged`) — не
  // "конфликт" в смысле resolveConflicts (там речь только о столкновении с
  // ЧУЖИМ содержимым), а плановая перезапись новой версией. Без этого шага
  // ЛЮБОЕ изменение содержимого файла между версиями плагина (нормальный
  // случай, не правка пользователя) ошибочно требовало бы --force/--skip.
  const preApproved: PlannedFile[] = [];
  const toResolve: PlannedFile[] = [];
  for (const file of allPlanned) {
    const key = plannedFileIdentityKey(file);
    (preApprovedKeys.has(key) ? preApproved : toResolve).push(file);
  }

  const { toWrite: resolvedToWrite, toSkip } = await resolveConflicts(toResolve, mode);
  const toSkipSet = new Set(toSkip);
  const toWrite = [...preApproved, ...resolvedToWrite];

  const writtenByFile = new Map<PlannedFile, InstalledPluginFile>();
  for (const file of toWrite) {
    writtenByFile.set(file, writePlannedFile(projectRoot, file));
  }

  // Раскладка `agents`: файлы хранилища записаны — раскладываем копии по папкам harness'ов.
  const skippedCopiesByRecord = new Map<InstalledPluginFile, string[]>();
  if (layout === "agents") {
    const projection = await projectRecords(projectRoot, ai, [...writtenByFile.values()], mode, recordedCopies);
    for (const [record, copies] of projection.copies) {
      if (copies.length > 0) record.copies = copies;
    }
    for (const [record, paths] of projection.skipped) skippedCopiesByRecord.set(record, paths);
  }

  return bundles.map((bundle) => {
    const planned = plannedByBundle.get(bundle.slug) ?? [];
    const writtenFiles: InstalledPluginFile[] = [];
    const skippedFiles: PlannedFile[] = [];
    const skippedCopies: string[] = [];

    for (const file of planned) {
      const record = writtenByFile.get(file);
      if (record) {
        writtenFiles.push(record);
        skippedCopies.push(...(skippedCopiesByRecord.get(record) ?? []));
      } else if (toSkipSet.has(file)) {
        skippedFiles.push(file);
      }
    }

    return { bundle, writtenFiles, skippedFiles, skippedCopies, notices: noticesByBundle.get(bundle.slug) ?? [] };
  });
}

function mergeFormatForPath(destPath: string): "json" | "toml" {
  return destPath.endsWith(".toml") ? "toml" : "json";
}

/**
 * Проверяет, не изменил ли пользователь вручную ранее установленный файл
 * плагина с момента установки (plan.md, 2.7) — используется `update`, чтобы
 * решить, безопасно ли перезаписывать. Отсутствующий файл считается
 * изменённым (пользователь удалил его вручную) — не поводом молча
 * пропустить проверку. Для раскладки `agents` дополнительно проверяются
 * копии в папках harness'ов: изменённая копия — тоже ручная правка, а
 * отсутствующая — нет (её восстанавливает `sync`/`update`).
 *
 * Возвращает пути (относительно корня проекта) всего, что изменено вручную.
 */
export function findModifiedPaths(projectRoot: string, tracked: InstalledPluginFile): string[] {
  const destPath = path.join(projectRoot, tracked.path);

  if (tracked.merge) {
    const currentRaw = fs.existsSync(destPath) ? fs.readFileSync(destPath, "utf-8") : undefined;
    const isUnchanged = mergeFormatForPath(destPath) === "toml" ? isTomlSlotUnchanged : isJsonSlotUnchanged;
    // mergeKeyPath гарантированно присутствует для merge-записей — обеспечено zod-схемой (project-config.ts).
    return isUnchanged(currentRaw, tracked.mergeKeyPath as string, tracked.mergeValue) ? [] : [tracked.path];
  }

  const modified: string[] = [];
  if (!fs.existsSync(destPath) || sha256Hex(fs.readFileSync(destPath)) !== tracked.sha256) {
    modified.push(tracked.path);
  }
  for (const copy of tracked.copies ?? []) {
    if (inspectCopy(projectRoot, copy.path, copy.sha256) === "modified") modified.push(copy.path);
  }
  return modified;
}
