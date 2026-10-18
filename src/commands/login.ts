import type { Command } from "commander";
import pc from "picocolors";
import * as p from "@clack/prompts";

import { normalizeRegistryHost, removeCredentials, resolveToken, saveToken } from "../config/credentials.js";
import { projectConfigExists, readProjectConfig } from "../config/project-config.js";
import { HttpRegistryClient } from "../registry/http-client.js";

interface LoginCommandOptions {
  host?: string;
  token?: string;
}

interface HostOptions {
  host?: string;
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function isValidHost(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function printError(message: string): void {
  console.error(pc.red(message));
  process.exitCode = 1;
}

/**
 * Читает проект, если он инициализирован. Битый конфиг — ошибка; отсутствие — `undefined`.
 */
function tryReadConfig() {
  const projectRoot = process.cwd();
  if (!projectConfigExists(projectRoot)) return undefined;
  return readProjectConfig(projectRoot);
}

/**
 * Host: флаг → `closet-cli.json` проекта → промпт (при наличии TTY).
 */
async function resolveHost(flag: string | undefined, config = tryReadConfig()): Promise<string | undefined> {
  const host = flag ?? config?.registry.host;
  if (host !== undefined) {
    if (!isValidHost(host)) {
      printError(`Адрес реестра "${host}" не является корректным URL.`);
      return undefined;
    }
    return host;
  }

  if (!isInteractive()) {
    printError("Адрес реестра не указан: проект не инициализирован, а интерактивный промпт недоступен. Используйте --host <url>.");
    return undefined;
  }

  const answer = await p.text({
    message: "Адрес closet-registry (host)",
    placeholder: "https://registry.example.com",
    validate(value) {
      if (value.length === 0) return "Host обязателен.";
      if (!isValidHost(value)) return "Некорректный URL.";
    },
  });
  if (p.isCancel(answer)) {
    p.cancel("Вход отменён.");
    return undefined;
  }
  return answer;
}

/**
 * `login`: проверка формата, живой запрос `GET /v1/auth/me`, и только при
 * успехе — сохранение токена в персональный файл.
 */
export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Save a personal registry API token (clt_…) to the git-ignored closet-cli.local.json")
    .option("--host <url>", "Адрес closet-registry (по умолчанию из closet-cli.json)")
    .option("--token <token>", "Персональный токен реестра (clt_…)")
    .action(async (opts: LoginCommandOptions) => {
      let host: string | undefined;
      try {
        host = await resolveHost(opts.host);
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (host === undefined) return;

      let token = opts.token;
      if (token === undefined) {
        if (!isInteractive()) {
          printError("Токен не указан, а интерактивный промпт недоступен. Используйте --token <token>.");
          return;
        }
        const answer = await p.password({
          message: "Персональный токен реестра (clt_…)",
          validate(value) {
            if (value.length === 0) return "Токен обязателен.";
          },
        });
        if (p.isCancel(answer)) {
          p.cancel("Вход отменён.");
          return;
        }
        token = answer;
      }
      token = token.trim();

      if (token.startsWith("cls_")) {
        printError(
          "Это сессионный токен админки (cls_…), он не подходит для CLI. " +
            "Выпустите персональный токен: админка → «Аккаунт» → «Токен».",
        );
        return;
      }
      if (!token.startsWith("clt_")) {
        console.warn(pc.yellow("⚠ Токен не начинается с clt_ — убедитесь, что это персональный токен CLI."));
      }

      try {
        const user = await new HttpRegistryClient(host, token).getMe();
        saveToken(process.cwd(), host, token);
        console.log(pc.green(`Вошли в ${normalizeRegistryHost(host)} как ${user.username} (${user.role}).`));
        console.log(pc.dim("Токен сохранён в closet-cli.local.json (файл добавлен в .gitignore)."));
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
      }
    });
}

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Remove the saved registry token for the project's registry")
    .option("--host <url>", "Адрес closet-registry (по умолчанию из closet-cli.json)")
    .action(async (opts: HostOptions) => {
      try {
        const host = await resolveHost(opts.host);
        if (host === undefined) return;

        if (removeCredentials(process.cwd(), host)) {
          console.log(pc.green(`Токен для ${normalizeRegistryHost(host)} удалён.`));
        } else {
          console.log(pc.dim(`Сохранённого токена для ${normalizeRegistryHost(host)} нет.`));
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
      }
    });
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the registry user and role for the current token")
    .option("--host <url>", "Адрес closet-registry (по умолчанию из closet-cli.json)")
    .action(async (opts: HostOptions) => {
      try {
        const config = tryReadConfig();
        const host = await resolveHost(opts.host, config);
        if (host === undefined) return;

        const resolved = resolveToken(process.cwd(), host, config);
        if (!resolved) {
          printError(
            `Нет токена для ${normalizeRegistryHost(host)}. Выполните \`closet-cli login\` или задайте CLOSET_CLI_TOKEN.`,
          );
          return;
        }

        const user = await new HttpRegistryClient(host, resolved.token).getMe();
        console.log(`${pc.bold(user.username)} (${user.role}) @ ${normalizeRegistryHost(host)}`);
        console.log(pc.dim(`Источник токена: ${resolved.source}`));
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
      }
    });
}
