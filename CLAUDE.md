# closet-cli — инструкции для Claude Code

Этот файл — точка входа для Claude Code при работе в этом репозитории.

## Обзор проекта

`closet-cli` — CLI-утилита на TypeScript, которая создаёт и поддерживает
файлы/папки для одного или нескольких ИИ-агентов (Claude Code, Codex, ...)
в проекте пользователя (`rules/`, `skills/`, `commands/`, `agents/`,
`hooks/`, `mcp/`, `scripts/`) из внешнего self-hosted реестра плагинов
(`closet-registry`), по аналогии с пакетным менеджером
(`init`/`add`/`list`/`remove`/`update`).

Полное описание команд, форматов и поведения — см. `plan.md` в корне
монорепо (актуальный план работ) и `README.md` (пользовательская
документация).

Два явных зафиксированных решения:
- `closet-cli.json` коммитится в репозиторий (без ведущей точки, не в `.gitignore`).
- `remove --all` не трогает `.claude/settings.json`, `CLAUDE.md` и `.claude/scripts/`
  — удаляются только файлы, которые сам `closet-cli` установил и отследил
  в `closet-cli.json`.

### Состояние (актуализировано 2026-09-13)

`init`/`install`/`update`/`remove`/`list` полностью переведены на новую
мультиагентную модель (`plan.md`, раздел 2, весь список "Осталось сделать"
кроме реального `docker compose up` и npm-публикации закрыт). `HttpRegistryClient`
переписан под реальный bundle-контракт `closet-registry` (`GET
/v1/plugins/:slug/:version`, `GET /v1/plugins`, `POST /v1/stats/installs`,
Bearer-токен на каждый запрос).

**`src/commands/list.ts` переписан и зарегистрирован в `src/cli.ts`**
(`plan.md`, раздел 3 п.10). Решение по архитектуре (был реальный пробел в
контракте сервера, не техническая задолженность — раньше в `closet-registry`
был только `GET /v1/plugins/:slug/:version`, без листинга всех плагинов):
на `closet-registry` добавлен `GET /v1/plugins` (метаданные всех неудалённых
плагинов — slug/description/latestVersion/updatedAt, без содержимого файлов;
детали — `closet-registry/CLAUDE.md`). `list` без `--all` работает только по
локальному состоянию `closet-cli.json` (без сети); `list --all` ходит в
новый эндпоинт и сравнивает `latestVersion` с локально установленной через
`semver.lt`. `RegistryClient.listPlugins()` (`src/registry/types.ts`) — новый
метод интерфейса, реализован в `HttpRegistryClient`. Проверено вручную
end-to-end на реальном `closet-registry` (не на HTTP-моке — Docker Postgres +
`pnpm dev`): пустой `list --all` → публикация плагина через admin-эндпоинт →
`list --all` (`[not installed]`) → `install` → `list` локально → `list --all`
(`[installed@1.0.0]`) → публикация версии 1.1.0 → `list --all` (подсказка
"доступно обновление до 1.1.0"). `pnpm typecheck`/`pnpm build` чисты.

Старый `FixtureRegistryClient` и `fixtures/` (имитация контракта `/v1/items`)
**удалены целиком**, не переписаны — контракт сервера сменился полностью,
старые фикстуры (модель `ItemType`, без `ai`/`mergeKeyPath`) ему не
соответствуют, и реализовывать фикстуры под bundle-модель не было смысла
без явного запроса. Для ручной проверки без поднятого `closet-registry`
поднимался временный HTTP-мок (см. ниже, "Ручная проверка") — он не входит
в репозиторий.

### Архитектура записи файлов: `PlannedFile` (dir | merge-json | merge-toml)

`src/core/path-mapper.ts`/`merge-slots.ts`/`json-merge.ts`/`toml-merge.ts`
(готовы с прошлой сессии, не менялись концептуально) теперь подключены к
командам через `src/core/installer.ts` и `src/core/conflict.ts`:

- **`core/conflict.ts`** — `PlannedFile` теперь union из `DirPlannedFile`
  (обычный файл) и `MergePlannedFile` (`kind: "merge-json" | "merge-toml"`,
  несёт `mergeKeyPath`/`mergeValue` вместо готового содержимого файла).
  "Конфликт" при `resolveConflicts` — ТОЛЬКО столкновение с чужим уже
  существующим содержимым: для `dir` — байты на диске отличаются; для merge
  — слот занят (`isJsonSlotOccupied`/`isTomlSlotOccupied`, новые обёртки над
  `merge-slots.ts`'s `isSlotOccupied`) значением, не равным нашему. Массивный
  слот никогда не "занят" в этом смысле (модель B+C — элементы массива
  законно принадлежат разным плагинам); идемпотентность своего элемента
  проверяется отдельно, на записи.
- **`core/installer.ts`** — `planBundleFiles(projectRoot, ai, bundle)`
  строит план ОДНОГО bundle'а: файл с `ai: null` в bundle-ответе
  устанавливается ПОД КАЖДЫЙ включённый ИИ отдельно (у Claude Code/Codex
  непересекающиеся деревья каталогов — общий файл физически дублируется, а
  не имеет одно общее место). Компонент без маппинга
  (`unsupported`/`not-implemented`, `path-mapper.ts`) — не ошибка, попадает
  в `notices` и печатается как строка в выводе команды.
  `writePlannedFile` пишет один файл; `installBundles` — весь набор bundle'ов
  через один проход `resolveConflicts`. `sha256` для обычных файлов
  вычисляется **локально** (`node:crypto`) над уже материализованным
  содержимым (после template-подстановки `{{projectRoot}}`), а не берётся
  из `sha256` в bundle-ответе — серверный хеш посчитан над ДО-подстановочным
  содержимым и не совпал бы с тем, что реально лежит на диске.
- **Решение по merge-содержимому**: содержимое merge-файла в bundle-ответе
  сервера — ВСЕГДА JSON, независимо от целевого формата (`merge-json` или
  `merge-toml`). Причина: TOML не умеет представлять "голое" значение
  верхнего уровня (только key=value/таблицы), а `mergeValue` может быть
  произвольным (объект/массив/скаляр) — JSON годится для обоих направлений,
  формат СЕРИАЛИЗАЦИИ определяется только файлом назначения.
- **Path traversal**: `relativePath` файла приходит из bundle-ответа registry
  (внешние данные) — `resolveSafeJoin` в `installer.ts` проверяет, что
  итоговый путь не вышел за пределы целевой директории компонента (аналог
  `resolveSafePath` на сервере, но на стороне клиента — серверная проверка
  защищает только диск сервера, не проект пользователя).
- **Prototype pollution**: `mergeKeyPath` тоже приходит из bundle-ответа —
  `merge-slots.ts`'s `parseSlotPath` отклоняет сегменты `__proto__`/
  `constructor`/`prototype` явной ошибкой.

### `update`: блокировка по изменённым файлам, а не по путям (важный нюанс)

Наивная реализация `update` (полностью переиспользовать `installBundles` со
всеми bundle'ами закрытия зависимостей через обычный `resolveConflicts`)
**не работает** — воспроизводимо проверено вручную: ЛЮБОЙ файл плагина,
содержимое которого просто отличается между версиями (нормальный случай,
не правка пользователя), ошибочно требовал бы `--force`/интерактивного
подтверждения, потому что `resolveConflicts` сравнивает с текущим
содержимым на диске (старая версия), а не с тем, что было записано при
установке.

Исправлено через `trackedFileIdentityKey`/`plannedFileIdentityKey`
(`installer.ts`) и параметр `preApprovedKeys` у `installBundles`: `update.ts`
для каждого НЕ заблокированного (см. ниже) bundle'а собирает набор ключей
`destPath` (+`mergeKeyPath` для merge — один `destPath`, например
`.codex/config.toml`, может нести несколько слотов от разных плагинов)
из СТАРОГО списка `previous.files`. Файлы с таким ключом пишутся напрямую,
минуя `resolveConflicts` — они уже наши и уже прошли проверку
"не изменены пользователем" (`isPreviouslyTrackedFileUnchanged`). Через
`resolveConflicts` идут только ДЕЙСТВИТЕЛЬНО новые файлы (компонент,
добавленный в новой версии, которого не было в старом списке) — они и
могут столкнуться с посторонним содержимым.

Блокировка целого плагина (`plan.md`, 2.6: "версия НЕ поднимается") —
all-or-nothing для ВСЕГО плагина, не по отдельным файлам: если хотя бы один
отслеживаемый файл изменён вручную, весь bundle исключается из
`bundlesToInstall` до вызова `installBundles`, warning печатается отдельно.
Причина — одна версия на плагин в `closet-cli.json`, частично обновлённое
состояние (часть файлов v2, часть v1) не может быть представлено корректно.

Компоненты, убранные в новой версии (были в `previous.files`, отсутствуют
среди реально записанных файлов новой версии) — удаляются той же
`core/removal.ts#removeTrackedFile`, что использует `remove.ts`
(reference counting по `collectUsedDestPaths`, исключая сам обновляемый slug).

### Известный краш Node/libuv на Windows: `process.exit()` после `fetch()`

Обнаружено и подтверждено вручную при первом e2e-прогоне на этой машине
(Windows 11, Node 24.18.0): вызов `process.exit(N)` в процессе, где ранее
было сделано ДВА И БОЛЕЕ `fetch()` (даже успешных, к разным URL) —
воспроизводимо падает с `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), file src\win\async.c, line 94` (краш самого Node,
exit code 127), а не нормальным завершением с заданным кодом. Один `fetch`
не всегда триггерит, два — стабильно триггерит. Похоже на баг
undici/libuv на Windows (соединения из connection pool не успевают
корректно закрыться до принудительного завершения процесса), не баг
в логике closet-cli.

Исправлено единообразно в `src/commands/install.ts`, `src/commands/update.ts`
и в top-level `.catch()` в `src/cli.ts`: везде, где до этой точки мог быть
сделан `fetch` (то есть после создания `HttpRegistryClient` и хотя бы одного
обращения к нему), `process.exit(N)` заменён на `process.exitCode = N` +
`return` — процесс завершается естественно, когда event loop опустеет, что
не триггерит краш (проверено вручную несколькими прогонами). Ранние проверки
до первого сетевого обращения (`--force`+`--skip`, "проект не
инициализирован" и т. п.) технически не под риском, но переведены на тот же
паттерн для единообразия внутри файла. `src/commands/remove.ts` НЕ
затронут — он никогда не создаёт `RegistryClient`/не делает `fetch`, риска
нет. `src/commands/list.ts` (переписан 2026-09-13, делает `fetch` в ветке
`--all` через `registry.listPlugins()`) написан сразу с `process.exitCode = N;
return;` — на том же основании, что и `install.ts`/`update.ts`. Если будешь
добавлять новые команды, использующие `HttpRegistryClient`, — используй
`process.exitCode = N; return;`, а не `process.exit(N)`, после первого
сетевого вызова.

### Ручная проверка (что реально прогонялось)

Тестового набора по-прежнему нет (осознанное решение, см. ниже). Полный
цикл проверен вручную через временный zero-dependency HTTP-мок (Node
`node:http`, не в репозитории), реализующий `GET /v1/plugins/:slug/:version`
(с ручным переключением "latest" через свой control-эндпоинт) и `POST
/v1/stats/installs`, плюс собранный `dist/cli.js` в scratch-директории:
`init --yes` (оба ИИ) → `install demo` (зависимость `demo-dep`, `skills`
дублирован под оба ИИ, `mcp` смерджен и в `.mcp.json`, и в
`.codex/config.toml`, `hooks` (массивный слот) смерджен в
`.claude/settings.json`, `commands` для codex — notice "нет аналога") →
повторный `install demo` (ошибка "уже установлен") → `update demo` на новую
версию БЕЗ правок пользователя (прошло чисто, без единого запроса
`--force`/конфликта — это и есть регресс-тест на баг с `preApprovedKeys`
выше) → ручная правка отслеживаемого файла + `update demo` (корректно
заблокирован с warning, версия не поднята) → `update demo --force`
(перезаписал, версия поднялась, убранные в новой версии компоненты
`mcp`/`commands`/`rules` корректно вычищены с диска) → `remove --all`
(файлы удалены, merge-слоты вычищены точечно, `.mcp.json` остался с пустым
`mcpServers: {}`, а не удалён целиком). Отдельно проверены два падения:
конфликт с посторонним файлом без TTY/`--force` (корректная ошибка, без
краша) и `install` несуществующего плагина (корректная ошибка
`DependencyResolutionError`, без краша) — оба раньше падали в баг из
раздела выше, пока он не был исправлен.

Отдельно (2026-09-13) на реальном `closet-registry` (Docker Postgres +
`pnpm dev`, не HTTP-мок) проверен новый `GET /v1/plugins` и `list`/`list --all`
поверх него — см. секцию "Состояние" выше и `closet-registry/CLAUDE.md`.

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

- `src/cli.ts` — точка входа: собирает `Command`, резолвит `templatesDir`
  относительно расположения самого `dist/cli.js` (через `import.meta.url`),
  а не `process.cwd()` (это директория проекта пользователя). Регистрирует
  `init`/`install`/`update`/`remove`/`list`.
- `src/registry/` — абстракция реестра под bundle-модель: интерфейс
  `RegistryClient` (`types.ts`, `getPluginBundle`/`recordInstall`/`listPlugins`) +
  `HttpRegistryClient` (`http-client.ts`) под реальный контракт
  `closet-registry` (Bearer-токен на каждый запрос). `listPlugins` — тонкая
  обёртка над `GET /v1/plugins`, используется только `commands/list.ts`
  (`--all`).
- `src/config/` — работа с `closet-cli.json` (`project-config.ts`,
  zod-схемы под модель `registry`/`ai`/`plugins`) и вычисление вспомогательных
  путей `init`'а (`paths.ts` — `claudeDir`/`itemTypeDir`/`scriptsDir`, только
  для скаффолдинга пустых каталогов при `init`; путь установки КОНКРЕТНОГО
  файла плагина резолвится не отсюда, а через `core/path-mapper.ts`).
- `src/core/` — общая логика, не завязанная на конкретную команду:
  - `dependency-resolver.ts` — `resolvePluginClosure`, DFS-резолвинг
    зависимостей плагинов (по slug, всегда на "latest") с детектом циклов
    и топологической сортировкой.
  - `path-mapper.ts` — `resolveComponentTarget(component, ai, merge)`,
    хардкод-таблица component×ai×merge → место на диске.
  - `merge-slots.ts` — формато-независимый движок именованных слотов
    (модель B+C), плюс проверка occupied/unchanged и защита от
    prototype pollution в `mergeKeyPath`.
  - `json-merge.ts`/`toml-merge.ts` — тонкие обёртки `merge-slots.ts` под
    JSON (`.mcp.json`, `.claude/settings.json`) и TOML (`.codex/config.toml`).
  - `conflict.ts` — `PlannedFile` (dir | merge-json | merge-toml) +
    `resolveConflicts` (`interactive`/`force`/`skip`) — конфликт только со
    ЧУЖИМ содержимым, см. также ответ про `@clack/prompts` ниже.
  - `installer.ts` — `planBundleFiles`/`writePlannedFile`/`installBundles`
    (планирование и запись файлов одного или нескольких bundle'ов),
    `isPreviouslyTrackedFileUnchanged`/`trackedFileIdentityKey` (используются
    `update.ts` для защиты пользовательских правок).
  - `removal.ts` — `removeTrackedFile`/`collectUsedDestPaths`, общая логика
    удаления файла плагина (reference counting, merge-слоты), используется
    и `remove.ts`, и `update.ts` (для компонентов, убранных в новой версии).
- `src/commands/` — по одному модулю на команду. Конвенция: каждый модуль
  экспортирует `register<Name>Command(program: Command, ...внешние зависимости)`,
  который сам себя регистрирует через `program.command(...)`.
- `src/templates/` — стартовые файлы, которые `init` копирует в проект
  пользователя (`settings.json`, `settings.local.json`,
  `mcp.json` — только для Claude Code; `AGENTS.md` — общий поведенческий
  контент для всех ИИ; `CLAUDE.md` — короткий файл-мост со ссылкой на
  `AGENTS.md`, а не его копия; для Codex файла-моста нет — он и так нативно
  читает `AGENTS.md`). Имя файла шаблона всегда совпадает с именем файла
  назначения. Не бандлятся `tsup`, поэтому явно перечислены в
  `package.json.files`.

### Важное соглашение: изоляция модулей

Некоторые константы (например, список типов items/компонентов) намеренно
продублированы в нескольких местах (`src/registry/types.ts`,
`src/config/project-config.ts`, `src/commands/init.ts`, `src/core/path-mapper.ts`
— там это только union-типы `PluginComponent`/`AiName`, без runtime-массива)
вместо переиспользования через импорт. Это сделано специально, чтобы модули
оставались самодостаточными — не меняй это на единый общий импорт без
явного запроса, это осознанный архитектурный выбор, а не недосмотр.

### Зачем `@clack/prompts`

Используется только в `src/core/conflict.ts` для интерактивного подтверждения
перезаписи конфликтующих файлов (`p.confirm`) в TTY-режиме. В не-TTY
окружении вместо промпта бросается ошибка с указанием использовать
`--force`/`--skip`.

### `noUncheckedIndexedAccess`

В `tsconfig.json` включён `noUncheckedIndexedAccess: true` — прямая
индексация вида `config.plugins[slug]` типизируется как
`InstalledPlugin | undefined`. В коде это обходится либо через
`Object.entries(...)` вместо повторной индексации, либо через non-null
assertion с комментарием, когда наличие значения уже проверено на
предыдущих строках (`remove.ts`, `update.ts`).
