#!/usr/bin/env bash

set -Eeuo pipefail

readonly NETWORK_NAME="ai-sdlc"
readonly DATA_VOLUME="ai-sdlc-data"
readonly API_CONTAINER="ai-sdlc-api"
readonly WEB_CONTAINER="ai-sdlc-web"
readonly BACKUP_DIR="/var/backups/ai-sdlc-game"

die() {
  printf 'Ошибка: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Не найдена команда: $1"
}

ensure_docker_connection() {
  unset DOCKER_API_VERSION
  docker version >/dev/null 2>&1 && return 0
  export DOCKER_API_VERSION=1.43
  docker version >/dev/null 2>&1 || die "Не удалось подключиться к Docker daemon"
}

validate_ip() {
  local ip="$1" octet
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "Укажите IPv4-адрес без http://"
  local parts=()
  IFS=. read -r -a parts <<<"$ip"
  for octet in "${parts[@]}"; do
    ((10#$octet <= 255)) || die "Некорректный IPv4-адрес: $ip"
  done
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
  docker run -d --init --name "$API_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" -e "CORS_ORIGINS=${PUBLIC_ORIGIN}" \
    -v "${DATA_VOLUME}:/data" ai-sdlc-api >/dev/null
  docker run -d --init --name "$WEB_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" -p 80:80 ai-sdlc-web >/dev/null
}

main() {
  ((EUID == 0)) || die "Запустите скрипт от root"
  (($# == 1)) || die "Использование: ./scripts/update-vm.sh <IP-адрес>"
  validate_ip "$1"
  PUBLIC_ORIGIN="http://$1"
  require_command docker
  require_command curl
  [[ -f apps/api/Dockerfile && -f apps/web/Dockerfile ]] || die "Запустите скрипт из корня репозитория"
  ensure_docker_connection
  build_images
  ensure_docker_objects
  backup_database
  printf '\n==> Перезапускаю контейнеры\n'
  remove_container "$WEB_CONTAINER"
  remove_container "$API_CONTAINER"
  start_containers
  curl --fail --show-error --retry 20 --retry-connrefused --retry-delay 1 \
    http://127.0.0.1/health
  printf '\nГотово: %s\n' "$PUBLIC_ORIGIN"
  docker ps --filter name=ai-sdlc
}

main "$@"
