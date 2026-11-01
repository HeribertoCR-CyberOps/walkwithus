# Measuring outcomes

This guide is for a program, a funder or a researcher who wants to know: **near the corners our adults covered, did reported incidents during school-travel hours change, compared with similar corners we did not cover?**

It uses two things only:
- the app's **anonymous coverage export** (adult-minutes and completed walks per corner per day, no people in it), and
- **public NYC Open Data**: NYPD complaints.

No device scanning, no cameras, no data about any child or volunteer. Anyone can re-run it and should get the same numbers from the same data (the report records hashes so that can be checked).

> **Read this before quoting a result.** The method measures an *association*. It does not prove the program caused a change. Reported complaints are not all crime. Having adults on a corner can itself change how often things are reported.

## 1. Fix the study design before looking at any outcome

Write `study.json` (copy `docs/outcomes-example.json`), date it, and share it with your partner or funder **before** running anything. Choosing corners, controls or hours after seeing the results makes the numbers meaningless.

| Field | What to decide |
|---|---|
| `treated` | The program's corners: `[{ id, label, lat, lon }]`, or `"coverage"` to take every corner with adult time from the export |
| `controls` | At least 3 corners the program does **not** cover and will not cover during the study. Similar to the treated ones: same kind of street, similar school nearby, similar incident level before. At least **2 × radius** away from every treated corner (the report warns otherwise) |
| `pre`, `post` | Date ranges before and after the program started. Leave a gap for the start-up weeks. At least 20 school days in each |
| `windows` | School-travel hours, e.g. 07:00–09:00 and 14:00–16:30 |
| `weekdays`, `exclude_dates` | School days: Monday–Friday by default, minus holidays and breaks from the school calendar |
| `radius_m` | Buffer around each corner, 25–1000 m (default 150). `sensitivity_radii_m` adds checks (default 100 and 250) |
| `law_categories` | `FELONY`, `MISDEMEANOR`, `VIOLATION` (default: all three) |
| `bootstrap_reps`, `seed` | Default 2000 and a fixed seed, so the interval is reproducible |

## 2. Export coverage (program admin)

Signed in to the coordinator page as an **admin**, open:

```
/api/c/<your-program>/coverage?from=2025-09-01&to=2026-06-30
```

and save the response as `coverage.json`. What it contains:

- **Fields:** one row per corner per day: `day, corner_id, label, lat, lon, adult_minutes, walks_done`. Nothing else exists in the table it reads. Names, phone numbers, walk requests and individual shifts are deleted after 72 hours. Only these totals survive.
- **Small cells:** a day with 1 or 2 completed walks at a corner shows `walks_done: null` with `walks_done_suppressed: true`, so one family's walk cannot be picked out of a shared report.
- **Days:** days are **UTC calendar dates** (the hourly purge groups by UTC). An evening shift in New York can therefore land on the next day. That does not matter for a school-hours study.
- **Limits:** coordinators cannot export (`403 admin_only`). At most 731 days per export. Each export is written to the audit log (`coverage_exported`, with the date range and row count).

## 3. Run

```sh
node scripts/outcomes.mjs --config study.json --out outcomes-report [--coverage coverage.json]
```

The script uses Node 20 or newer and needs no packages and no account. Setting `SOCRATA_APP_TOKEN` raises NYC Open Data's rate limit. The token is only ever sent as a header and is never written to the report.

The run writes two files:
- `report.md`: the result, the checks, a table per corner and the data provenance.
- `report.json`: everything, including the per-corner data hashes.

The exit code is `0` when there is an estimate, `2` when the data is insufficient, and `1` on an error.

## 4. Method

For each corner *i* and period *p*, count incidents that pass all of these:
- within the radius (great-circle distance to the complaint's coordinates),
- on a school day of the period,
- starting inside a window,
- in a selected law category.

The rate is

  r<sub>i,p</sub> = 100 · n<sub>i,p</sub> / D<sub>p</sub>  (incidents per 100 school days; D<sub>p</sub> = school days in the period)

The **difference-in-differences** estimate is

  DiD = mean<sub>treated</sub>(r<sub>post</sub> − r<sub>pre</sub>) − mean<sub>control</sub>(r<sub>post</sub> − r<sub>pre</sub>)

A negative value means incidents fell more, or rose less, near covered corners than near the controls.

Checks applied:

| Check | How | What the report says |
|---|---|---|
| Uncertainty | Corner-level bootstrap: treated and control corners resampled separately with replacement, 95 % percentile interval, seeded PRNG | Interval includes 0 → `NO_DETECTABLE_CHANGE` |
| Pre-existing trends | **Placebo**: the same estimate with a fake start halfway through the pre period | If its interval excludes 0 → `NOT_INTERPRETABLE` |
| Buffer choice | Estimate at every sensitivity radius | Warning if the sign changes |
| Spillover | Any treated–control pair closer than 2 × radius | Warning (biases toward zero) |
| Data freshness | Latest complaint date in each dataset | The post period is **cut** to the data's end, with a warning. Days without data would otherwise count as zero incidents |
| Sample size | Fewer than 3 treated or 3 control corners, or fewer than 20 school days in a period | `INSUFFICIENT_DATA`, no estimate |
| Low counts | Fewer than 20 pre-period incidents in total | Warning |
| Bad coordinates | Corners with no incidents in either period (a park, the water) | Warning |

The design follows the evaluation of Chicago's Safe Passage program by McMillen, Sarmiento-Barbieri & Singh: *Do more eyes on the street reduce crime? Evidence from Chicago's Safe Passage Program*, Journal of Urban Economics 110 (2019) 1–25. That program staffed routes with paid workers at scale, so its results do not transfer to a volunteer program by default.

## 5. Data

| Dataset | ID | Covers |
|---|---|---|
| NYPD Complaint Data Historic | `qgea-i56i` | 2006 to the end of the last full year |
| NYPD Complaint Data Current (Year To Date) | `5uac-w243` | The current year, published with a lag of months (on 2026-11-01 it ended at 2026-06-30) |

- **Fields requested:** only `cmplnt_num`, `cmplnt_fr_dt`, `cmplnt_fr_tm`, `law_cat_cd`, `latitude` and `longitude`. The script refuses to request any other field, and fails if a response contains one. Suspect and victim demographics are **never** requested, stored or reported.
- **Date and time:** `cmplnt_fr_dt` and `cmplnt_fr_tm` are when the incident happened (or started), not when it was reported. Both are New York local time.
- **Location:** coordinates are **midblock**, per the dataset's own description, not the exact spot. A small radius can therefore miss incidents at the intersection itself. This is one reason for the sensitivity radii.
- **Bad rows:** the data contains impossible dates (years such as 1010 and 1016), and rows without a time or a location. These are counted under "Rejected" and not used. A complaint present in both datasets is counted once.
- **Revisions:** the city revises past records and recent months fill in late. A re-run on a later day can differ. Compare `all_sha256` and the per-corner hashes to see whether the input changed.

## 6. Limitations

- **Regression to the mean.** Programs start at corners that just had a bad stretch, and those often improve on their own. The controls and the placebo check reduce this effect but do not remove it.
- **Displacement.** Incidents can move a block away, outside the radius.
- **Reporting effects.** Adults present may report more, or deter reporting.
- **Small programs.** A handful of corners gives wide intervals. "No detectable change" is the honest result for most small programs in their first year, and it does not mean no effect.
- **Not about children.** This measures incidents near corners. It says nothing about any individual child's safety.

## Example (pipeline check, not a program)

`docs/outcomes-example.json` uses six arbitrary Bronx points; no Walk With Us program runs at them. A live run on 2026-11-01:
- **Data:** historic data through 2025-12-31 (rows updated 2026-04-28); year-to-date data through 2026-06-30 (rows updated 2026-07-27). 2,697 complaints fetched within 250 m. Record hash `f51bd8fd…ac4c`, identical on a second run.
- **Result:** `NO_DETECTABLE_CHANGE`, with a placebo pass.
- **Warnings, as designed:** the estimate changed sign across radii, and two points (inside a park and the zoo) had no incidents in school hours.

Use the example to check your setup, never as a finding.
