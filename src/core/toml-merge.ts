/**
 * TOML-обёртка над общим движком именованных слотов (`merge-slots.ts`) для
 * `.codex/config.toml` (plan.md, 2.7/2.9). Тот же слотовый API, что и
 * `json-merge.ts` — движок работает над разобранным деревом и не зависит от
 * формата сериализации; здесь меняется только парсер/сериализатор.
 *
 * Библиотека — `smol-toml` (TOML 1.0, `parse`/`stringify`, zero-dependency).
 * Не гарантирует побайтовую каноничность при round-trip (комментарии в
 * непривязанных к нашим слотам местах могут не сохраниться) — это допустимо
 * по plan.md 2.7: сравнение владения идёт по разобранным структурам
 * (`deepEqual` в `merge-slots.ts`), а не по строковому диффу файла.
 */

import { parse, stringify } from "smol-toml";

import { installSlot, isPlainObject, isSlotOccupied, isSlotUnchanged, removeSlot, updateSlot } from "./merge-slots.js";

function parseTomlRoot(currentRaw: string | undefined): Record<string, unknown> {
  if (currentRaw === undefined) return {};

  let parsed: unknown;
  try {
    parsed = parse(currentRaw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`существующий файл повреждён: невалидный TOML (${details})`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error("существующий файл повреждён: ожидался TOML-документ верхнего уровня");
  }
  return parsed;
}

function stringifyTomlRoot(root: Record<string, unknown>): string {
  return stringify(root);
}

/**
 * Устанавливает значение именованного слота в TOML-файл при первой установке
 * плагина, не трогая остальные ключи. `currentRaw === undefined` — файла ещё
 * нет, он будет создан с нуля.
 */
export function installTomlSlot(currentRaw: string | undefined, mergeKeyPath: string, value: unknown): string {
  const root = parseTomlRoot(currentRaw);
  installSlot(root, mergeKeyPath, value);
  return stringifyTomlRoot(root);
}

/**
 * Проверяет, что слот в файле на диске всё ещё равен значению, сохранённому
 * в `closet-cli.json` (`files[].mergeValue`) при установке. Отсутствующий
 * файл — не "не изменён", а "недоступен для проверки" (`false`).
 */
export function isTomlSlotUnchanged(
  currentRaw: string | undefined,
  mergeKeyPath: string,
  expectedValue: unknown,
): boolean {
  if (currentRaw === undefined) return false;
  return isSlotUnchanged(parseTomlRoot(currentRaw), mergeKeyPath, expectedValue);
}

/**
 * Проверяет, занят ли слот каким-либо значением — используется при первой
 * установке плагина, чтобы отличить "слот свободен" от "слот занят чужим
 * значением" (реальный конфликт, см. `core/conflict.ts`).
 */
export function isTomlSlotOccupied(currentRaw: string | undefined, mergeKeyPath: string): boolean {
  if (currentRaw === undefined) return false;
  return isSlotOccupied(parseTomlRoot(currentRaw), mergeKeyPath);
}

/**
 * Обновляет слот на новое значение. Вызывающий код обязан заранее убедиться
 * через `isTomlSlotUnchanged`, что слот не менялся пользователем (либо
 * действовать в режиме `--force`).
 */
export function updateTomlSlot(
  currentRaw: string,
  mergeKeyPath: string,
  oldValue: unknown,
  newValue: unknown,
): string {
  const root = parseTomlRoot(currentRaw);
  updateSlot(root, mergeKeyPath, oldValue, newValue);
  return stringifyTomlRoot(root);
}

/**
 * Удаляет слот, если он ещё существует (объектный слот — безусловно по
 * пути; массивный — только совпадающий по значению элемент). `removed:
 * false`, если удалять было нечего (пользователь уже удалил слот вручную).
 */
export function removeTomlSlot(
  currentRaw: string,
  mergeKeyPath: string,
  expectedValue: unknown,
): { content: string; removed: boolean } {
  const root = parseTomlRoot(currentRaw);
  const removed = removeSlot(root, mergeKeyPath, expectedValue);
  return { content: stringifyTomlRoot(root), removed };
}
