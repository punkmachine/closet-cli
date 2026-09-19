import type { PluginBundle, PluginListItem, RegistryClient } from "./types.js";

interface ErrorResponseBody {
  error?: string;
}

/**
 * `HttpRegistryClient` под реальный контракт closet-registry (plan.md,
 * раздел 0): bundle-эндпоинт чтения + `Authorization: Bearer <token>` на
 * КАЖДЫЙ запрос под `/v1/*` — сервер требует токен и на чтение, не только
 * на запись (см. `closet-registry/CLAUDE.md`, раздел про `admin-auth.ts`).
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
    try {
      const responseBody = (await response.json()) as ErrorResponseBody;
      if (responseBody.error) {
        details = `: ${responseBody.error}`;
      }
    } catch {
      // Тело ответа не JSON или пустое — используем только статус-код.
    }

    if (response.status === 401) {
      throw new Error(
        `Registry отклонил запрос ${method} ${url} -> 401 Unauthorized. Проверьте registry.token в closet-cli.json${details}`,
      );
    }

    throw new Error(`Registry вернул ошибку ${method} ${url} -> ${response.status}${details}`);
  }
}
