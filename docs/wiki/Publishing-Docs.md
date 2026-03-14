---
title: Publishing Docs
nav_order: 10
kicker: Documentation Strategy
description: Understand why GitHub Pages is the right fit here and how this repository publishes its docs site.
permalink: /publishing-docs/
---

## Short answer

For this repository, GitHub Pages is the better long-term choice.

GitHub Wiki is still useful for quick internal notes, but Pages fits this project better because the documentation is already part of the codebase and benefits from versioned review.

## Recommendation

### Use GitHub Pages if you want

- documentation reviewed in pull requests
- docs versioned alongside code changes
- better navigation and site structure
- custom domain support
- better public discoverability
- room to grow into a full docs site later

### Use GitHub Wiki if you want

- very quick ad hoc editing in the browser
- lightweight contributor notes
- a simple long-form companion to the README

## Why Pages is the better fit here

This project already has:

- a meaningful `docs/` folder
- operational runbooks
- architecture material
- deployment examples
- code-level design details that should evolve with commits

That makes repository-backed docs a stronger fit than a separate wiki repo.

## Practical plan

### Best path

1. keep documentation source in `docs/`
2. use `docs/wiki/` as the maintainable authoring structure
3. publish the same material from `main:/docs` on GitHub Pages

### Acceptable short-term path

1. enable the GitHub Wiki feature in repository settings
2. copy the files from `docs/wiki/` into the wiki
3. keep the repo copy as the source of truth

## Current status

The repository docs now publish from GitHub Pages, which keeps documentation versioned alongside the code. The repo's `.wiki.git` remote was not available when the wiki-ready structure was created, which strongly suggested the GitHub Wiki feature was not enabled at that point.

The repository also includes `.github/workflows/pages.yml`, so once GitHub Pages is enabled for this repository, pushes to `main` that touch `docs/` automatically rebuild the site.

## Source material

This recommendation also lines up with GitHub's own product boundaries:

- GitHub says wikis are for repository documentation and long-form content
- GitHub Pages is a static site hosting service that publishes directly from a repository
- GitHub notes that if you need search engine indexing or a larger docs surface, Pages is the better fit
