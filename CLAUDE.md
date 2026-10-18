# closet-cli — инструкции для Claude Code

## Обзор проекта

`closet-cli` — CLI-утилита на TypeScript, которая создаёт и поддерживает файлы/папки для одного или нескольких ИИ-агентов (Claude Code, Codex, ...) в проекте пользователя (`rules/`, `skills/`, `commands/`, `agents/`, `hooks/`, `mcp/`, `scripts/`) из внешнего self-hosted реестра плагинов (`closet-registry`), по аналогии с пакетным менеджером (`init`/`add`/`list`/`remove`/`update`).

## Токен и персональные данные

- Токен реестра **никогда не пишется в `closet-cli.json`** (файл коммитится). Он хранится в `closet-cli.local.json` в корне проекта (файл автоматически добавляется в `.gitignore`) либо берётся из `CLOSET_CLI_TOKEN`.
- `src/config/credentials.ts` — модуль работы с `closet-cli.local.json` (путь, чтение/запись, добавление в `.gitignore` через `config/gitignore.ts`, `resolveToken` с приоритетом env → credentials → legacy `registry.token`). Команды получают клиент через `commands/registry-access.ts`.
- `registry/http-client.ts` бросает `RegistryAuthError` для `401`/`403` (с `code` и `Retry-After`); CLI использует только персональные токены `clt_…`, не сессионные `cls_…`.
- Типы в `registry/types.ts` продублированы с `@closet/contract` намеренно (CLI от пакета не зависит) — при изменении контракта сверять вручную.

