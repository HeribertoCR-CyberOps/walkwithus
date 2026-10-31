# OpenSSF Best Practices: passing-level answers

Project entry: <https://www.bestpractices.dev/en/projects/16109>. Each row gives the answer to select and the justification to paste. Every justification points to evidence in this repository. Update this file whenever an answer changes.

Base URL used below: `R = https://github.com/HeribertoCR-CyberOps/walkwithus`

## Basics

| Criterion | Answer | Justification |
|---|---|---|
| description_good | Met | The README's first lines state what it does and the problem it solves (safe-passage coordination for community organizations; coordinates adults, never tracks children): R#readme. The live site shows the same: https://walk.savvysolutionpros.com |
| interact | Met | Obtain: R (git clone, README "Deploy"). Feedback: issue forms for bugs, translations and organizations at R/issues/new/choose. Contribute: R/blob/main/CONTRIBUTING.md |
| contribution | Met | R/blob/main/CONTRIBUTING.md describes the pull-request process; `main` requires a pull request, passing checks and linear history. |
| contribution_requirements | Met | R/blob/main/CONTRIBUTING.md#ground-rules-non-negotiable: coding standard (TypeScript strict, `noUncheckedIndexedAccess`, no runtime dependencies, `.editorconfig`), tests required, privacy rules. PR checklist: R/blob/main/.github/pull_request_template.md |
| floss_license, floss_license_osi | Met | AGPL-3.0-only (OSI-approved): R/blob/main/LICENSE |
| license_location | Met | R/blob/main/LICENSE |
| documentation_basics | Met | README (what it is, deploy, test), docs/DEPLOY.md, docs/FOR-ORGANIZATIONS.md, docs/VOLUNTEER-BRIEFING.md: R/tree/main/docs |
| documentation_interface | Met | Complete HTTP API reference (every endpoint, request body, response and error code): R/blob/main/docs/API.md |
| sites_https | Met | GitHub and https://walk.savvysolutionpros.com are HTTPS-only (HSTS, TLS 1.2+). |
| discussion | Met | GitHub issues and pull requests: searchable, URL-addressable, open to anyone, no proprietary client needed. R/issues |
| english | Met | All documentation is in English, and reports are accepted in English (the app itself also ships 10 more languages). |
| maintained | Met | Active development and security maintenance (Dependabot weekly, CodeQL, Scorecard): R/commits/main |

## Change control

| Criterion | Answer | Justification |
|---|---|---|
| repo_public, repo_track, repo_distributed | Met | Public git repository on GitHub with full history: R |
| repo_interim | Met | Every change lands through pull requests on `main` between releases: R/pulls?q=is%3Apr |
| version_unique | Met | Semantic versions in package.json, `/api/health` and CHANGELOG: R/blob/main/CHANGELOG.md |
| version_semver | Met | SemVer (MAJOR.MINOR.PATCH). |
| version_tags | Met | Each release is a git tag (`vX.Y.Z`) with a GitHub release: R/releases |
| release_notes | Met | Human-written notes per version: R/blob/main/CHANGELOG.md and R/releases |
| release_notes_vulns | N/A | No publicly known vulnerabilities (CVE or similar) have affected this project. |

## Reporting

| Criterion | Answer | Justification |
|---|---|---|
| report_process | Met | R/issues/new/choose (bug, translation and organization forms) |
| report_tracker | Met | GitHub Issues: R/issues |
| report_responses, enhancement_responses | Met | All reports are acknowledged; SUPPORT.md commits to one week (48 h for security): R/blob/main/SUPPORT.md |
| report_archive | Met | Public, searchable issue archive: R/issues?q=is%3Aissue |
| vulnerability_report_process | Met | R/blob/main/SECURITY.md |
| vulnerability_report_private | Met | GitHub private vulnerability reporting is enabled: R/security/advisories/new (linked from SECURITY.md) |
| vulnerability_report_response | Met | SECURITY.md commits to acknowledgement within 48 h; no reports have been received so far. |

## Quality

| Criterion | Answer | Justification |
|---|---|---|
| build | Met | `npm ci` then `wrangler deploy` builds and bundles the Worker from source; CI builds every push: R/actions |
| build_common_tools | Met | npm, TypeScript, Wrangler (Cloudflare's open-source CLI). |
| build_floss_tools | Met | All build tools are FLOSS (npm, TypeScript, Wrangler, esbuild). |
| test | Met | Automated suites in `test/` (FLOSS, in this repo): `npm test` (24 end-to-end tests on the real Workers runtime + D1), `npm run test:property` (fast-check), `npm run test:ui` (browser checks, all languages). Documented in README and CONTRIBUTING; run in CI: R/blob/main/.github/workflows/test.yml |
| test_invocation | Met | Standard npm scripts: `npm test`, `npm run test:property`, `npm run test:ui`. |
| test_most | Met | Tests cover every public, volunteer and coordinator endpoint, every validation and error path, auth refusal cases, Rule of Two, rate limits, purge, key rotation, audit chain, and the UI in all 11 languages, RTL and offline. |
| test_continuous_integration | Met | GitHub Actions on every push and PR; merging to `main` requires the test, browser and CodeQL checks. |
| test_policy | Met | CONTRIBUTING: "New functionality and every bug fix add or extend an automated test". PR template requires it: R/blob/main/CONTRIBUTING.md |
| tests_are_added | Met | Recent changes added tests with the code, e.g. property tests with the v1.1.2 randomString fix (R/pull/2) and the browser check with the v1.1.3 walk-form fix. |
| tests_documented_added | Met | R/blob/main/.github/pull_request_template.md |
| warnings | Met | TypeScript `strict` + `noUncheckedIndexedAccess` + `noImplicitReturns` (tsconfig.json); CodeQL security-extended; actionlint for workflows. |
| warnings_fixed | Met | `npm run typecheck` is clean and required in CI; CodeQL alerts of High or above block merging. |
| warnings_strict | Met | Strictest practical TypeScript settings; CodeQL `security-extended` query suite. |

## Security

| Criterion | Answer | Justification |
|---|---|---|
| know_secure_design | Met | The primary developer is a systems administrator and founder of a cybersecurity firm. The design applies least privilege, data minimization, defense in depth (Access at the edge plus in-Worker JWT checks), fail-safe defaults and complete mediation: docs/BLUEPRINT.md, SECURITY.md threat model. |
| know_common_errors | Met | OWASP API Top 10 / ASVS mapping and mitigations: docs/AUDIT.md. Strict input schemas, CSRF origin check, CSP `default-src 'none'`, rate limits, parameterized SQL only. |
| crypto_published | Met | AES-256-GCM, HMAC-SHA-256, SHA-256, RS256 (JWT verification) via WebCrypto: src/crypto.ts, src/access.ts |
| crypto_call | Met | Uses the platform WebCrypto API only; no cryptography is implemented by hand. |
| crypto_floss | Met | WebCrypto is available in FLOSS runtimes (workerd, Node.js); no proprietary cryptography. |
| crypto_keylength | Met | 256-bit AES and HMAC keys (startup refuses shorter keys); RSA ≥ 2048 from Cloudflare Access. |
| crypto_working, crypto_weaknesses | Met | No MD5, SHA-1, DES, RC4 or CBC; AES-GCM with a fresh 96-bit IV per value and row-bound AAD. |
| crypto_pfs | N/A | The application performs no key agreement; TLS (with forward secrecy) is terminated by Cloudflare. |
| crypto_password_storage | N/A | The software stores no passwords. Coordinators authenticate through Cloudflare Access (SSO/one-time code); volunteers use 256-bit capability tokens stored only as SHA-256 hashes. |
| crypto_random | Met | All keys, IVs, tokens and codes come from `crypto.getRandomValues`, with rejection sampling to avoid bias. Property-tested, including a chi-square bias test: test/property.test.ts |
| delivery_mitm | Met | Code delivered over HTTPS/SSH from GitHub; the app is served over HTTPS with HSTS. |
| delivery_unsigned | Met | No hashes are fetched over HTTP; npm registry signatures and attestations are verified in CI (`npm audit signatures`). |
| vulnerabilities_fixed_60_days, vulnerabilities_critical_fixed | Met | `npm audit`: 0 vulnerabilities; the deployed Worker has zero runtime dependencies; Dependabot security updates on. |
| no_leaked_credentials | Met | No credentials in the repository or its history (history scanned before publication); secret scanning with push protection is enabled. |

## Analysis

| Criterion | Answer | Justification |
|---|---|---|
| static_analysis | Met | CodeQL on every push and PR and weekly: R/blob/main/.github/workflows/codeql.yml |
| static_analysis_common_vulnerabilities | Met | CodeQL `security-extended` query suite. |
| static_analysis_fixed | Met | CodeQL alerts of High or above block merges via the `main` ruleset. |
| static_analysis_often | Met | On every commit and pull request. |
| dynamic_analysis | Met | Property-based testing with fast-check (1,000 generated cases per property in CI) and end-to-end tests against the real Workers runtime before every release. |
| dynamic_analysis_unsafe | N/A | No memory-unsafe languages (TypeScript/JavaScript only). |
| dynamic_analysis_enable_assertions | Met | Test runs use Node's strict assertion mode and fast-check property assertions; production code carries no test assertions. |
| dynamic_analysis_fixed | Met | Defects found by dynamic analysis are fixed promptly, e.g. the randomString chunking bug found and fixed in v1.1.2. |
