import fs from "node:fs";
import path from "node:path";

/**
 * Создаёт `.gitignore` в корне проекта (если его нет) либо дописывает `entry`
 * в самый конец, если такой строки там ещё нет.
 */
export function ensureGitignoreEntry(projectRoot: string, entry: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${entry}\n`, "utf-8");
    return;
  }

  const content = fs.readFileSync(gitignorePath, "utf-8");
  const alreadyPresent = content.split(/\r?\n/).some((line) => line === entry);

  if (alreadyPresent) {
    return;
  }

  const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
  fs.appendFileSync(gitignorePath, `${needsLeadingNewline ? "\n" : ""}${entry}\n`, "utf-8");
}
