#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/dev-lan-test.XXXXXX")"
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/project/scripts" "$fixture_root/bin"
cp "$repo_root/scripts/dev-lan.sh" "$fixture_root/project/scripts/dev-lan.sh"
touch "$fixture_root/project/.env"

cat > "$fixture_root/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == compose ]] || exit 1
shift

if [[ "${1:-}" == version ]]; then
  exit 0
fi

case "$*" in
  *"config --environment"*)
    printf 'FRONTEND_PORT=3300\nBACKEND_PORT=4400\nMAILPIT_PORT=8200\n'
    ;;
  *"config --quiet"*)
    exit 0
    ;;
  *"up --detach --force-recreate"*)
    exit 0
    ;;
  *)
    printf 'Unexpected docker compose invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
MOCK_DOCKER
chmod +x "$fixture_root/bin/docker"

PATH="$fixture_root/bin:$PATH" "$fixture_root/project/scripts/dev-lan.sh" up 192.0.2.20 > "$fixture_root/output.log"
lan_env="$fixture_root/project/.env.dev-lan"

assert_setting() {
  local expected="$1"
  if ! grep -Fxq "$expected" "$lan_env"; then
    printf 'Expected LAN configuration to contain: %s\n' "$expected" >&2
    cat "$lan_env" >&2
    exit 1
  fi
}

assert_setting 'FRONTEND_ORIGIN=http://192.0.2.20:3300'
assert_setting 'NEXT_PUBLIC_API_URL=http://192.0.2.20:4400'
assert_setting 'NEXT_ALLOWED_DEV_ORIGIN=192.0.2.20'
assert_setting 'MEDIA_BASE_URL=http://192.0.2.20:3300'
printf 'LAN origin configuration is correct.\n'
