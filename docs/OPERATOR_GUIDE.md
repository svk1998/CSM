# Operator Guide

## Purpose

This guide is for the person operating the CodeSpace Manager service in production or on an internal server.

## Main components

- `app`: the Express control plane
- `db`: PostgreSQL for users, sessions, and workspace records
- `csm-<username>`: per-user `code-server` containers created on demand

Core files:

- `docker-compose.yml`: default Docker Desktop or localhost deployment
- `docker-compose.linux.yml`: Linux deployment with Docker group support
- `.env`: live environment configuration
- `deploy/nginx/codespace-manager.conf.example`: TLS reverse-proxy example

## Before you start

- Keep strong values in `.env` for `ADMIN_PASSWORD`, `SESSION_SECRET`, and `POSTGRES_PASSWORD`.
- Set `COOKIE_SECURE=true` once the service is behind HTTPS.
- Set `WORKSPACE_TRUSTED_ORIGINS` to every public manager origin that users open in the browser.
- Review `CODE_SERVER_IMAGE` before upgrades.

## Start the service

### Windows or Docker Desktop

```powershell
docker compose up --build -d
```

### Linux

```bash
docker compose -f docker-compose.linux.yml up --build -d
```

## Stop the service

This stops the app, database, and any running user workspaces without deleting data.

```powershell
$containers = docker ps -q --filter name=csm-
if ($containers) { docker stop $containers }
```

To start the app and database again later, run the normal compose command.

## Restart only the app

```powershell
docker compose up -d --build app
```

## Check health

### Container status

```powershell
docker ps --filter name=csm-
```

### HTTP health checks

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/ready
```

Expected result:

- `/health` returns `status: ok`
- `/ready` returns `status: ready`

## View logs

### App logs

```powershell
Get-Content logs/app.log -Tail 100
Get-Content logs/error.log -Tail 100
```

### Live container logs

```powershell
docker compose logs -f app
docker compose logs -f db
docker logs -f csm-username
```

## Admin operations

Use the web UI at `http://localhost:3000` or your HTTPS hostname.

Admin actions available:

- create users
- disable or enable accounts
- start and stop workspaces
- delete users and their workspace data

## Workspace behavior

- A workspace container is created the first time a user starts it.
- Workspace files persist in Docker volumes.
- The app prepares filesystem ownership before each create or restart so `code-server` can write to its data directories.
- Idle workspaces are stopped automatically based on `IDLE_TIMEOUT_MINUTES`.

## Common maintenance

### Rebuild after code changes

```powershell
docker compose up -d --build app
```

### Rotate the admin password

1. Update `ADMIN_PASSWORD` in `.env`.
2. Rebuild and restart the app.

```powershell
docker compose up -d --build app
```

The admin user password is reconciled from config during app startup.

### Update the code-server version

1. Change `CODE_SERVER_IMAGE` in `.env`.
2. Restart the app.
3. Start a test workspace from the admin UI.
4. Confirm the new workspace boots cleanly.

Existing user workspaces pick up the new image the next time a workspace is recreated.

### Change the public URL

If users access the manager through a different hostname, port, or protocol, update `WORKSPACE_TRUSTED_ORIGINS` in `.env` and rebuild the app. Include the full browser origin, such as `https://codespaces.example.com`.

## Backup guidance

At minimum back up:

- PostgreSQL data volume
- user workspace Docker volumes
- `.env`

If you need full recovery, restoring only PostgreSQL without workspace volumes will recreate metadata but not user files.

## Troubleshooting

### App is up but login fails

- Check `logs/error.log`
- Check PostgreSQL container health
- Verify `.env` values are valid

### `/ready` fails

- Confirm `csm-db` is running
- Confirm Docker daemon access is available to the app
- Inspect `docker compose logs app`

### Workspace does not open

- Check `docker logs csm-username`
- Check whether the workspace container exists with `docker ps -a --filter name=csm-username`
- If needed, stop and restart the workspace from the admin UI

### You need a clean application restart without deleting data

```powershell
docker compose stop app db
docker compose up -d --build app db
```

### You need to remove the whole stack but keep repo files

```powershell
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete PostgreSQL data and persistent workspace volumes.
