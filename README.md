# punk-ai

CLI для развёртывания и поддержки окружения `.claude/` в проекте из внешнего
реестра переиспользуемых items — правил, скиллов, слэш-команд, агентов
и хуков для Claude Code. По духу — как пакетный менеджер, только вместо
пакетов npm ставятся `rules/`, `skills/`, `commands/`, `agents/`, `hooks/`.

## Установка

```bash
pnpm add -g punk-ai
```

Требуется Node.js ≥ 22.

## Быстрый старт

```bash
# 1. Инициализировать .claude/ окружение в текущем проекте
punk-ai init

# 2. Посмотреть, что доступно в реестре
punk-ai list --all

# 3. Установить item (с автоматическим подтягиванием зависимостей)
punk-ai add context7

# 4. Посмотреть, что установлено
punk-ai list

# 5. Обновить до последней версии
punk-ai update context7

# 6. Удалить
punk-ai remove context7
```

## Команды

### `punk-ai init`

Создаёт в текущей директории:

- `.claude/{rules,skills,commands,agents,hooks}/` — пустые каталоги под установку items;
- `.claude/settings.json`, `.claude/settings.local.json`;
- `CLAUDE.md` — стартовый шаблон с разделами «Обзор проекта», «Команды разработки», «Архитектура»;
- `.claude/scripts/README.md`;
- `.mcp.json` — пустой шаблон (`{ "mcpServers": {} }`) под будущие MCP-серверы;
- `.punk-ai.json` — файл состояния проекта (список установленного, URL реестра);
- добавляет `.claude/settings.local.json` в `.gitignore`.

Флаги:

- `--force` — переинициализировать поверх существующего `.claude/`/`.punk-ai.json`.
- `--registry-url <url>` — URL реестра, который сохраняется в `.punk-ai.json` (по умолчанию `https://registry.punkmachine.dev`).

Без `--force` команда откажется работать, если `.claude/` или `.punk-ai.json` уже существуют.

### `punk-ai add <name>`

Устанавливает item и все его транзитивные зависимости. Зависимости
резолвятся заранее (с детектом циклов), после чего все файлы всех items
записываются на диск за один проход.

Если какой-то из файлов уже существует на диске и отличается по содержимому:

- в интерактивном терминале — по каждому конфликту будет задан вопрос
  «Перезаписать?»;
- `--force` — перезаписать все конфликтующие файлы без вопросов;
- `--skip` — пропустить все конфликтующие файлы без вопросов;
- в неинтерактивном окружении (CI, пайпы) без `--force`/`--skip` команда
  завершится ошибкой со списком конфликтующих файлов.

`--force` и `--skip` взаимоисключающие.

### `punk-ai list`

Без флагов — список установленных в проекте items.

`--all` — список всех items, доступных в реестре, с пометкой:

- `[installed@X.Y.Z]` (+ `(доступно обновление до …)`, если в реестре есть более новая версия);
- `[not installed]`.

### `punk-ai update [name]`

Обновляет один item (`update <name>`) либо все установленные (`update --all`)
до последней версии из реестра. Items, у которых уже установлена последняя
версия, пропускаются с сообщением «уже последняя версия». Конфликты файлов
разрешаются так же, как в `add` (`--force`/`--skip`/интерактивно).

### `punk-ai remove [name]`

Удаляет один установленный item (`remove <name>`) либо все (`remove --all`).
Удаление файлов учитывает reference counting: если один и тот же файл на
диске используется ещё каким-то оставшимся установленным item'ом, он не
удаляется. Пустые директории после удаления файла подчищаются (best-effort).

`remove --all` не трогает `.claude/settings.json`, `CLAUDE.md` и `.claude/scripts/` —
удаляются только файлы, которые сам `punk-ai` установил и отследил
в `.punk-ai.json`.

## `.punk-ai.json`

Файл состояния проекта, коммитится в репозиторий (не в `.gitignore`):

```json
{
  "registryUrl": "https://registry.punkmachine.dev",
  "installed": {
    "context7-rules": {
      "type": "rules",
      "version": "1.0.0",
      "files": [{ "path": "context7.md" }]
    },
    "context7": {
      "type": "mcp",
      "version": "1.0.0",
      "files": [
        { "path": ".mcp.json", "rootPath": true, "merge": true },
        { "path": ".claude/settings.local.json", "rootPath": true, "merge": true }
      ]
    }
  },
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

Каждый элемент `files` — не просто путь, а объект `{ path, rootPath?, merge? }`:

- `rootPath: true` — файл ставится относительно корня проекта, а не `.claude/<type>/`
  (например, `.mcp.json`, `.claude/scripts/context-monitor.py`).
- `merge: true` — файл не перезаписывается целиком, а рекурсивно мёржится в уже
  существующий JSON-файл на диске (вложенные объекты объединяются по ключам, а
  не заменяют друг друга целиком — это важно для файлов вроде `.mcp.json`,
  где несколько разных item'ов добавляют свой сервер под разными ключами
  внутри одного `mcpServers`); `remove` никогда не удаляет такие файлы
  целиком, только перестаёт их отслеживать.

## Разработка

Пакетный менеджер — **pnpm**.

```bash
pnpm install       # зависимости
pnpm build          # сборка -> dist/cli.js (tsup, ESM, Node 22)
pnpm dev             # сборка в watch-режиме
pnpm typecheck     # tsc --noEmit, без эмита
```

Локальный прогон собранного CLI из отдельной тестовой директории:

```bash
mkdir /tmp/punk-ai-test && cd /tmp/punk-ai-test
node /путь/до/punk-ai-cli/dist/cli.js init
```

### Реестр

Сейчас единственный источник items — локальные фикстуры в `fixtures/`
(`FixtureRegistryClient`), имитирующие будущий HTTP-реестр. Структура:

```
fixtures/
  index.json                         # метаданные всех items и версий
  items/<type>/<name>/<version>/...  # содержимое файлов
```

Текущий набор фикстур в `fixtures/`:
- `mcp/context7` — регистрирует Context7 MCP-сервер в `.mcp.json` (корень проекта,
  ключ API берётся из `${env:CONTEXT7_API_KEY}`), дозаписывает плейсхолдер
  `CONTEXT7_API_KEY` в `.claude/settings.local.json` (`rootPath` + `merge`) и зависит
  от `rules/context7-rules` и `skills/context7-mcp` — для проверки резолвинга
  зависимостей и `rootPath`-файлов;
- `rules/context7-rules`, `skills/context7-mcp` — правило и скилл для работы с Context7;
- `statusline/statusline` — ставит `.claude/scripts/context-monitor.py` (`rootPath: true`) и
  мёржит ключ `statusLine` в `.claude/settings.json` (`rootPath` + `merge` + `template`,
  плейсхолдер `{{projectRoot}}` подставляется абсолютным путём проекта при установке).

### Тесты

Автоматических тестов пока нет — решение отложено до стабилизации API
реестра. Проверка изменений — сборка + ручной e2e-прогон всех команд
в изолированной scratch-директории.

## Лицензия

Не определена.
