# closet-cli — инструкции для Claude Code

## Обзор проекта

`closet-cli` — CLI-утилита на TypeScript, которая создаёт и поддерживает файлы/папки для одного или нескольких ИИ-агентов (Claude Code, Codex, ...) в проекте пользователя (`rules/`, `skills/`, `commands/`, `agents/`, `hooks/`, `mcp/`, `scripts/`) из внешнего self-hosted реестра плагинов (`closet-registry`), по аналогии с пакетным менеджером (`init`/`add`/`list`/`remove`/`update`).

## Токен и персональные данные

- Токен реестра **никогда не пишется в `closet-cli.json`** (файл коммитится). Он хранится в `closet-cli.local.json` в корне проекта (файл автоматически добавляется в `.gitignore`) либо берётся из `CLOSET_CLI_TOKEN`.
- `src/config/credentials.ts` — модуль работы с `closet-cli.local.json` (путь, чтение/запись, добавление в `.gitignore` через `config/gitignore.ts`, `resolveToken` с приоритетом env → credentials → legacy `registry.token`). Команды получают клиент через `commands/registry-access.ts`.
- `registry/http-client.ts` бросает `RegistryAuthError` для `401`/`403` (с `code` и `Retry-After`); CLI использует только персональные токены `clt_…`, не сессионные `cls_…`.
- Типы в `registry/types.ts` продублированы с `@closet/contract` намеренно (CLI от пакета не зависит) — при изменении контракта сверять вручную.


## Раскладка файлов: каждый ИИ там, где сам читает

- Дублей нет: файл пишется один раз туда, где его читает ИИ. Claude Code не читает `.agents/` — его skills/rules/commands/agents пишутся сразу в `.claude/*` (`direct`), правки вносятся там. Codex читает `.agents/` сам — его skills/agents лежат прямо в `.agents/skills`, `.agents/agents` (`native`). Ссылки (symlink/junction/hardlink) не используются.
- `src/harnesses/` — дескрипторы ИИ (`claude-code.ts`, `codex.ts`, список — `registry.ts`, типы — `types.ts`). Дескриптор — «матчер» компонент → место: `direct` (писать сразу в папку ИИ, минуя `.agents/`), `native` (ИИ читает `.agents/<component>`), `copy` (запись в `.agents/` + копия в папку ИИ; сейчас ни один ИИ не использует, но движок `projector`/`sync` сохранён для будущих), `store-only`/`merge-*`/`unsupported`/`not-implemented`; плюс файл инструкций и каталоги для `init`. Новый ИИ = новый файл дескриптора + строка в `registry.ts`, без правок ядра. `AI_NAMES`/`AiName` производны от `HARNESSES`.
- `src/core/layout.ts` — пути хранилища `.agents/`: `ai: null` → `.agents/<component>/<path>`; `ai: X` → `.agents/<component>/.<X>/<path>`, но если для X компонент `native`, то без подпапки (иначе ИИ его не увидит). `core/installer.ts` (`planAgentsBundleFiles`) строит план по дескрипторам; `core/path-mapper.ts` — `resolvePlacement`.
- `src/core/projector.ts` / `src/core/sync.ts` — копирование хранилище → папки ИИ (только для `copy`-размещений), проверка расхождений, удаление копий.
- В `closet-cli.json` у каждого файла плагина хранится путь и sha256; для `copy`-размещений ещё `copies[]` (путь + sha256 каждой копии): по ним отличаются «копию правили руками» (конфликт, `core/conflict.ts`) и «обновилось хранилище». У `direct`/`native` файлов копий нет — ручная правка определяется по sha256 самого файла.
- `closet-cli sync` — односторонняя повторная проекция `.agents/` → папки ИИ для `copy`-размещений; сейчас фактически no-op.
- Codex: раскладка опирается только на документацию и на практике не проверялась (чтение `.agents/agents` — допущение).
- Файл с неизвестным `ai` в bundle не роняет установку (пропускается с предупреждением «обновите closet-cli»; `registry/http-client.ts`, `unsupportedFiles`).
- Legacy-раскладка (`--layout legacy`, нет поля `layout` в `closet-cli.json`) пока сохранена для старых проектов; план — удалить отдельным шагом, `closet-cli migrate` делать не будем.
- Файлы формата spec («универсальный элемент» из админки) CLI не видит: реестр разворачивает их в обычные файлы под каждый ИИ при выдаче bundle.
