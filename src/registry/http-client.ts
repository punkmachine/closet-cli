import type { ItemFileContent, ItemMetadata, RegistryClient } from "./types.js";

interface ErrorResponseBody {
  error?: string;
}

export class HttpRegistryClient implements RegistryClient {
  constructor(private readonly baseUrl: string) {}

  async listItems(): Promise<ItemMetadata[]> {
    const response = await this.fetch("/v1/items");
    return (await response.json()) as ItemMetadata[];
  }

  async getItem(name: string): Promise<ItemMetadata | undefined> {
    const response = await this.fetch(`/v1/items/${encodeURIComponent(name)}`, [404]);
    if (response.status === 404) {
      return undefined;
    }
    return (await response.json()) as ItemMetadata;
  }

  async getItemFiles(name: string, version: string): Promise<ItemFileContent[]> {
    const path = `/v1/items/${encodeURIComponent(name)}/${encodeURIComponent(version)}/files`;
    const response = await this.fetch(path);
    return (await response.json()) as ItemFileContent[];
  }

  private async fetch(path: string, acceptStatuses: number[] = []): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Не удалось обратиться к registry (${url}): ${details}`);
    }

    if (response.ok || acceptStatuses.includes(response.status)) {
      return response;
    }

    let details = "";
    try {
      const body = (await response.json()) as ErrorResponseBody;
      if (body.error) {
        details = `: ${body.error}`;
      }
    } catch {
      // Тело ответа не JSON или пустое — используем только статус-код.
    }

    throw new Error(`Registry вернул ошибку GET ${url} -> ${response.status}${details}`);
  }
}
