function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return isPlainObject(parsed) ? parsed : undefined;
}

function deepMergeObjects(
  current: Record<string, unknown>,
  fragment: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current };

  for (const [key, fragmentValue] of Object.entries(fragment)) {
    const currentValue = result[key];
    result[key] =
      isPlainObject(currentValue) && isPlainObject(fragmentValue)
        ? deepMergeObjects(currentValue, fragmentValue)
        : fragmentValue;
  }

  return result;
}

export function isJsonMergeDestructive(currentRaw: string, fragmentRaw: string): boolean {
  const current = parseJsonObject(currentRaw);
  const fragment = parseJsonObject(fragmentRaw);

  if (!current || !fragment) return true;

  return isDestructive(current, fragment);
}

function isDestructive(current: Record<string, unknown>, fragment: Record<string, unknown>): boolean {
  return Object.entries(fragment).some(([key, fragmentValue]) => {
    if (!(key in current)) return false;

    const currentValue = current[key];
    if (isPlainObject(currentValue) && isPlainObject(fragmentValue)) {
      return isDestructive(currentValue, fragmentValue);
    }

    return JSON.stringify(currentValue) !== JSON.stringify(fragmentValue);
  });
}

export function mergeJsonContent(currentRaw: string | undefined, fragmentRaw: string): string {
  const fragment = parseJsonObject(fragmentRaw);
  if (!fragment) {
    throw new Error("merge-файл должен содержать JSON-объект верхнего уровня");
  }

  if (currentRaw === undefined) {
    return `${JSON.stringify(fragment, null, 2)}\n`;
  }

  const current = parseJsonObject(currentRaw);
  if (!current) {
    throw new Error("существующий файл повреждён: невалидный JSON-объект, мёрж невозможен");
  }

  const merged = deepMergeObjects(current, fragment);
  return `${JSON.stringify(merged, null, 2)}\n`;
}
