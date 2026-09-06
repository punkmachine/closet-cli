import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import pc from "picocolors";

import { registerAddCommand } from "./commands/add.js";
import { registerInitCommand } from "./commands/init.js";
import { registerListCommand } from "./commands/list.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerUpdateCommand } from "./commands/update.js";
import { HttpRegistryClient } from "./registry/http-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, "..");

try {
  process.loadEnvFile(path.join(packageRoot, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const templatesDir = path.join(packageRoot, "src", "templates");

const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8")) as {
  version: string;
  description: string;
};

const registryUrl = process.env.PUNK_AI_REGISTRY_URL;
if (!registryUrl) {
  console.error(
    pc.red(
      `PUNK_AI_REGISTRY_URL не задан. Укажи его в ${path.join(packageRoot, ".env")} или в переменных окружения.`,
    ),
  );
  process.exit(1);
}
const registry = new HttpRegistryClient(registryUrl);

const program = new Command();

program.name("punk-ai").description(pkg.description).version(pkg.version);

registerInitCommand(program, templatesDir, registryUrl);
registerAddCommand(program, registry);
registerListCommand(program, registry);
registerRemoveCommand(program);
registerUpdateCommand(program, registry);

program.parseAsync(process.argv).catch((error: unknown) => {
  const details = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`Неожиданная ошибка: ${details}`));
  process.exit(1);
});
