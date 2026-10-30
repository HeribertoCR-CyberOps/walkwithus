# Availability: targets, math, and how they are measured

## What "99.99%" means, precisely
| Target | Allowed downtime / 30-day month | / year |
|---|---|---|
| 99.9% | 43.2 min | 8.8 h |
| **99.99%** | **4.32 min** | **52.6 min** |
| 99.999% | 26 s | 5.3 min |

An availability number is only honest if it is (a) defined per function, (b) measured from outside, and (c) backed by an architecture that can plausibly meet it. Cloudflare publishes no uptime SLA for Workers or D1 below the Enterprise plan, so no one can *guarantee* 99.99% on Free or Paid. What this design does is remove dependencies from the functions that matter most, then measure.

## Per-function design targets

| Function | What it depends on | Design target | Why it can hold |
|---|---|---|---|
| **Emergency actions** (911 / Crime Stoppers / 988) | The phone's dialer. After first visit, the app shell is cached by the service worker. | **≥ 99.99%** (effectively the phone's availability) | `tel:` links are in the cached shell and on the 404 page; they work offline and with our servers down. |
| **See the schedule** | Edge + Worker; D1 only for freshness | **99.99%** | Edge cache serves the schedule for 60 s fresh and **up to 24 h stale if D1 fails** (`stale-if-error`); the service worker keeps the last copy for offline view. |
| **Send a walk request / volunteer application** | Edge + Worker + D1 (write) | **99.9%**, measured | Writes need the database. On failure the page tells the family to call the organization directly (its published number). |
| **Coordinator dashboard** | Edge + Access + Worker + D1 | **99.9%**, measured | Same dependency chain plus identity. |

Serial dependencies multiply: A = A_edge × A_access × A_worker × A_d1. Removing D1 from the read path is what lets the schedule exceed the write path.

## Known risk that must be closed before launch
Since **2026-09-01**, D1 on the Workers **Free** plan *fails queries* once the daily row-read or row-write limit is reached, until midnight UTC. Caching reduces reads sharply, but a busy day or abuse could still hit the write ceiling. **Production should run on Workers Paid ($5/month account minimum)**; the Free plan is fine for pilots.

## Measurement
`scripts/monitor.mjs` probes liveness, readiness (DB, keys, maintenance recency, audit-chain integrity), the app shell (including CSP and the 911 link), the 404 page and an org schedule.
- **Primary:** every 60 s from independent infrastructure (e.g. a systemd timer writing `walkwithus_probe_up` / `walkwithus_availability_30d` to a node-exporter textfile, alerting in Grafana). 43,200 probes/month give 1-minute resolution — about 0.0023% per failed probe, fine enough to see a 4.32-minute budget.
- **Secondary:** GitHub Actions every 5 minutes (best effort; schedules can lag).
- **Error budget policy:** if the 30-day window drops below target, freeze feature changes and fix the cause first.

## Self-healing (what repairs itself, and what is reported)
| Mechanism | Heals | Visible in |
|---|---|---|
| Edge cache stale-if-error | Database outage on the read path | `x-cache: stale` header; family page shows "showing the last saved schedule" |
| Retry with backoff (idempotent reads only) | Transient D1 network/reset errors | logs (`retry`) |
| Hourly maintenance, each step isolated | Forgotten check-outs, expired data, aggregates | `/api/health/ready` → `checks.purge` |
| Audit-chain verification hourly | Detects tampering (cannot repair by design — it alerts) | `checks.audit_verify`; readiness goes red |
| Key-rotation re-sealing | Moves every encrypted field to the new key in the background | `checks.rekey`, `rotation_in_progress` |
| Fork-proof audit writes | Concurrent writers retry instead of corrupting the chain | — |
| Service-worker shell | Network loss on the family's phone | offline banner in every language |

Deliberately **not** self-healing: anything that would bypass the Rule of Two, retry a non-idempotent write (risk of duplicate requests), or "repair" the audit log.
