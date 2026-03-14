#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Update secrets before continuing."
  exit 1
fi

if getent group docker >/dev/null 2>&1; then
  export DOCKER_GID="$(getent group docker | cut -d: -f3)"
  docker compose -f docker-compose.linux.yml up --build -d
else
  docker compose up --build -d
fi
