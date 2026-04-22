# Contributing

Thanks for considering a contribution.

Canonical engineering rules for every IT-BAER Grafana plugin live in the
**grafana-mp** source-of-truth repo:

👉 https://github.com/IT-BAER/grafana-mp/blob/main/CONVENTIONS.md

Read that first. This file only covers project-specific notes.

## Dev setup

```bash
npm install
npm run dev           # watch build
docker compose up     # Grafana at http://localhost:3000  (admin/admin)
```

Backend (only if `backend: true` in `plugin.json`):

```bash
mage -v build:linux   # or buildAll for multi-arch
```

## Tests

```bash
npm test              # unit
npm run e2e           # Playwright end-to-end
```

## Pull request checklist

- [ ] Branch from `main`, rebase before requesting review.
- [ ] New/changed behavior has tests.
- [ ] `npm run lint && npm run typecheck` pass.
- [ ] CHANGELOG.md entry added under `## [Unreleased]`.
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, etc.).
- [ ] No secrets or credentials committed.

## Release (maintainers)

1. Bump `version` in `src/plugin.json` and move CHANGELOG `Unreleased` → `[X.Y.Z] - YYYY-MM-DD`.
2. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
3. GitHub Actions release workflow signs + publishes the ZIP.
4. Submit the release asset URL to the Grafana catalog (only on first release; updates go through the same `My Plugins` entry).

## Code of conduct

Be decent. See https://www.contributor-covenant.org/version/2/1/code_of_conduct/
