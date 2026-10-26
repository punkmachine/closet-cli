import fs from "node:fs";
import path from "node:path";

import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import type { HarnessDescriptor } from "./types.js";

/** Порядок важен: он же порядок в промптах и сводках `init`. */
export const HARNESSES = [codex, claudeCode] as const satisfies readonly HarnessDescriptor[];

/** Кортеж (нужен для `z.enum`); порядок тот же, что в `HARNESSES`. */
export const HARNESS_IDS = [codex.id, claudeCode.id] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

export function getHarness(id: HarnessId): HarnessDescriptor {
  const harness = (HARNESSES as readonly HarnessDescriptor[]).find((h) => h.id === id);
  if (harness === undefined) {
    throw new Error(`Неизвестный harness "${id}".`);
  }
  return harness;
}

/** Есть ли в проекте папка harness'а (`.claude/`, `.codex/`). */
export function detectHarness(harness: HarnessDescriptor, projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, harness.rootDir));
}
