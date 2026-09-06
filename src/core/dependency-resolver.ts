import type { ItemMetadata, RegistryClient } from "../registry/types.js";

/**
 * Ошибка резолва графа зависимостей items: item не найден в registry либо
 * обнаружена циклическая зависимость.
 */
export class DependencyResolutionError extends Error {}

/**
 * Рекурсивно резолвит зависимости для набора корневых items через
 * `registry.getItem(name)` и возвращает их в топологически отсортированном
 * порядке (зависимости раньше зависящих от них items).
 *
 * - Дедуплицирует items по имени.
 * - Бросает `DependencyResolutionError`, если item не найден в registry либо
 *   обнаружен цикл в графе зависимостей.
 */
export async function resolveDependencies(
  registry: RegistryClient,
  rootNames: string[],
): Promise<ItemMetadata[]> {
  const resolved = new Map<string, ItemMetadata>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  async function visit(name: string): Promise<void> {
    if (resolved.has(name)) return;

    if (visiting.has(name)) {
      const cycleStart = stack.indexOf(name);
      const cyclePath = [...stack.slice(cycleStart), name];
      throw new DependencyResolutionError(
        `Обнаружена циклическая зависимость: ${cyclePath.join(" -> ")}`,
      );
    }

    const item = await registry.getItem(name);
    if (!item) {
      throw new DependencyResolutionError(`Item "${name}" не найден в registry`);
    }

    visiting.add(name);
    stack.push(name);

    for (const dependencyName of item.dependencies) {
      await visit(dependencyName);
    }

    stack.pop();
    visiting.delete(name);

    resolved.set(name, item);
  }

  for (const name of rootNames) {
    await visit(name);
  }

  return [...resolved.values()];
}
