import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import pc from "picocolors";

import { registerInitCommand } from "./commands/init.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerListCommand } from "./commands/list.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerUpdateCommand } from "./commands/update.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, "..");

const templatesDir = path.join(packageRoot, "src", "templates");

const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8")) as {
  version: string;
  description: string;
};

const program = new Command();

program.name("closet-cli").description(pkg.description).version(pkg.version);

registerInitCommand(program, templatesDir);
registerInstallCommand(program, pkg.version);
registerUpdateCommand(program);
registerRemoveCommand(program);
registerListCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const details = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`Неожиданная ошибка: ${details}`));
  // process.exitCode, не process.exit — см. комментарий в src/commands/install.ts
  // про краш libuv на Windows/Node 24 после ≥2 вызовов fetch в процессе.
  process.exitCode = 1;
});
