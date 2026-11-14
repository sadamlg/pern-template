#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
base_env="$project_root/.env"
lan_env="$project_root/.env.dev-lan"

usage() {
  cat <<'EOF'
Activa o desactiva el acceso local de desarrollo desde la red LAN.

Uso:
  scripts/dev-lan.sh up <ipv4-del-equipo>
  scripts/dev-lan.sh off

El modo LAN publica frontend, API y la bandeja web de Mailpit en la IPv4 indicada.
También configura MEDIA_BASE_URL con la dirección del frontend para las apps que generan URL absolutas de medios.
PostgreSQL queda enlazado a localhost y el SMTP de Mailpit sólo está en Compose.
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_setup() {
  [[ -f "$base_env" ]] || fail "No existe .env. Cópialo desde .env.example antes de usar este script."
  command -v docker >/dev/null 2>&1 || fail "Docker CLI no está instalado o no está en PATH."
  docker compose version >/dev/null 2>&1 || fail "No está disponible el plugin docker compose."
}

is_ipv4() {
  local address="$1"
  local octet
  local octets

  [[ "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    [[ "$octet" != 0* || "${#octet}" -eq 1 ]] || return 1
    ((10#$octet <= 255)) || return 1
  done
  [[ "$address" != 0.0.0.0 && "$address" != 127.* ]]
}

compose_setting() {
  local name="$1"
  docker compose --env-file "$base_env" config --environment |
    awk -F= -v name="$name" '$1 == name { value = substr($0, index($0, "=") + 1); found = 1 } END { if (found) print value; else exit 1 }'
}

read_port() {
  local name="$1"
  local fallback="$2"
  local value

  value="$(compose_setting "$name")" || value="$fallback"
  [[ "$value" =~ ^[0-9]{1,5}$ ]] || fail "$name debe ser un puerto numérico."
  ((10#$value > 0 && 10#$value <= 65535)) || fail "$name debe estar entre 1 y 65535."
  printf '%s\n' "$value"
}

up_lan() {
  local lan_ip="$1"
  local frontend_port
  local backend_port
  local mailpit_port
  local temp_env

  is_ipv4 "$lan_ip" || fail "Indica la IPv4 del anfitrión; no uses localhost ni 0.0.0.0."
  docker compose --env-file "$base_env" config --quiet
  frontend_port="$(read_port FRONTEND_PORT 3000)"
  backend_port="$(read_port BACKEND_PORT 4000)"
  mailpit_port="$(read_port MAILPIT_PORT 8025)"

  temp_env="$(mktemp "$project_root/.env.dev-lan.XXXXXX")"
  trap 'rm -f "$temp_env"' EXIT
  {
    printf 'FRONTEND_BIND_ADDRESS=0.0.0.0\n'
    printf 'BACKEND_BIND_ADDRESS=0.0.0.0\n'
    printf 'MAILPIT_BIND_ADDRESS=0.0.0.0\n'
    printf 'NEXT_ALLOWED_DEV_ORIGIN=%s\n' "$lan_ip"
    printf 'MEDIA_BASE_URL=http://%s:%s\n' "$lan_ip" "$frontend_port"
  } > "$temp_env"
  mv "$temp_env" "$lan_env"
  trap - EXIT

  docker compose --env-file "$base_env" --env-file "$lan_env" config --quiet
  docker compose --env-file "$base_env" --env-file "$lan_env" \
    up --detach --force-recreate frontend backend worker mailpit

  printf '\nFrontend:http://%s:%s\n' "$lan_ip" "$frontend_port"
  printf 'API:     http://%s:%s/health\n' "$lan_ip" "$backend_port"
  printf 'Mailpit: http://%s:%s\n' "$lan_ip" "$mailpit_port"
  printf 'PostgreSQL y el SMTP de Mailpit siguen sólo en la red local de desarrollo.\n'
}

turn_off_lan() {
  docker compose --env-file "$base_env" config --quiet
  docker compose --env-file "$base_env" \
    up --detach --force-recreate frontend backend worker mailpit
  rm -f "$lan_env"
  printf 'Acceso LAN desactivado; se restauraron los enlaces configurados en .env.\n'
}

action="${1:-}"
if [[ "$action" == "-h" || "$action" == "--help" || -z "$action" ]]; then
  usage
  exit 0
fi
shift

require_setup
cd "$project_root"

case "$action" in
  up)
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    up_lan "$1"
    ;;
  off)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    turn_off_lan
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
