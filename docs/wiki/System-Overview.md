# System Overview

## Purpose

CodeSpace Manager exists to solve one specific problem: safely operating many `code-server` workspaces behind a single entry point.

Instead of exposing one editor instance directly, the project adds:

- authentication and session handling
- an admin control plane
- per-user container lifecycle management
- reverse proxying for editor traffic
- persistent metadata and session storage

## Primary actors

### Administrator

The administrator signs into the admin UI and can:

- create users
- rotate user passwords
- enable or disable accounts
- start and stop workspaces
- delete users and workspace data

### Workspace user

A non-admin user signs in and is redirected to `/workspace/`, which is proxied to that user's `code-server` container.

## Runtime boundaries

### Control plane

The Node.js application handles:

- session management
- admin APIs
- workspace routing
- Docker orchestration
- health checks and logging

### Data plane

The actual editor runtime is a `code-server` container per user.

### State plane

PostgreSQL stores:

- users
- sessions
- workspace metadata

Docker volumes or bind mounts store:

- user project files
- `code-server` state such as extensions and settings

## Supported deployment model

The default production model is:

1. run the manager and PostgreSQL in Docker Compose
2. place the manager on `127.0.0.1:3000`
3. put NGINX or another TLS reverse proxy in front
4. let the manager create user workspaces on the shared Docker network

## Notable constraints

- The app needs access to `docker.sock`, which is powerful and should be tightly controlled.
- Admin and user sessions are intentionally separate concerns.
- Admin accounts are management-only accounts, not development workspaces.
- Workspace WebSocket access depends on correct proxy headers and trusted origins.

