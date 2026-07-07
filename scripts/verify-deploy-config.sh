#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "deploy config check failed: $*" >&2
  exit 1
}

assert_file() {
  local path="$1"
  [[ -f "${ROOT_DIR}/${path}" ]] || fail "missing ${path}"
}

assert_contains() {
  local path="$1"
  local expected="$2"

  grep -Fq -- "${expected}" "${ROOT_DIR}/${path}" ||
    fail "${path} does not contain: ${expected}"
}

assert_file "compose.yml"
assert_file "server/Dockerfile"
assert_file "deploy/nginx/Dockerfile"
assert_file "deploy/nginx/nginx.conf"
assert_file "deploy/server/config.example.yaml"
assert_file ".github/workflows/docker.yml"
assert_file ".dockerignore"

assert_contains "compose.yml" "ghcr.1ms.run"
assert_contains "compose.yml" "ghcr.1ms.run/chaitin/mygod"
assert_contains "compose.yml" "rustfs/rustfs"
assert_contains "compose.yml" 'RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:-mygod}'
assert_contains "compose.yml" 'RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:-change-me}'
assert_contains "compose.yml" "443:443"
assert_contains "compose.yml" "8443:8443"
assert_contains "compose.yml" "./data/postgres/data:/var/lib/postgresql/data"
assert_contains "compose.yml" "./data/rustfs/data:/data"
assert_contains "compose.yml" "./data/server/config:/app/config:ro"
assert_contains "compose.yml" "./data/server/log:/app/log"
assert_contains "compose.yml" "./data/nginx/certs:/etc/nginx/certs:ro"
assert_contains "compose.yml" "./data/nginx/log:/var/log/nginx"

if grep -Fq -- "nginx.conf" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not mount nginx.conf; it must be baked into the nginx image"
fi
if grep -Fq -- "your-org" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not contain placeholder image namespace"
fi

assert_contains ".dockerignore" "data"
assert_contains ".dockerignore" "**/node_modules"
assert_contains ".dockerignore" "**/dist"

assert_contains "deploy/server/config.example.yaml" "postgres://app:app@postgres:5432/app?sslmode=disable"
assert_contains "deploy/server/config.example.yaml" "endpoint: \"http://rustfs:9000\""
assert_contains "deploy/server/config.example.yaml" "access_key_id: \"\""
assert_contains "deploy/server/config.example.yaml" "secret_access_key: \"\""
assert_contains "deploy/server/config.example.yaml" "public: \"mygod-public\""
assert_contains "deploy/server/config.example.yaml" "private: \"mygod-private\""
assert_contains "deploy/server/config.example.yaml" "temporary: \"mygod-temporary\""
assert_contains "deploy/server/config.example.yaml" "temporary_expire_days: 180"

assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf"

assert_contains "deploy/nginx/nginx.conf" "listen 443 ssl"
assert_contains "deploy/nginx/nginx.conf" "listen 8443 ssl"
assert_contains "deploy/nginx/nginx.conf" "root /usr/share/nginx/client"
assert_contains "deploy/nginx/nginx.conf" "root /usr/share/nginx/admin"
assert_contains "deploy/nginx/nginx.conf" "location /api/client/ws"
assert_contains "deploy/nginx/nginx.conf" "proxy_set_header Upgrade"
assert_contains "deploy/nginx/nginx.conf" "location /api/client/"
assert_contains "deploy/nginx/nginx.conf" "location /api/admin/"

assert_contains "server/Dockerfile" "go build"
assert_contains "server/Dockerfile" "COPY server/migrations"
assert_contains "server/Dockerfile" "COPY api-docs"

assert_contains "deploy/nginx/Dockerfile" "pnpm build"
assert_contains "deploy/nginx/Dockerfile" "COPY --from=client-build /src/client-web/dist /usr/share/nginx/client"
assert_contains "deploy/nginx/Dockerfile" "COPY --from=admin-build /src/admin-web/dist /usr/share/nginx/admin"

assert_contains ".github/workflows/docker.yml" "ghcr.io"
assert_contains ".github/workflows/docker.yml" "server/Dockerfile"
assert_contains ".github/workflows/docker.yml" "deploy/nginx/Dockerfile"
assert_contains ".github/workflows/docker.yml" "docker/build-push-action@v7"

echo "deploy config check passed"
