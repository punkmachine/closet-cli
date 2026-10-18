import type { PluginBundle, PluginListItem, RegistryClient, RegistryUser } from "./types.js";

interface ErrorResponseBody {
  error?: string;
  code?: string;
}

/**
 * Проблема авторизации/прав (`401`/`403`): позволяет командам отличать её от
 * прочих ошибок реестра. `message` уже содержит текст для пользователя.
 */
export class RegistryAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: string | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message);
    this.name = "RegistryAuthError";
  }
}

function describeAuthError(status: 401 | 403, code: string | undefined, retryAfter: number | undefined): string {
  if (status === 401) {
    return "Токен недействителен: выпустите новый в админке реестра и обновите его (`closet-cli login`).";
  }
  switch (code) {
    case "account_disabled":
      return "Аккаунт отключён, обратитесь к администратору реестра.";
    case "account_locked":
      return retryAfter !== undefined
        ? `Аккаунт временно заблокирован, повторите через ${retryAfter} с.`
        : "Аккаунт временно заблокирован, повторите позже.";
    case "password_change_required":
      return "Войдите в админку реестра и смените временный пароль.";
    default:
      return "Недостаточно прав для операции.";
  }
}

/**
 * `HttpRegistryClient` под контракт closet-registry (`@closet/contract`):
 * bundle-эндпоинт чтения + `Authorization: Bearer <clt_…>` на КАЖДЫЙ запрос
 * под `/v1/*` — сервер требует токен и на чтение (публичен только `/health`).
 * Токен резолвится вызывающим кодом (`config/credentials.ts`).
 */
export class HttpRegistryClient implements RegistryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  async getPluginBundle(slug: string, version: string): Promise<PluginBundle | undefined> {
    const path = `/v1/plugins/${encodeURIComponent(slug)}/${encodeURIComponent(version)}`;
    const response = await this.request("GET", path, undefined, [404]);
    if (response.status === 404) {
      return undefined;
    }
    return (await response.json()) as PluginBundle;
  }

  async recordInstall(slug: string, version: string, cliVersion: string): Promise<void> {
    await this.request("POST", "/v1/stats/installs", { slug, version, cliVersion });
  }

  async listPlugins(): Promise<PluginListItem[]> {
    const response = await this.request("GET", "/v1/plugins", undefined);
    const body = (await response.json()) as { plugins: PluginListItem[] };
    return body.plugins;
  }

  async getMe(): Promise<RegistryUser> {
    const response = await this.request("GET", "/v1/auth/me", undefined);
    const body = (await response.json()) as { user: RegistryUser };
    return body.user;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    acceptStatuses: number[] = [],
  ): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;

    const headers: Record<string, string> = {};
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Не удалось обратиться к registry (${url}): ${details}`);
    }

    if (response.ok || acceptStatuses.includes(response.status)) {
      return response;
    }

    let details = "";
    let errorCode: string | undefined;
    try {
      const responseBody = (await response.json()) as ErrorResponseBody;
      errorCode = responseBody.code;
      if (responseBody.error) {
        details = `: ${responseBody.error}`;
      }
    } catch {
      // Тело ответа не JSON или пустое — используем только статус-код.
    }

    if (response.status === 401 || response.status === 403) {
      const retryHeader = Number(response.headers.get("retry-after"));
      const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined;
      throw new RegistryAuthError(
        describeAuthError(response.status, errorCode, retryAfter),
        response.status,
        errorCode,
        retryAfter,
      );
    }

    throw new Error(`Registry вернул ошибку ${method} ${url} -> ${response.status}${details}`);
  }
}
