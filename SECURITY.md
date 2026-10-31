# Security

## Reporting
Report vulnerabilities privately: **[Security → Report a vulnerability](https://github.com/HeribertoCR-CyberOps/walkwithus/security/advisories/new)**. Do not open public issues for security problems or anything that exposes personal data.

| | Target |
|---|---|
| Acknowledgement | 48 hours |
| Triage and severity (CVSS 4.0) | 5 days |
| Fix for critical / high | 7 days, deployed to the reference instance first |
| Public advisory | After a fix is available, crediting the reporter unless they prefer otherwise |

## Supported versions
| Version | Supported |
|---|---|
| 1.1.x | ✅ security fixes |
| < 1.1 | ❌ upgrade |

## Supply chain
Zero runtime dependencies in the Worker. CI pins every GitHub Action to a commit SHA, runs CodeQL (security-extended), dependency review on pull requests, `npm audit signatures`, OpenSSF Scorecard, and publishes a CycloneDX SBOM per build. Dependabot updates npm and Actions weekly.

## Threat model (summary)
| Adversary | Goal | Defense |
|---|---|---|
| Person intending harm to a specific student | Learn when/where the student walks | The system never stores a child's identity or location; requests name only a public corner and a 15-minute slot; volunteers never receive family numbers; callback reveals are logged per coordinator. |
| Malicious or careless volunteer | Misuse access | In-person approval; capability link revocable instantly; volunteers see only meeting point + time; Rule of Two in the database. |
| Compromised coordinator account | Bulk export of contacts | Cloudflare Access (SSO, MFA by policy); each reveal is a separate, audited action; data volume bounded by 72 h retention (≈ λ·W rows). |
| Database leak | Read personal data | AES-256-GCM per field with row-bound AAD; key held only as a Worker secret. |
| Spam / flooding | Exhaust coordinators | Per-network and per-number rate limits with daily-salted keyed hashes; optional Turnstile. |
| Insider tampering with history | Hide an action | Append-only hash chain; UPDATE/DELETE blocked; `UNIQUE(prev)` prevents forks; monthly verification. |
| Third-party tracking | Profile families | No third-party requests at all; strict CSP; `Permissions-Policy` denies geolocation/camera/mic. |

## Out of scope
Physical safety of volunteers and students is the responsibility of the organization running the program. This software is not an emergency service.
