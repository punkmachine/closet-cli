export const ITEM_TYPES = ["rules", "skills", "commands", "agents", "hooks", "mcp", "statusline"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export interface ItemFile {
  /**
   * Path relative to `.claude/<type>/`, e.g. "naming-conventions.md" or
   * "git-commit-helper/SKILL.md". Ignored in favor of project-root placement
   * when `rootPath` is true.
   */
  path: string;
  /**
   * If true, `path` is resolved relative to the project root instead of
   * `.claude/<type>/` (e.g. `.mcp.json`, `.claude/scripts/context-monitor.py`).
   */
  rootPath?: boolean;
  /**
   * If true, the file's JSON content is shallow-merged (top-level keys) into
   * the existing destination file instead of overwriting it. Used to add
   * keys like `statusLine` into an already-populated `.claude/settings.json`
   * without touching unrelated keys.
   */
  merge?: boolean;
  /**
   * If true, the literal token `{{projectRoot}}` in the file's content is
   * replaced with the absolute project root path (forward slashes) at
   * install time, before conflict detection and writing.
   */
  template?: boolean;
}

export interface ItemFileContent extends ItemFile {
  content: string;
}

export interface ItemMetadata {
  /** Unique item name across the whole registry (across all types) */
  name: string;
  type: ItemType;
  /** semver, e.g. "1.0.0" */
  version: string;
  description: string;
  /** Names of other items this item depends on (by name, without type) */
  dependencies: string[];
  files: ItemFile[];
}

export interface RegistryClient {
  /** Latest version of every unique item */
  listItems(): Promise<ItemMetadata[]>;
  /** Latest version by name */
  getItem(name: string): Promise<ItemMetadata | undefined>;
  /** File contents for a specific version */
  getItemFiles(name: string, version: string): Promise<ItemFileContent[]>;
}
