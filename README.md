# CodeSpace Manager

CodeSpace Manager is a multi-user control plane for `code-server`. It gives admins one dashboard to create accounts and launch isolated workspaces while the app handles sessions, container lifecycle, and reverse proxying.

## What is included

- Express app with PostgreSQL-backed sessions and user records
- Admin dashboard for user lifecycle management
- Per-user `code-server` containers on a private Docker network
- Automatic workspace startup and idle shutdown
- Health endpoints, Docker Compose deployment files, and a production Dockerfile

## Quick start

### Windows with Docker Desktop

```powershell
Copy-Item .env.example .env
# Edit .env and set strong values for:
# - ADMIN_PASSWORD
# - SESSION_SECRET
# - POSTGRES_PASSWORD

docker compose up --build -d
```

### Linux

```bash
cp .env.example .env
# Edit .env and set strong values for:
# - ADMIN_PASSWORD
# - SESSION_SECRET
# - POSTGRES_PASSWORD

export DOCKER_GID=$(getent group docker | cut -d: -f3)
docker compose -f docker-compose.linux.yml up --build -d
```

Open `http://YOUR_SERVER_IP:3000` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
For a real production host, prefer placing NGINX or another TLS proxy in front and exposing only `https://your-domain`.

## Runtime architecture

```text
Browser -> CodeSpace Manager (3000) -> PostgreSQL
                                  -> Docker socket
                                  -> per-user code-server containers on csm-network
```

The application proxies user traffic to containers over the shared Docker network instead of proxying back to `127.0.0.1`, which makes the deployment work correctly when the manager itself runs in Docker.

## Important environment variables

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Required in production. Must be 32+ characters. |
| `ADMIN_PASSWORD` | Required in production. Strong admin credential. |
| `POSTGRES_PASSWORD` | Database password used by the app and PostgreSQL container. |
| `WORKSPACE_PROXY_MODE` | `network` for Docker deployment, `host` for direct host-based development. |
| `WORKSPACE_STORAGE_MODE` | `named-volume` by default for portable persistent workspaces. |
| `WORKSPACE_TRUSTED_ORIGINS` | Comma-separated browser origins allowed to open workspace websockets through the manager. |
| `CODE_SERVER_IMAGE` | code-server image to launch for user workspaces. |
| `IDLE_TIMEOUT_MINUTES` | Auto-stop timeout for inactive workspaces. |
| `COOKIE_SECURE` | Set to `true` when the app is served behind HTTPS. |

## Production notes

- Put this behind TLS before exposing it publicly.
- Change the defaults in `.env` before first deployment.
- Set `WORKSPACE_TRUSTED_ORIGINS` to the manager's public URL, for example `https://codespaces.example.com`.
- `CODE_SERVER_IMAGE` is pinned to `codercom/code-server:4.111.0`; update it deliberately during maintenance windows.
- Keep Docker access restricted. Mounting `docker.sock` gives this app control over the host Docker daemon.
- The Compose files bind the app to `127.0.0.1:3000` so it is only reachable locally unless you place a reverse proxy in front.

## Reverse proxy

- Example NGINX TLS config: `deploy/nginx/codespace-manager.conf.example`
- When you enable HTTPS, set `COOKIE_SECURE=true` in `.env` and restart the stack.

## Health checks

- `GET /health` for liveness
- `GET /ready` for database and Docker readiness

## Useful commands

```bash
docker compose logs -f app
docker compose ps
docker compose restart app
docker compose down
```

## Operations

- Operator runbook: `docs/OPERATOR_GUIDE.md`

## Source references

- App entry point: `src/index.js`
- Docker orchestration: `src/docker.js`
- Admin API: `src/routes/admin.js`
- Authentication API: `src/routes/auth.js`
