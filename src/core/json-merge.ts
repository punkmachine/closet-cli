/**
 * JSON-обёртка над общим движком именованных слотов (`merge-slots.ts`) для
 * merge-файлов вида `.mcp.json`/`.claude/settings.json` (plan.md, 2.7).
 *
 * Модель B+C: слот идентифицируется `mergeKeyPath`, а не диффом всего файла.
 * Прежняя версия этого модуля (whole-fragment deep-merge поверх произвольного
 * JSON-фрагмента) удалена — она не совпадала с реальной schema `closet-cli.json`
 * (`InstalledPluginFile.mergeValue`), где для каждого merge-файла уже хранится
 * ровно один именованный слот, а не произвольный кусок дерева.
 */

import { installSlot, isPlainObject, isSlotOccupied, isSlotUnchanged, removeSlot, updateSlot } from "./merge-slots.js";

function parseJsonRoot(currentRaw: string | undefined): Record<string, unknown> {
  if (currentRaw === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(currentRaw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`существующий файл повреждён: невалидный JSON (${details})`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error("существующий файл повреждён: ожидался JSON-объект верхнего уровня");
  }
  return parsed;
}

function stringifyJsonRoot(root: Record<string, unknown>): string {
  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * Устанавливает значение именованного слота в JSON-файл при первой установке
 * плагина, не трогая остальные ключи. `currentRaw === undefined` — файла ещё
 * нет, он будет создан с нуля.
 */
export function installJsonSlot(currentRaw: string | undefined, mergeKeyPath: string, value: unknown): string {
  const root = parseJsonRoot(currentRaw);
  installSlot(root, mergeKeyPath, value);
  return stringifyJsonRoot(root);
}

/**
 * Проверяет, что слот в файле на диске всё ещё равен значению, сохранённому
 * в `closet-cli.json` (`files[].mergeValue`) при установке — то есть
 * пользователь его не менял вручную. Отсутствующий файл — не "не изменён",
 * а "недоступен для проверки" (`false`).
 */
export function isJsonSlotUnchanged(
  currentRaw: string | undefined,
  mergeKeyPath: string,
  expectedValue: unknown,
): boolean {
  if (currentRaw === undefined) return false;
  return isSlotUnchanged(parseJsonRoot(currentRaw), mergeKeyPath, expectedValue);
}

/**
 * Проверяет, занят ли слот каким-либо значением — используется при первой
 * установке плагина, чтобы отличить "слот свободен" от "слот занят чужим
 * значением" (реальный конфликт, см. `core/conflict.ts`).
 */
export function isJsonSlotOccupied(currentRaw: string | undefined, mergeKeyPath: string): boolean {
  if (currentRaw === undefined) return false;
  return isSlotOccupied(parseJsonRoot(currentRaw), mergeKeyPath);
}

/**
 * Обновляет слот на новое значение. Вызывающий код обязан заранее убедиться
 * через `isJsonSlotUnchanged`, что слот не менялся пользователем (либо
 * действовать в режиме `--force`).
 */
export function updateJsonSlot(
  currentRaw: string,
  mergeKeyPath: string,
  oldValue: unknown,
  newValue: unknown,
): string {
  const root = parseJsonRoot(currentRaw);
  updateSlot(root, mergeKeyPath, oldValue, newValue);
  return stringifyJsonRoot(root);
}

/**
 * Удаляет слот, если он ещё существует (объектный слот — безусловно по
 * пути; массивный — только совпадающий по значению элемент). `removed:
 * false`, если удалять было нечего (пользователь уже удалил слот вручную).
 */
export function removeJsonSlot(
  currentRaw: string,
  mergeKeyPath: string,
  expectedValue: unknown,
): { content: string; removed: boolean } {
  const root = parseJsonRoot(currentRaw);
  const removed = removeSlot(root, mergeKeyPath, expectedValue);
  return { content: stringifyJsonRoot(root), removed };
}
