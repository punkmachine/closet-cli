# closet-cli — инструкции для Claude Code

## Обзор проекта

`closet-cli` — CLI-утилита на TypeScript, которая создаёт и поддерживает файлы/папки для одного или нескольких ИИ-агентов (Claude Code, Codex, ...) в проекте пользователя (`rules/`, `skills/`, `commands/`, `agents/`, `hooks/`, `mcp/`, `scripts/`) из внешнего self-hosted реестра плагинов (`closet-registry`), по аналогии с пакетным менеджером (`init`/`add`/`list`/`remove`/`update`).

## Токен и персональные данные

- Токен реестра **никогда не пишется в `closet-cli.json`** (файл коммитится). Он хранится в `closet-cli.local.json` в корне проекта (файл автоматически добавляется в `.gitignore`) либо берётся из `CLOSET_CLI_TOKEN`.
- `src/config/credentials.ts` — модуль работы с `closet-cli.local.json` (путь, чтение/запись, добавление в `.gitignore` через `config/gitignore.ts`, `resolveToken` с приоритетом env → credentials → legacy `registry.token`). Команды получают клиент через `commands/registry-access.ts`.
- `registry/http-client.ts` бросает `RegistryAuthError` для `401`/`403` (с `code` и `Retry-After`); CLI использует только персональные токены `clt_…`, не сессионные `cls_…`.
- Типы в `registry/types.ts` продублированы с `@closet/contract` намеренно (CLI от пакета не зависит) — при изменении контракта сверять вручную.


## Раскладка файлов: хранилище `.agents/` + копии

- `.agents/` — единственное место, куда пишутся файлы плагинов (источник правды); в папки ИИ они **копируются**. Ссылки (symlink/junction/hardlink) не используются. Копии — производные: правки вносятся в `.agents/`, а не в `.claude/`/`.codex/`.
- `src/harnesses/` — дескрипторы ИИ (`claude-code.ts`, `codex.ts`, список — `registry.ts`, типы — `types.ts`). Дескриптор описывает, куда ИИ получает каждый компонент (`copy`/`native`/`store-only`/`merge-*`/`unsupported`/`not-implemented`), какой у него файл инструкций и какие каталоги создавать в `init`. Новый ИИ = новый файл дескриптора + строка в `registry.ts`, без правок ядра. `AI_NAMES`/`AiName` производны от `HARNESSES`.
- `src/core/layout.ts` — пути хранилища (`ai: null` → `.agents/<component>/<path>`, `ai: X` → `.agents/<component>/.<X>/<path>`). `src/core/projector.ts` / `src/core/sync.ts` — копирование хранилище → папки ИИ, проверка расхождений, удаление копий. `core/path-mapper.ts` — `resolvePlacement` поверх дескрипторов.
- В `closet-cli.json` у каждого файла плагина хранится sha256 записи в хранилище и `copies[]` (путь + sha256 каждой копии): по ним отличаются «копию правили руками» (конфликт, `core/conflict.ts`) и «обновилось хранилище» (копия просто перезаписывается).
- `closet-cli sync` — односторонняя повторная проекция `.agents/` → папки ИИ.
- Codex: skills читает прямо из `.agents/skills`, копия не нужна; раскладка Codex опирается только на документацию и на практике не проверялась.
- Файл с неизвестным `ai` в bundle не роняет установку (пропускается с предупреждением «обновите closet-cli»; `registry/http-client.ts`, `unsupportedFiles`).
- Legacy-раскладка (`--layout legacy`, нет поля `layout` в `closet-cli.json`) пока сохранена для старых проектов; план — удалить отдельным шагом, `closet-cli migrate` делать не будем.
- Файлы формата spec («универсальный элемент» из админки) CLI не видит: реестр разворачивает их в обычные файлы под каждый ИИ при выдаче bundle.
