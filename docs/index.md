---
title: Home
nav_order: 1
kicker: Project Documentation
description: Learn how CodeSpace Manager is structured, how it runs, and how to operate it in production.
---

CodeSpace Manager is a control plane for multi-user `code-server` deployments. These docs are organized so you can move from a fast project overview into the runtime details that matter when you need to debug, deploy, or extend the system.

<div class="doc-actions">
  <a class="button button-primary" href="{{ '/system-overview/' | relative_url }}">Read the system overview</a>
  <a class="button button-secondary" href="{{ '/operator-guide/' | relative_url }}">Open the operator guide</a>
</div>

<div class="doc-grid">
  <a class="doc-card" href="{{ '/system-overview/' | relative_url }}">
    <h2>Understand the system</h2>
    <p>Start with the problem the app solves, the main actors, and the deployment boundaries.</p>
  </a>
  <a class="doc-card" href="{{ '/architecture/' | relative_url }}">
    <h2>See the architecture</h2>
    <p>Trace requests through Express, PostgreSQL, Docker, and per-user workspaces.</p>
  </a>
  <a class="doc-card" href="{{ '/runtime-flows/' | relative_url }}">
    <h2>Follow runtime behavior</h2>
    <p>Understand startup, login, workspace creation, WebSocket proxying, and reconciliation.</p>
  </a>
  <a class="doc-card" href="{{ '/code-map/' | relative_url }}">
    <h2>Find the code fast</h2>
    <p>Jump from a responsibility to the exact file that implements it.</p>
  </a>
  <a class="doc-card" href="{{ '/deployment-and-operations/' | relative_url }}">
    <h2>Deploy with confidence</h2>
    <p>Review deployment shape, data persistence, reverse proxy requirements, and maintenance points.</p>
  </a>
  <a class="doc-card" href="{{ '/operator-guide/' | relative_url }}">
    <h2>Operate the stack</h2>
    <p>Use the day-2 runbook for health checks, rebuilds, backups, and troubleshooting.</p>
  </a>
</div>

## Recommended reading path

1. [System Overview]({{ '/system-overview/' | relative_url }})
2. [Architecture]({{ '/architecture/' | relative_url }})
3. [Runtime Flows]({{ '/runtime-flows/' | relative_url }})
4. [Code Map]({{ '/code-map/' | relative_url }})
5. [Deployment and Operations]({{ '/deployment-and-operations/' | relative_url }})
6. [Operator Guide]({{ '/operator-guide/' | relative_url }})

## What is documented here

- the high-level product intent and deployment model
- the application boundaries between control plane, data plane, and persistence
- the Node.js code structure under `src/`
- the Docker-based workspace lifecycle
- production operations and documentation publishing

## Useful project links

- [Repository]({{ site.repository_url }})
- [Release v1.0.0]({{ site.release_url }})
- [Maintainer Guide]({{ '/maintainer-guide/' | relative_url }})
- [Publishing Docs]({{ '/publishing-docs/' | relative_url }})
