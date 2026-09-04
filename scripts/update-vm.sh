#!/usr/bin/env bash

set -Eeuo pipefail

readonly NETWORK_NAME="ai-sdlc"
readonly DATA_VOLUME="ai-sdlc-data"
readonly API_CONTAINER="ai-sdlc-api"
readonly WEB_CONTAINER="ai-sdlc-web"
readonly PROXY_CONTAINER="ai-sdlc-proxy"
readonly BACKUP_DIR="/var/backups/ai-sdlc-game"
readonly CADDY_CONFIG_DIR="/etc/ai-sdlc-game"
readonly CADDY_FILE="${CADDY_CONFIG_DIR}/Caddyfile"
readonly CADDY_IMAGE="caddy:2-alpine"
readonly CADDY_DATA_VOLUME="ai-sdlc-caddy-data"
readonly CADDY_CONFIG_VOLUME="ai-sdlc-caddy-config"

DEPLOY_MODE=""
PUBLIC_ORIGIN=""
DOMAIN=""

die() {
  printf 'Ошибка: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Не найдена команда: $1"
}

ensure_docker_connection() {
  local output server_api
  unset DOCKER_API_VERSION
  output="$(docker version 2>&1)" && return 0
  server_api="$(sed -nE 's/.*Maximum supported API version is ([0-9.]+).*/\1/p' <<<"$output" | tail -n 1)"
  [[ -n "$server_api" ]] || die "Не удалось подключиться к Docker daemon"
  export DOCKER_API_VERSION="$server_api"
  docker version >/dev/null 2>&1 || die "Не удалось подключиться к Docker daemon"
}

is_ipv4() {
  local ip="$1" octet
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  local parts=()
  IFS=. read -r -a parts <<<"$ip"
  for octet in "${parts[@]}"; do
    ((10#$octet <= 255)) || return 1
  done
}

configure_target() {
  local target
  target="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  if is_ipv4 "$target"; then
    DEPLOY_MODE="http"
    PUBLIC_ORIGIN="http://${target}"
    return
  fi
  [[ ! "$target" =~ ^[0-9.]+$ ]] || die "Некорректный IPv4-адрес: $target"
  [[ ${#target} -le 253 ]] || die "Слишком длинное имя домена"
  [[ "$target" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] ||
    die "Укажите домен без http://, https:// и пути"
  DEPLOY_MODE="https"
  DOMAIN="$target"
  PUBLIC_ORIGIN="https://${target}"
}

build_images() {
  printf '\n==> Собираю API\n'
  docker build -f apps/api/Dockerfile -t ai-sdlc-api .
  printf '\n==> Собираю фронтенд\n'
  local command=(docker build -f apps/web/Dockerfile)
  command+=(--build-arg "VITE_API_BASE_URL=${PUBLIC_ORIGIN}" --build-arg VITE_BASE_PATH=/)
  if [[ -r apps/web/public/private-fonts/fonts.css ]]; then
    command+=(--build-arg VITE_FONT_STYLESHEET_URL=/private-fonts/fonts.css)
  fi
  command+=(-t ai-sdlc-web .)
  "${command[@]}"
}

ensure_docker_objects() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 ||
    docker network create "$NETWORK_NAME" >/dev/null
  docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1 ||
    docker volume create "$DATA_VOLUME" >/dev/null
  [[ "$DEPLOY_MODE" == "https" ]] || return 0
  docker volume inspect "$CADDY_DATA_VOLUME" >/dev/null 2>&1 ||
    docker volume create "$CADDY_DATA_VOLUME" >/dev/null
  docker volume inspect "$CADDY_CONFIG_VOLUME" >/dev/null 2>&1 ||
    docker volume create "$CADDY_CONFIG_VOLUME" >/dev/null
}

prepare_caddy() {
  [[ "$DEPLOY_MODE" == "https" ]] || return 0
  mkdir -p "$CADDY_CONFIG_DIR"
  printf '%s\n' "$DOMAIN {" "    reverse_proxy ${WEB_CONTAINER}:80" "}" >"$CADDY_FILE"
  chmod 0644 "$CADDY_FILE"
  docker pull "$CADDY_IMAGE"
  docker run --rm --network none \
    -v "${CADDY_FILE}:/etc/caddy/Caddyfile:ro" \
    "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile
}

backup_database() {
  local running
  running="$(docker inspect --format '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null || true)"
  [[ "$running" == true ]] || return 0
  local timestamp filename container_path
  timestamp="$(date -u +%Y%m%d%H%M%S)"
  filename="game-${timestamp}.sqlite"
  container_path="/data/${filename}"
  mkdir -p "$BACKUP_DIR"
  printf '\n==> Сохраняю SQLite в %s/%s\n' "$BACKUP_DIR" "$filename"
  docker exec "$API_CONTAINER" node dist/backup.js /data/game.sqlite "$container_path"
  docker cp "${API_CONTAINER}:${container_path}" "${BACKUP_DIR}/${filename}"
  chmod 0600 "${BACKUP_DIR}/${filename}"
  docker exec "$API_CONTAINER" rm -f "$container_path"
}

remove_container() {
  docker container inspect "$1" >/dev/null 2>&1 || return 0
  docker rm -f "$1" >/dev/null
}

start_containers() {
  local allowed_origins="$PUBLIC_ORIGIN"
  if [[ -n "${EXTRA_CORS_ORIGINS:-}" ]]; then
    allowed_origins="${allowed_origins},${EXTRA_CORS_ORIGINS}"
  fi
  docker run -d --init --name "$API_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" -e "CORS_ORIGINS=${allowed_origins}" \
    -v "${DATA_VOLUME}:/data" ai-sdlc-api >/dev/null
  local web_command=(docker run -d --init --name "$WEB_CONTAINER" --restart unless-stopped)
  web_command+=(--network "$NETWORK_NAME")
  [[ "$DEPLOY_MODE" == "https" ]] || web_command+=(-p 80:80)
  web_command+=(ai-sdlc-web)
  "${web_command[@]}" >/dev/null
  [[ "$DEPLOY_MODE" == "https" ]] || return 0
  docker run -d --init --name "$PROXY_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" -p 80:80 -p 443:443 \
    -v "${CADDY_FILE}:/etc/caddy/Caddyfile:ro" \
    -v "${CADDY_DATA_VOLUME}:/data" -v "${CADDY_CONFIG_VOLUME}:/config" \
    "$CADDY_IMAGE" >/dev/null
}

check_health() {
  local attempt url="http://127.0.0.1/health"
  if [[ "$DEPLOY_MODE" == "https" ]]; then
    url="${PUBLIC_ORIGIN}/health"
  fi
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if [[ "$DEPLOY_MODE" == "https" ]]; then
      curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
        --resolve "${DOMAIN}:443:127.0.0.1" "$url" && return 0
    else
      curl --fail --silent --show-error --connect-timeout 5 --max-time 10 "$url" && return 0
    fi
    sleep 2
  done
  die "Приложение не ответило на ${PUBLIC_ORIGIN}/health"
}

main() {
  ((EUID == 0)) || die "Запустите скрипт от root"
  (($# == 1)) || die "Использование: ./scripts/update-vm.sh <домен или IP-адрес>"
  configure_target "$1"
  require_command docker
  require_command curl
  [[ -f apps/api/Dockerfile && -f apps/web/Dockerfile ]] || die "Запустите скрипт из корня репозитория"
  ensure_docker_connection
  build_images
  ensure_docker_objects
  prepare_caddy
  backup_database
  printf '\n==> Перезапускаю контейнеры\n'
  remove_container "$PROXY_CONTAINER"
  remove_container "$WEB_CONTAINER"
  remove_container "$API_CONTAINER"
  start_containers
  check_health
  printf '\nГотово: %s\n' "$PUBLIC_ORIGIN"
  docker ps --filter name=ai-sdlc
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
