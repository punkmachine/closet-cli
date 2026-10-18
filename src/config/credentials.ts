import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { CREDENTIALS_FILE_NAME, HOME_ENV_VAR, TOKEN_ENV_VAR, USER_DIR_NAME } from "./paths.js";
import { readLegacyToken, type ProjectConfig } from "./project-config.js";

/**
 * Персональные учётные данные: токены реестров в `~/.closet-cli/credentials.json`
 * (вне репозитория). Ключ — нормализованный `registry.host`: токен принадлежит
 * реестру, а не проекту, поэтому один токен работает во всех проектах.
 */
export const credentialsSchema = z.object({
  registries: z.record(z.string(), z.object({ token: z.string() })),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export type TokenSource = "env" | "credentials" | "legacy-project-config";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/**
 * Путь до `credentials.json` с учётом `CLOSET_CLI_HOME`.
 */
export function credentialsPath(): string {
  const dir = process.env[HOME_ENV_VAR] || path.join(os.homedir(), USER_DIR_NAME);
  return path.join(dir, CREDENTIALS_FILE_NAME);
}

/**
 * Нормализует адрес реестра для ключа в `credentials.json`: origin без
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
 * Читает `credentials.json`. Отсутствующий файл — пустые данные; повреждённый — ошибка.
 */
export function readCredentials(): Credentials {
  const filePath = credentialsPath();
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
 * Записывает `credentials.json` (создаёт каталог, права `0600` на POSIX;
 * на Windows chmod ничего не даёт — полагаемся на профиль пользователя).
 */
export function writeCredentials(credentials: Credentials): void {
  const filePath = credentialsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(credentials, null, 2), { encoding: "utf-8", mode: 0o600 });
  // mode в writeFileSync не действует на уже существующий файл.
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

/**
 * Сохраняет токен для реестра `host`, не трогая записи других реестров.
 */
export function saveToken(host: string, token: string): void {
  const credentials = readCredentials();
  credentials.registries[normalizeRegistryHost(host)] = { token };
  writeCredentials(credentials);
}

/**
 * Удаляет запись для `host`. Если записей не осталось — удаляет файл.
 * Возвращает `true`, если запись была.
 */
export function removeCredentials(host: string): boolean {
  const credentials = readCredentials();
  const key = normalizeRegistryHost(host);
  if (!(key in credentials.registries)) {
    return false;
  }

  delete credentials.registries[key];
  if (Object.keys(credentials.registries).length === 0) {
    fs.rmSync(credentialsPath(), { force: true });
  } else {
    writeCredentials(credentials);
  }
  return true;
}

/**
 * Токен для реестра `host`. Приоритет: `CLOSET_CLI_TOKEN` → `credentials.json`
 * → (legacy) `registry.token` из `closet-cli.json`. `undefined` — токена нет нигде.
 */
export function resolveToken(host: string, projectConfig?: ProjectConfig): ResolvedToken | undefined {
  const fromEnv = process.env[TOKEN_ENV_VAR];
  if (fromEnv) {
    return { token: fromEnv, source: "env" };
  }

  const stored = readCredentials().registries[normalizeRegistryHost(host)]?.token;
  if (stored) {
    return { token: stored, source: "credentials" };
  }

  const legacy = projectConfig ? readLegacyToken(projectConfig) : undefined;
  if (legacy) {
    return { token: legacy, source: "legacy-project-config" };
  }

  return undefined;
}
