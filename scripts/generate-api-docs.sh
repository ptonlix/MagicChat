#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/server"

go run github.com/swaggo/swag/cmd/swag@v1.16.6 init \
  --generalInfo main.go \
  --dir cmd/server,internal/httpserver \
  --output ../api-docs \
  --outputTypes json,yaml \
  --parseInternal
