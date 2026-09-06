import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as semver from "semver";
import type { ItemFileContent, ItemMetadata, RegistryClient } from "./types.js";

/**
 * RegistryClient implementation backed by local JSON fixtures on disk,
 * structured identically to the future HTTP registry API:
 *
 *   <fixturesDir>/index.json
 *   <fixturesDir>/items/<type>/<name>/<version>/<...files>
 */
export class FixtureRegistryClient implements RegistryClient {
  constructor(private readonly fixturesDir: string) {}

  async listItems(): Promise<ItemMetadata[]> {
    const index = await this.readIndex();

    const latestByName = new Map<string, ItemMetadata>();
    for (const item of index) {
      const current = latestByName.get(item.name);
      if (!current || semver.gt(item.version, current.version)) {
        latestByName.set(item.name, item);
      }
    }

    return [...latestByName.values()];
  }

  async getItem(name: string): Promise<ItemMetadata | undefined> {
    const index = await this.readIndex();

    let latest: ItemMetadata | undefined;
    for (const item of index) {
      if (item.name !== name) continue;
      if (!latest || semver.gt(item.version, latest.version)) {
        latest = item;
      }
    }

    return latest;
  }

  async getItemFiles(name: string, version: string): Promise<ItemFileContent[]> {
    const index = await this.readIndex();

    const item = index.find((entry) => entry.name === name && entry.version === version);
    if (!item) {
      throw new Error(`Registry item not found: "${name}@${version}"`);
    }

    return Promise.all(
      item.files.map(async (file) => {
        const filePath = join(
          this.fixturesDir,
          "items",
          item.type,
          item.name,
          item.version,
          file.path,
        );
        const content = await readFile(filePath, "utf-8");
        return { ...file, content };
      }),
    );
  }

  private async readIndex(): Promise<ItemMetadata[]> {
    const indexPath = join(this.fixturesDir, "index.json");
    const raw = await readFile(indexPath, "utf-8");
    return JSON.parse(raw) as ItemMetadata[];
  }
}
