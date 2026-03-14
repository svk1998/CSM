---
title: Deployment and Operations
nav_title: Deployment
nav_order: 9
kicker: Production Hosting
description: Review the recommended deployment shape, critical environment variables, data persistence, and maintenance checklist.
permalink: /deployment-and-operations/
---

## Recommended deployment shape

For production, use:

1. Docker Compose for the app and PostgreSQL
2. a private bind of `127.0.0.1:3000`
3. NGINX or another TLS reverse proxy in front
4. `WORKSPACE_PROXY_MODE=network`

## Containers

### `csm-app`

The control plane container.

Responsibilities:

- serves the admin and login pages
- manages sessions
- talks to PostgreSQL
- talks to Docker
- proxies workspace traffic

### `csm-db`

The PostgreSQL database container.

### `csm-<username>`

One dynamically created `code-server` container per user.

## Persistent data

There are two types of persistent state:

- PostgreSQL data in the `pgdata` volume
- workspace files and `code-server` state in Docker volumes or bind-mounted folders

## Networking

Two main networks are used:

- internal app-to-database traffic
- shared workspace network `csm-network`

The shared workspace network lets the app reach user containers by container name.

## Critical environment variables

| Variable | Why it matters |
| --- | --- |
| `SESSION_SECRET` | protects cookie-backed sessions |
| `ADMIN_PASSWORD` | controls admin bootstrap account |
| `POSTGRES_PASSWORD` | secures the database |
| `WORKSPACE_TRUSTED_ORIGINS` | allows browser origins to open workspace sockets |
| `CODE_SERVER_IMAGE` | selects the workspace image version |
| `IDLE_TIMEOUT_MINUTES` | controls auto-stop behavior |
| `COOKIE_SECURE` | should be `true` behind HTTPS |

## Reverse proxy requirements

Your reverse proxy must preserve:

- `Host`
- `Upgrade`
- `Connection`
- `X-Forwarded-Proto`

The example config is in `deploy/nginx/codespace-manager.conf.example`.

## Operational checklist

### Before first production launch

- set strong values in `.env`
- confirm `WORKSPACE_TRUSTED_ORIGINS`
- confirm the chosen `CODE_SERVER_IMAGE`
- verify TLS proxy config

### During upgrades

- rebuild the app container
- verify `/health` and `/ready`
- open the admin UI
- start a test workspace
- confirm editor HTTP and WebSocket traffic works

### Backups

Back up:

- PostgreSQL data
- workspace volumes
- `.env`

## Existing runbook

For day-2 command examples, see the [Operator Guide]({{ '/operator-guide/' | relative_url }}).
