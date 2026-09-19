/**
 * Общий, независимый от формата сериализации движок именованных слотов
 * (plan.md, 2.7, модель B+C): владение merge-файлом ограничено конкретным
 * именованным слотом (`mergeKeyPath`), а не всем объектом целиком.
 *
 * `mergeKeyPath` — dot-путь до слота, например `"mcpServers.gitflow-fs"`
 * или `"statusLine"` (объектный слот: значение целиком принадлежит одному
 * плагину) либо `"hooks.PreToolUse[]"` (массивный слот: плагин владеет ровно
 * одним элементом внутри массива, суффикс `[]` — часть синтаксиса пути).
 *
 * Владение не отслеживается меткой внутри самого значения — вместо этого
 * вызывающий код (будущий шаг plan.md 2.6/2.8) хранит запомненное значение
 * слота в `closet-cli.json` (`files[].mergeValue`) и передаёт его сюда как
 * `expectedValue`/`oldValue` для сравнения через `deepEqual`.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }

  return false;
}

interface ObjectSlotPath {
  kind: "object";
  segments: string[];
}

interface ArraySlotPath {
  kind: "array";
  segments: string[];
}

type SlotPath = ObjectSlotPath | ArraySlotPath;

/**
 * `mergeKeyPath` приходит из registry (метаданные плагина) — со стороны CLI
 * это не полностью доверенные данные (self-hosted реестр под чужим админ-
 * токеном тоже остаётся внешним источником). Сегменты `__proto__`/
 * `constructor`/`prototype` запрещены, чтобы `container[segment] = value`
 * в `setObjectSlot`/`ensureContainer` не мог замусорить прототип объекта.
 */
const DANGEROUS_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Разбирает `mergeKeyPath` на сегменты. Суффикс `[]` в конце помечает
 * массивный слот (сегменты — путь до самого массива, без `[]`).
 */
function parseSlotPath(mergeKeyPath: string): SlotPath {
  const isArray = mergeKeyPath.endsWith("[]");
  const raw = isArray ? mergeKeyPath.slice(0, -2) : mergeKeyPath;
  const segments = raw.split(".");

  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`некорректный mergeKeyPath: "${mergeKeyPath}"`);
  }
  if (segments.some((segment) => DANGEROUS_SEGMENTS.has(segment))) {
    throw new Error(`небезопасный mergeKeyPath: "${mergeKeyPath}" (запрещённый сегмент)`);
  }

  return { kind: isArray ? "array" : "object", segments };
}

/**
 * Проходит по `segments`, начиная от `root`, и возвращает контейнер-объект
 * на конце пути. `undefined`, если какого-то промежуточного ключа нет.
 * Бросает ошибку, если промежуточное значение существует, но не является
 * объектом (реальный конфликт, а не отсутствие данных).
 */
function getContainer(root: Record<string, unknown>, segments: string[]): Record<string, unknown> | undefined {
  let current: Record<string, unknown> = root;

  for (const segment of segments) {
    const next = current[segment];
    if (next === undefined) return undefined;
    if (!isPlainObject(next)) {
      throw new Error(`ожидался объект по пути "${segments.join(".")}", но найдено значение другого типа`);
    }
    current = next;
  }

  return current;
}

/** Как `getContainer`, но создаёт недостающие промежуточные объекты. */
function ensureContainer(root: Record<string, unknown>, segments: string[]): Record<string, unknown> {
  let current: Record<string, unknown> = root;

  for (const segment of segments) {
    const next = current[segment];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
      continue;
    }
    if (!isPlainObject(next)) {
      throw new Error(`ожидался объект по пути "${segments.join(".")}", но найдено значение другого типа`);
    }
    current = next;
  }

  return current;
}

function splitLastSegment(segments: string[]): { parentSegments: string[]; key: string } {
  return { parentSegments: segments.slice(0, -1), key: segments[segments.length - 1]! };
}

function getObjectSlot(root: Record<string, unknown>, segments: string[]): unknown {
  const { parentSegments, key } = splitLastSegment(segments);
  const container = getContainer(root, parentSegments);
  return container === undefined ? undefined : container[key];
}

function setObjectSlot(root: Record<string, unknown>, segments: string[], value: unknown): void {
  const { parentSegments, key } = splitLastSegment(segments);
  ensureContainer(root, parentSegments)[key] = value;
}

function deleteObjectSlot(root: Record<string, unknown>, segments: string[]): boolean {
  const { parentSegments, key } = splitLastSegment(segments);
  const container = getContainer(root, parentSegments);
  if (container === undefined || !(key in container)) return false;
  delete container[key];
  return true;
}

function getArraySlot(root: Record<string, unknown>, segments: string[]): unknown[] | undefined {
  const { parentSegments, key } = splitLastSegment(segments);
  const container = getContainer(root, parentSegments);
  if (container === undefined) return undefined;

  const value = container[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`ожидался массив по пути "${segments.join(".")}", но найдено значение другого типа`);
  }
  return value;
}

function appendArraySlotEntry(root: Record<string, unknown>, segments: string[], value: unknown): void {
  const { parentSegments, key } = splitLastSegment(segments);
  const container = ensureContainer(root, parentSegments);
  const existing = container[key];

  if (existing === undefined) {
    container[key] = [value];
    return;
  }
  if (!Array.isArray(existing)) {
    throw new Error(`ожидался массив по пути "${segments.join(".")}", но найдено значение другого типа`);
  }
  existing.push(value);
}

function findArraySlotEntryIndex(root: Record<string, unknown>, segments: string[], value: unknown): number {
  const array = getArraySlot(root, segments);
  return array === undefined ? -1 : array.findIndex((entry) => deepEqual(entry, value));
}

function removeArraySlotEntry(root: Record<string, unknown>, segments: string[], value: unknown): boolean {
  const array = getArraySlot(root, segments);
  if (array === undefined) return false;

  const index = array.findIndex((entry) => deepEqual(entry, value));
  if (index === -1) return false;

  array.splice(index, 1);
  return true;
}

/**
 * Проверяет, занят ли слот каким-либо значением — используется при первой
 * установке плагина, чтобы отличить "слот свободен" (можно ставить) от
 * "слот занят чужим значением" (реальный конфликт). Для объектного слота —
 * занятость по факту наличия ключа, независимо от того, что в нём лежит.
 * Для массивного слота понятие занятости неприменимо: массив общий, и
 * несколько плагинов законно владеют разными его элементами — конфликта
 * между элементами одного массива в модели B+C не бывает, поэтому всегда
 * `false` (идемпотентность конкретного элемента проверяется отдельно через
 * `isSlotUnchanged`, не через занятость всего слота).
 */
export function isSlotOccupied(root: Record<string, unknown>, mergeKeyPath: string): boolean {
  const slot = parseSlotPath(mergeKeyPath);
  if (slot.kind === "array") return false;

  const { parentSegments, key } = splitLastSegment(slot.segments);
  const container = getContainer(root, parentSegments);
  return container !== undefined && key in container;
}

/**
 * Устанавливает значение владеемого слота при первой установке плагина:
 * объектный слот — присваивание по пути, массивный — добавление элемента
 * в конец массива (создавая массив, если его ещё нет).
 */
export function installSlot(root: Record<string, unknown>, mergeKeyPath: string, value: unknown): void {
  const slot = parseSlotPath(mergeKeyPath);
  if (slot.kind === "object") {
    setObjectSlot(root, slot.segments, value);
  } else {
    appendArraySlotEntry(root, slot.segments, value);
  }
}

/**
 * Проверяет, что слот всё ещё равен `expectedValue` (запомненному в
 * `closet-cli.json` при установке) — то есть пользователь его не менял
 * вручную. Используется перед `update`/`remove`, чтобы не затереть правки.
 */
export function isSlotUnchanged(root: Record<string, unknown>, mergeKeyPath: string, expectedValue: unknown): boolean {
  const slot = parseSlotPath(mergeKeyPath);
  if (slot.kind === "object") {
    return deepEqual(getObjectSlot(root, slot.segments), expectedValue);
  }
  return findArraySlotEntryIndex(root, slot.segments, expectedValue) !== -1;
}

/**
 * Обновляет слот на новое значение. Вызывающий код обязан заранее убедиться
 * (через `isSlotUnchanged` с `oldValue`) либо явно перезаписать в режиме
 * `--force`, что затирать текущее значение безопасно.
 *
 * Для массивного слота `oldValue` обязателен, чтобы найти, какой именно
 * элемент менять (путь указывает только на весь массив, а не на элемент).
 */
export function updateSlot(
  root: Record<string, unknown>,
  mergeKeyPath: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  const slot = parseSlotPath(mergeKeyPath);
  if (slot.kind === "object") {
    setObjectSlot(root, slot.segments, newValue);
    return;
  }

  const index = findArraySlotEntryIndex(root, slot.segments, oldValue);
  if (index === -1) {
    throw new Error(
      `updateSlot: элемент массива по пути "${mergeKeyPath}" не найден (ожидалось ${JSON.stringify(oldValue)})`,
    );
  }
  getArraySlot(root, slot.segments)![index] = newValue;
}

/**
 * Удаляет слот. Объектный слот удаляется безусловно по пути (путь уже
 * однозначно определяет владение). Массивный слот требует `expectedValue`,
 * чтобы найти именно свой элемент среди чужих в том же массиве (`hooks.<event>[]`
 * — несколько плагинов могут писать в один и тот же массив).
 *
 * Возвращает `false`, если слот отсутствовал или (для массива) элемент не
 * найден — например, был уже удалён вручную.
 */
export function removeSlot(root: Record<string, unknown>, mergeKeyPath: string, expectedValue: unknown): boolean {
  const slot = parseSlotPath(mergeKeyPath);
  if (slot.kind === "object") {
    return deleteObjectSlot(root, slot.segments);
  }
  return removeArraySlotEntry(root, slot.segments, expectedValue);
}
