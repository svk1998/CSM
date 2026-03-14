---
title: Data Model
nav_order: 7
kicker: Persistence Layer
description: Review the PostgreSQL tables used for users, workspaces, and session storage.
permalink: /data-model/
---

The app uses three PostgreSQL tables created in `src/db.js`.

## `users`

Purpose:

- stores all accounts
- stores both admin and non-admin users
- stores default per-user resource limits

Key columns:

| Column | Meaning |
| --- | --- |
| `id` | primary key |
| `username` | unique login name |
| `password` | bcrypt hash |
| `email` | optional contact field |
| `is_admin` | admin vs workspace user |
| `is_active` | enabled vs disabled |
| `cpu_shares` | Docker CPU shares for the user's workspace |
| `memory_mb` | Docker memory limit for the user's workspace |

## `workspaces`

Purpose:

- stores one workspace record per non-admin user
- maps users to workspace containers

Key columns:

| Column | Meaning |
| --- | --- |
| `user_id` | unique reference to `users.id` |
| `container_id` | Docker container ID |
| `container_name` | stable Docker container name |
| `port` | host port when using host proxy mode |
| `status` | provisioning, running, or stopped |
| `last_active` | last known user activity time |

Important relationship:

- `user_id` is unique, so each user can have at most one workspace record

## `sessions`

Purpose:

- stores Express session state for `connect-pg-simple`

Key columns:

| Column | Meaning |
| --- | --- |
| `sid` | session ID |
| `sess` | JSON session payload |
| `expire` | expiration timestamp |

## Admin bootstrap behavior

On startup, the app ensures the configured admin user exists.

That means:

- the admin record is inserted if missing
- the admin password is reset from config on each startup
- the admin account is forced to stay active and admin

This is convenient operationally, but it means the configured admin password in `.env` is the source of truth.
