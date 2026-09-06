# punk-ai CLI — инструкции для Claude Code

Этот файл — точка входа для Claude Code при работе в этом репозитории.

## Обзор проекта

`punk-ai` — CLI-утилита на TypeScript, которая разворачивает и поддерживает
окружение `.claude/` в проекте пользователя (`rules/`, `skills/`, `commands/`,
`agents/`, `hooks/`) из внешнего реестра переиспользуемых items, по аналогии
с пакетным менеджером (`init`/`add`/`list`/`remove`/`update`).

Полное описание команд, форматов и поведения — см. `implement_plan.md`
(исходный план реализации) и `README.md` (пользовательская документация).

Два явных зафиксированных решения:
- `.punk-ai.json` коммитится в репозиторий (не в `.gitignore`).
- `remove --all` не трогает `.claude/settings.json`, `CLAUDE.md` и `.claude/scripts/`
  — удаляются только файлы, которые сам `punk-ai` установил и отследил
  в `.punk-ai.json`.

## Команды разработки

Пакетный менеджер — **pnpm**, не npm/yarn.

```bash
pnpm install          # установка зависимостей
pnpm build             # сборка через tsup -> dist/cli.js
pnpm dev                # tsup --watch
pnpm typecheck        # tsc --noEmit
```

Тестового набора пока нет — это осознанное решение по плану, тестирование
отложено до стабилизации API реестра. Проверка изменений — сборка +
ручной прогон собранного `dist/cli.js` в отдельной scratch-директории
(см. раздел ниже).

## Архитектура

- `src/cli.ts` — точка входа: собирает `Command`, резолвит `fixturesDir`/
  `templatesDir` относительно расположения самого `dist/cli.js`
  (через `import.meta.url`), а не `process.cwd()` (это директория проекта
  пользователя).
- `src/registry/` — абстракция реестра: интерфейс `RegistryClient`
  (`types.ts`) + единственная текущая реализация `FixtureRegistryClient`
  (`fixture-client.ts`), читающая `fixtures/`. Будущий `HttpRegistryClient`
  подключается без изменений в командах.
- `src/config/` — работа с `.punk-ai.json` (`project-config.ts`,
  zod-схемы) и вычисление путей внутри `.claude/` (`paths.ts`).
- `src/core/` — общая логика, не завязанная на конкретную команду:
  - `dependency-resolver.ts` — DFS-резолвинг зависимостей items
    с детектом циклов и топологической сортировкой.
  - `conflict.ts` — разрешение конфликтов при записи файлов
    (`interactive`/`force`/`skip`), см. также ответ про `@clack/prompts` ниже.
  - `installer.ts` — единая точка записи файлов item'ов на диск,
    используется и `add`, и `update`.
- `src/commands/` — по одному модулю на команду. Конвенция: каждый модуль
  экспортирует `register<Name>Command(program: Command, ...внешние зависимости)`,
  который сам себя регистрирует через `program.command(...)`.
- `src/templates/` — стартовые файлы, которые `init` копирует в проект
  пользователя (`CLAUDE.md`, `settings.json`, `settings.local.json`,
  `scripts-readme.md`, `mcp.json`). Не бандлятся `tsup`, поэтому явно
  перечислены в `package.json.files`.
- `fixtures/` — локальная JSON-имитация реестра для `FixtureRegistryClient`,
  структура совпадает с будущим HTTP API: `fixtures/index.json` +
  `fixtures/items/<type>/<name>/<version>/<файлы>`.

### Важное соглашение: изоляция модулей

Некоторые константы (например, список типов items) намеренно продублированы
в нескольких местах (`src/registry/types.ts`, `src/config/project-config.ts`,
`src/commands/init.ts`) вместо переиспользования через импорт. Это сделано
специально, чтобы модули оставались самодостаточными — не меняй это на
единый общий импорт без явного запроса, это осознанный архитектурный выбор,
а не недосмотр.

### Зачем `@clack/prompts`

Используется только в `src/core/conflict.ts` для интерактивного подтверждения
перезаписи конфликтующих файлов (`p.confirm`) в TTY-режиме. В не-TTY
окружении вместо промпта бросается ошибка с указанием использовать
`--force`/`--skip`.

### `noUncheckedIndexedAccess`

В `tsconfig.json` включён `noUncheckedIndexedAccess: true` — прямая
индексация вида `config.installed[name]` типизируется как
`InstalledItem | undefined`. В коде это обходится либо через
`Object.entries(...)` вместо повторной индексации (`remove.ts`), либо через
non-null assertion с комментарием, когда наличие значения уже проверено
на предыдущих строках (`update.ts`).
