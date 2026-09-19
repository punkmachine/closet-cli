import type { PluginBundle, RegistryClient } from "../registry/types.js";

/**
 * Ошибка резолва графа зависимостей плагинов: плагин не найден в registry
 * либо обнаружена циклическая зависимость.
 */
export class DependencyResolutionError extends Error {}

/**
 * Рекурсивно резолвит транзитивные зависимости для набора корневых slug'ов
 * через `registry.getPluginBundle(slug, "latest")` и возвращает их bundle'ы
 * в топологически отсортированном порядке (зависимости раньше зависящих от
 * них плагинов).
 *
 * Зависимости в bundle-ответе сервера — только slug'и, без версии (сервер
 * их не пиннит, plan.md раздел 0/4 п.9), поэтому резолвятся всегда на
 * "latest" версию, независимо от версии плагина, который их запросил.
 *
 * - Дедуплицирует плагины по slug.
 * - Бросает `DependencyResolutionError`, если плагин не найден в registry
 *   либо обнаружен цикл в графе зависимостей.
 */
export async function resolvePluginClosure(
  registry: RegistryClient,
  rootSlugs: string[],
): Promise<PluginBundle[]> {
  const resolved = new Map<string, PluginBundle>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  async function visit(slug: string): Promise<void> {
    if (resolved.has(slug)) return;

    if (visiting.has(slug)) {
      const cycleStart = stack.indexOf(slug);
      const cyclePath = [...stack.slice(cycleStart), slug];
      throw new DependencyResolutionError(
        `Обнаружена циклическая зависимость: ${cyclePath.join(" -> ")}`,
      );
    }

    const bundle = await registry.getPluginBundle(slug, "latest");
    if (!bundle) {
      throw new DependencyResolutionError(`Плагин "${slug}" не найден в registry`);
    }

    visiting.add(slug);
    stack.push(slug);

    for (const dependencySlug of bundle.dependencies) {
      await visit(dependencySlug);
    }

    stack.pop();
    visiting.delete(slug);

    resolved.set(slug, bundle);
  }

  for (const slug of rootSlugs) {
    await visit(slug);
  }

  return [...resolved.values()];
}
