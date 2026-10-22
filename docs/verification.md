# Live-only verification record

This report covers the live-only conversion requested on September 13, 2026.
Earlier demonstration-mode test counts, screenshots and build claims do not
verify the current application and have been removed from this report.

## Acceptance checks

Type checking, lint, all 879 tests and the production-dependency audit passed
after the encoded-page-permalink fix on September 13, 2026 at 16:11:10
Europe/London. The final production build, live-source smoke check and direct
page-permalink browser check subsequently passed. These results cover the
live-only conversion and replace the earlier demonstration-mode verification.

| Check | Result for this conversion |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed: 879 tests across 14 files |
| `npm audit --omit=dev` | No reported production-dependency vulnerabilities |
| `npm run build` | Passed after the page-permalink fix, including standalone asset preparation |
| Default live HTTP response and provider health | `verify:live` passed against the rebuilt production server on port 4011 |
| No demonstration API mode or synthetic runtime events | Default response was live-only; removed mode returned `400`, retired event returned `410`, conflict catalog was empty |
| Unassessed scores and unknown coordinates preserved | Original source links, null confidence, unassessed news impact, missing news coordinates and non-future timestamps checked |
| Real browser map, report list, provenance and stale states | Passed the scoped desktop, mobile dark/light and legacy-state checks below |
| Encoded direct page permalinks | Regression tests and final production browser check passed; canonical event ID decoded once and source details opened |
| Migration `0002_live_only.sql` | Passed 54 isolated integration checks on PostgreSQL 17.5 / PostGIS 3.5.2 |
| Compose configuration | Syntax and default feed variables verified for both app and worker; no services started |

Provider counts and feed success are point-in-time observations, not fixed
product guarantees. A reachable feed does not independently verify its claims
or establish that its publisher is unbiased.

Tests may use synthetic fixtures, but production imports and APIs must not.

## Production live-source check

At `2026-09-13T15:13:21.332Z` (September 13, 2026, UTC), `verify:live` passed
against the final rebuilt production server at `http://127.0.0.1:4011`. It
returned 606 source records, including 81 classified as news or analysis:

| Provider | Status | Records |
| --- | --- | --- |
| USGS | Healthy | 74 |
| GDACS | Healthy | 451 |
| BBC World | Healthy | 24 |
| DW World | Healthy | 12 |
| UN News | Healthy | 30 |
| Global Voices | Healthy | 15 |

Optional ReliefWeb, GDELT, France 24 and Al Jazeera adapters were disabled.
Counts describe normalized source records, not independently verified distinct
incidents or comprehensive world coverage.

The smoke check confirmed original source links, no synthetic events, no
invented confidence values, unknown news impact left unassessed, and no future
report timestamps. The removed demonstration mode returned `400`; a retired
scenario identifier returned `410`; `/api/conflicts` returned an empty catalog
rather than invented conflict context.

The final smoke check also passed for percent-encoded event API links. The
separate page-permalink path was verified in the production browser after the
decoding fix.

A repeat scan of the final compiled `.next/static` and `.next/server/app`
bundles found none of these retired scenario markers:

```text
demo-kharkiv-response
Fictional demonstration data
DEMO_REFERENCE_TIME
demo-gaza
```

## Browser verification

The production desktop check at 1512 × 982 confirmed the working world map,
live feed and unassessed news records. A legacy URL normalized to the current
map state (latitude 20, longitude 0, zoom 1.02). The selected 24-hour view showed
335 reports from the then-current 606-record source snapshot; those are
different filter scopes, not inconsistent totals.

News overview and provenance checks through normal map selection confirmed the
original BBC report link, publisher homepage, separate publication/observation
timestamps, no invented coordinates and null assessments. These views were then
checked again on the final build by opening a percent-encoded direct event page
link. The report opened correctly, its URL retained a single encoded separator,
and its overview explicitly stated that Atlas had not independently verified
the report. The news overview/provenance screenshots below were recaptured from
that final-build direct-link check.

Final HTTP checks returned `404` for retired event pages using both literal and
percent-encoded scenario identifiers, a double-encoded invalid event identifier,
and a retired conflict page. These page responses are distinct from the API's
intentional `410` response for recognized removed event records.

Real browser checks at 390 × 844 covered:

- Fresh and legacy-state loads fitting the world map, with zoom approximately
  `-0.49`; obsolete URL state was cleared and the removed legacy page returned
  `404`.
- Actual news report provenance, null assessment values, and missing coordinates
  remaining missing.
- Contained focus in the source view and inert covered backgrounds.
- Dark and light views without horizontal overflow.
- Stale source timestamps remaining unchanged instead of being relabeled as a
  new successful fetch.
- Corrected UTC timestamp labels without duplicated timezone text.

The scoped dark/light axe checks reported no definite WCAG A/AA violations.
This is not a complete accessibility certification or a claim that every
browser, viewport and interaction was tested.

Screenshots are saved under `output/playwright/`:

- `live-production-desktop.png`
- `live-production-news-overview.png`
- `live-production-news-provenance.png`
- `live-mobile-world-fit-light.png`
- `live-mobile-legacy-normalized.png`
- `live-mobile-detail-dark.png`
- `live-mobile-detail-light.png`
- `live-mobile-provider-status-light.png`

## Database upgrade verification

The actual migration runner was exercised against a disposable PostGIS
container, not an existing user database. Checks covered null assessments,
numeric bounds, boolean/string/nested demonstration flags, mixed-record cleanup,
valid new live writes, transaction rollback after a late failure, unchanged
reruns, and migration-ledger checksum protection.

The mixed-data test cleared three disposable snapshots and removed only the
explicitly flagged synthetic events, versions, raw records and relationships.
It preserved genuine records, country/source registries, user watchlists and
alert rules, including a user-owned bookmark to a removed event. Keeping a
user-owned bookmark does not make that removed event available through the API.

Migration `0001_core.sql` was unchanged. Tested `0002_live_only.sql` SHA-256:

```text
f07e72e706147da478c33800fdedb846a63389abae3192d85c01ea23955ac09c
```

The temporary verification container was removed. Existing `.env` files,
databases and services were not changed by these database checks.

## Delivery boundary

Local implementation and tests are distinct from hosting, source-usage
permissions, continuous operations and editorial review. This conversion does
not by itself deploy a hosted service or apply migrations to an existing user
database.

See [operations](operations.md), [source usage notes](architecture.md#sources-and-usage)
and [remaining scope](roadmap.md).
