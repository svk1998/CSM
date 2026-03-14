---
title: Code Map
nav_order: 6
kicker: Repository Guide
description: Map repository files to the responsibilities they own in the running system.
permalink: /code-map/
---

This page maps the repository to responsibilities.

## Top-level files

### `Dockerfile`

Builds the production app image.

### `docker-compose.yml`

Default Docker Desktop and local deployment.

### `docker-compose.linux.yml`

Linux variant that adds Docker group access for `/var/run/docker.sock`.

### `README.md`

Quick-start and high-level project summary.

### `docs/OPERATOR_GUIDE.md`

Runbook for day-2 operations.

### `deploy/nginx/codespace-manager.conf.example`

Example TLS reverse-proxy configuration.

## Backend files

### `src/index.js`

Application bootstrap, HTTP server, routes, health endpoints, and WebSocket upgrade handling.

### `src/config.js`

Environment parsing and validation.

Important config groups:

- application host and port
- session and admin credentials
- PostgreSQL configuration
- Docker and workspace settings
- trusted browser origins for workspace sockets

### `src/db.js`

PostgreSQL connection and startup migrations.

### `src/docker.js`

Core workspace manager.

Most important functions:

- `getOrCreateWorkspace`
- `createWorkspace`
- `ensureRunning`
- `stopWorkspace`
- `deleteWorkspace`
- `stopIdleWorkspaces`
- `touchWorkspace`

### `src/logger.js`

Winston logger setup for console output plus `logs/app.log` and `logs/error.log`.

### `src/middleware/auth.js`

Route protection helpers:

- `requireAuth`
- `requireAdmin`
- `requireWorkspaceUser`

### `src/routes/auth.js`

Authentication API:

- login
- logout
- session introspection

### `src/routes/admin.js`

Admin API for:

- dashboard summary
- user CRUD
- workspace start and stop
- workspace stats

### `src/routes/workspace.js`

Workspace HTTP proxy and `/workspace` path normalization.

## Frontend files

### `public/login.html`

Login page plus session-aware account switching flow.

### `public/admin.html`

Single-page admin dashboard that talks to `/api/admin/*`.
