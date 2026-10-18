import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { ensureGitignoreEntry } from "./gitignore.js";
import { LOCAL_CONFIG_FILE_NAME, TOKEN_ENV_VAR } from "./paths.js";
import { readLegacyToken, type ProjectConfig } from "./project-config.js";

/**
 * Персональные учётные данные проекта: токены реестров в `closet-cli.local.json`
 * в корне проекта (файл в `.gitignore`, не коммитится). Ключ — нормализованный
 * `registry.host`: токен, выданный одним реестром, не уйдёт на другой после
 * смены `registry.host`.
 */
export const credentialsSchema = z.object({
  registries: z.record(z.string(), z.object({ token: z.string() })),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export type TokenSource = "env" | "local-config" | "legacy-project-config";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/**
 * Путь до `closet-cli.local.json` в корне проекта.
 */
export function credentialsPath(projectRoot: string): string {
  return path.join(projectRoot, LOCAL_CONFIG_FILE_NAME);
}

/**
 * Нормализует адрес реестра для ключа в `closet-cli.local.json`: origin без
 * завершающего `/`, хост в нижнем регистре. Не-URL возвращается как есть.
 */
export function normalizeRegistryHost(host: string): string {
  try {
    return new URL(host).origin;
  } catch {
    return host.replace(/\/+$/, "");
  }
}

/**
 * Читает `closet-cli.local.json`. Отсутствующий файл — пустые данные; повреждённый — ошибка.
 */
export function readCredentials(projectRoot: string): Credentials {
  const filePath = credentialsPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return { registries: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Файл ${filePath} повреждён: невалидный JSON (${details}).`);
  }

  const result = credentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Файл ${filePath} повреждён: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Записывает `closet-cli.local.json` (права `0600` на POSIX; на Windows chmod
 * ничего не даёт). Сначала гарантирует запись в `.gitignore`, чтобы токен не
 * успел попасть под `git add`.
 */
export function writeCredentials(projectRoot: string, credentials: Credentials): void {
  const filePath = credentialsPath(projectRoot);
  ensureGitignoreEntry(projectRoot, LOCAL_CONFIG_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(credentials, null, 2), { encoding: "utf-8", mode: 0o600 });
  // mode в writeFileSync не действует на уже существующий файл.
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

/**
 * Сохраняет токен для реестра `host`, не трогая записи других реестров.
 */
export function saveToken(projectRoot: string, host: string, token: string): void {
  const credentials = readCredentials(projectRoot);
  credentials.registries[normalizeRegistryHost(host)] = { token };
  writeCredentials(projectRoot, credentials);
}

/**
 * Удаляет запись для `host`. Если записей не осталось — удаляет файл.
 * Возвращает `true`, если запись была.
 */
export function removeCredentials(projectRoot: string, host: string): boolean {
  const credentials = readCredentials(projectRoot);
  const key = normalizeRegistryHost(host);
  if (!(key in credentials.registries)) {
    return false;
  }

  delete credentials.registries[key];
  if (Object.keys(credentials.registries).length === 0) {
    fs.rmSync(credentialsPath(projectRoot), { force: true });
  } else {
    writeCredentials(projectRoot, credentials);
  }
  return true;
}

/**
 * Токен для реестра `host`. Приоритет: `CLOSET_CLI_TOKEN` → `closet-cli.local.json`
 * → (legacy) `registry.token` из `closet-cli.json`. `undefined` — токена нет нигде.
 */
export function resolveToken(
  projectRoot: string,
  host: string,
  projectConfig?: ProjectConfig,
): ResolvedToken | undefined {
  const fromEnv = process.env[TOKEN_ENV_VAR];
  if (fromEnv) {
    return { token: fromEnv, source: "env" };
  }

  const stored = readCredentials(projectRoot).registries[normalizeRegistryHost(host)]?.token;
  if (stored) {
    return { token: stored, source: "local-config" };
  }

  const legacy = projectConfig ? readLegacyToken(projectConfig) : undefined;
  if (legacy) {
    return { token: legacy, source: "legacy-project-config" };
  }

  return undefined;
}
