import { getHarness, HARNESS_IDS, type HarnessId } from "../harnesses/registry.js";
import type { PluginComponent } from "../harnesses/types.js";

/**
 * Пути хранилища `.agents/` (PLAN.md, §3). Все пути — POSIX, относительно корня проекта.
 *
 * `ai: null` → `.agents/<component>/<path>`;
 * `ai: X`    → `.agents/<component>/.<X>/<path>` (ai-специфичные файлы с одинаковыми именами не сталкиваются),
 *               кроме `native`-компонентов ИИ (Codex `agents`): они лежат прямо в `.agents/<component>/<path>`.
 */
export const STORAGE_DIR = ".agents";

export interface StorageLocation {
  component: PluginComponent;
  ai: HarnessId | null;
  /** Путь внутри компонента, без dot-сегмента ai. */
  relativePath: string;
}

/**
 * Подпапка хранилища для файлов конкретного ИИ. Если ИИ читает `.agents/<component>`
 * сам (placement `native`), его файлы лежат без подпапки — иначе он их не увидит.
 */
export function storageAiSegments(component: PluginComponent, ai: HarnessId | null): string[] {
  if (ai === null || getHarness(ai).placements[component].kind === "native") return [];
  return [`.${ai}`];
}

export function storagePath({ component, ai, relativePath }: StorageLocation): string {
  return [STORAGE_DIR, component, ...storageAiSegments(component, ai), relativePath].join("/");
}

/**
 * Обратная операция к `storagePath`. Возвращает `null`, если путь не лежит
 * в `.agents/<component>/` (в т.ч. неизвестный компонент).
 */
export function parseStoragePath(
  storageRelPath: string,
  components: readonly PluginComponent[],
): StorageLocation | null {
  const [root, component, ...rest] = storageRelPath.split("/");
  if (root !== STORAGE_DIR || component === undefined || rest.length === 0) return null;
  if (!(components as readonly string[]).includes(component)) return null;

  const [first, ...tail] = rest;
  const aiId = first?.startsWith(".") ? first.slice(1) : undefined;
  if (aiId !== undefined && (HARNESS_IDS as readonly string[]).includes(aiId) && tail.length > 0) {
    return { component: component as PluginComponent, ai: aiId as HarnessId, relativePath: tail.join("/") };
  }
  return { component: component as PluginComponent, ai: null, relativePath: rest.join("/") };
}
