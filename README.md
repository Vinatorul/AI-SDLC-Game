# AI SDLC RPG

Интерактивная игра для доклада: зал за пять раундов встраивает AI в разные этапы SDLC и следит, выдерживает ли процесс последствия решений. В каждом раунде участники сначала выбирают этап, а затем конкретное действие внутри него.

- [Продуктовая рамка и правила](docs/product.md)
- [Архитектура MVP](docs/architecture.md)

Сейчас сценарий — технический черновик. Он нужен, чтобы проверить два голосования, повторное изменение одного этапа, расчёт и восстановление игры. Тексты раундов и баланс эффектов будут доработаны отдельно.

Контент и баланс вынесены в
[`packages/game-engine/content/scenarios/technical-mvp.json`](packages/game-engine/content/scenarios/technical-mvp.json).
Инструкция по полям и добавлению сценария лежит рядом в
[`packages/game-engine/content/README.md`](packages/game-engine/content/README.md).
Действия описываются один раз в общем каталоге, а раунды ссылаются на нужные этапы и действия. Поэтому новый раунд не требует копировать все возможные комбинации прошлых решений.

```bash
pnpm scenario:validate packages/game-engine/content/scenarios/technical-mvp.json
```

## Локальный запуск

Нужен Node.js 24. В среде Codex используйте bundled runtime:

```bash
export PATH="/Users/vinatorul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/vinatorul/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
pnpm install
pnpm dev
```

После запуска:

- фронтенд: `http://127.0.0.1:5173`;
- API: `http://127.0.0.1:8787`;
- healthcheck: `http://127.0.0.1:8787/health`.

Переменные окружения описаны в [apps/web/.env.example](apps/web/.env.example) и [apps/api/.env.example](apps/api/.env.example).

## Проверки

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Тесты движка и API используют только технический сценарий и временную SQLite.

## API в Docker

```bash
docker build -f apps/api/Dockerfile -t ai-sdlc-api .
docker run --rm -p 8787:8787 \
  -e CORS_ORIGINS=http://127.0.0.1:5173 \
  -v ai-sdlc-data:/data ai-sdlc-api
```

Контейнер запускает один процесс API. Файл базы лежит в `/data`, поэтому этому каталогу нужен постоянный диск.
Другой сценарий можно подключить без пересборки образа через `SCENARIO_PATH` и read-only volume;
точная команда приведена в инструкции по сценариям.

Резервную копию можно сделать из собранного образа командой:

```bash
node dist/backup.js /data/game.sqlite /backup/game.sqlite
```

## GitHub Pages

Workflow [.github/workflows/pages.yml](.github/workflows/pages.yml) собирает только статический фронтенд и публикует его после push в `main`. Его также можно запустить вручную.

Опубликованный фронтенд: [kuvaev.me/AI-SDLC-Game](https://kuvaev.me/AI-SDLC-Game/).

В настройках репозитория нужно задать переменную `VITE_API_BASE_URL` с HTTPS-адресом API. Без неё страница откроется, но создать игру или проголосовать через опубликованный фронтенд не получится. Для API нужно разрешить origin `https://kuvaev.me` в `CORS_ORIGINS`.
