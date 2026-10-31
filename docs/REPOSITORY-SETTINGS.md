# Repository settings (maintainers)

Settings that live in GitHub, not in files. Apply once per repository, including forks that run their own program. Check them again after any ownership or visibility change.

## Settings → General
- Features: **Issues on**; Wiki **off**; Projects **off**; Discussions off (support goes through issue forms).
- Pull requests: allow **squash merging only** (default message: pull request title and description); **Always suggest updating pull request branches**; **Allow auto-merge**; **Automatically delete head branches**.
- **Require contributors to sign off on web-based commits.**

## Settings → Advanced Security (Code security and analysis)
- **Dependency graph**: on (needed by the `dependency-review` workflow).
- **Dependabot alerts**: on. **Dependabot security updates**: on. (Version updates come from `.github/dependabot.yml`.)
- **Private vulnerability reporting**: on (`SECURITY.md` links to it).
- **Secret scanning**: on, with **Push protection**, **non-provider patterns** and **validity checks**.
- **Code scanning**: leave *Default setup* **off**; the `codeql` workflow is the advanced setup and the two conflict.

## Settings → Rules → Rulesets → New branch ruleset "main"
- Enforcement: **Active**. Target: default branch.
- Bypass list: Repository admin, **for pull requests only**.
- Rules: **Restrict deletions**; **Block force pushes**; **Require linear history**; **Require a pull request before merging** (0 approvals while there is one maintainer, conversation resolution required); **Require status checks to pass**, branch up to date, with these checks:
  - `e2e (Workers runtime + D1)`
  - `browser (11 languages, RTL, offline)`
  - `analyze (javascript-typescript)`
- **Require code scanning results**: CodeQL, alerts *High or higher* block.

## Settings → Rules → Rulesets → New tag ruleset "releases"
- Target `v*`; **Restrict deletions**, **Block force pushes**, **Restrict updates**.

## Settings → Actions → General
- Actions permissions: **Allow enterprise, and select non-enterprise, actions** → *Allow actions created by GitHub* + pattern `ossf/scorecard-action@*`.
- **Require actions to be pinned to a full-length commit SHA.**
- Workflow permissions: **Read repository contents** (default token read-only); do **not** allow Actions to create or approve pull requests.
- Fork pull request workflows: **Require approval for all outside collaborators**.

## Settings → Secrets and variables → Actions → Variables
- `MONITOR_URL` = `https://walk.savvysolutionpros.com`, `MONITOR_ORG` = `demo` (enables the 15-minute `monitor` workflow). No secrets are needed by any workflow.

## Settings → General (top) and About (repository home ⚙)
- Description, website, topics: `safe-passage community-safety privacy nonprofit civic-tech cloudflare-workers d1 pwa i18n new-york-city school-safety agpl`.
- **Social preview**: a 1280×640 image with the name and "Coordinates adults. Never tracks children." (no children's faces).

## Releases
- Tag `vX.Y.Z` on `main` after CI is green; title "Walk With Us vX.Y.Z"; body from `CHANGELOG.md`.
