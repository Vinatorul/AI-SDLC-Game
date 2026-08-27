# Одна виртуалка без домена и Docker Compose

Эта схема поднимает фронтенд и API на одной машине. Участники открывают
`http://<IP-АДРЕС>/`. Домен, HTTPS, Node.js и Nginx на самой виртуалке не нужны — достаточно
Docker.

Это вариант для временной демонстрации. HTTP не шифрует трафик, поэтому для постоянного публичного
сервиса нужен домен и HTTPS.

## Что будет запущено

- `ai-sdlc-web` раздаёт собранный фронтенд через Nginx и принимает внешний порт `80`;
- `ai-sdlc-api` работает только во внутренней Docker-сети;
- SQLite хранится в отдельном Docker volume `ai-sdlc-data` и переживает замену контейнеров.

## Первый запуск

Команды рассчитаны на запуск от `root` из корня клонированного репозитория. Подставьте публичный IP
виртуалки:

```bash
export AI_SDLC_PUBLIC_IP=203.0.113.10
export AI_SDLC_ORIGIN="http://${AI_SDLC_PUBLIC_IP}"
```

`203.0.113.10` — тестовый адрес из документации. Замените его на IP своей виртуалки.

Соберите образы:

```bash
docker build -f apps/api/Dockerfile -t ai-sdlc-api .
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_BASE_URL="$AI_SDLC_ORIGIN" \
  --build-arg VITE_BASE_PATH=/ \
  -t ai-sdlc-web .
```

Создайте внутреннюю сеть и постоянный том:

```bash
docker network create ai-sdlc
docker volume create ai-sdlc-data
```

Запустите API, а затем фронтенд:

```bash
docker run -d \
  --name ai-sdlc-api \
  --restart unless-stopped \
  --network ai-sdlc \
  -e CORS_ORIGINS="$AI_SDLC_ORIGIN" \
  -v ai-sdlc-data:/data \
  ai-sdlc-api

docker run -d \
  --name ai-sdlc-web \
  --restart unless-stopped \
  --network ai-sdlc \
  -p 80:80 \
  ai-sdlc-web
```

Откройте входящий TCP-порт `80` в firewall облака и самой виртуалки. Порт `8787` открывать не
нужно.

## Проверка

```bash
curl --fail http://127.0.0.1/health
docker ps --filter name=ai-sdlc
```

После этого приложение должно открываться по адресу `http://<IP-АДРЕС>/`. Проверка `/health`
проходит через тот же Nginx, что и запросы браузера.

Если приложение не открылось, посмотрите логи:

```bash
docker logs ai-sdlc-api
docker logs ai-sdlc-web
```

## Обновление

Получите новую версию кода и снова соберите оба образа. Затем замените контейнеры:

```bash
docker rm -f ai-sdlc-web ai-sdlc-api
```

Повторите две команды `docker run` из раздела первого запуска. Не удаляйте volume
`ai-sdlc-data`: в нём лежат комнаты и история игры.

## Что важно помнить

- Адрес API записывается во фронтенд при сборке. После смены IP пересоберите `ai-sdlc-web`.
- `CORS_ORIGINS` должен в точности совпадать с адресом в браузере, включая `http`, но без пути и
  завершающего `/`.
- Контейнер API должен называться `ai-sdlc-api`: это имя использует Nginx во внутренней сети.
- Запускайте только один экземпляр API с этим SQLite volume.
- GitHub Pages в этой схеме не участвует.
