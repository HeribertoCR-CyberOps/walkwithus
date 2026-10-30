# Security

## Reporting
Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) or by email to the maintainers listed in the repository. Do not open public issues for security problems. We acknowledge within 48 hours.

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
