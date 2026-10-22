# Scope and roadmap

The product specification describes a long-term intelligence platform. This
build delivers a functioning map-first MVP and a foundation for later phases.
It does not represent every specification example as an implemented service.

## What is implemented

| Area | Current implementation | Important boundary |
| --- | --- | --- |
| Map | MapLibre, event layers/clusters, selection, geographic context, dark/light UI; bundled geometry and glyphs | WebGL is required; reference geography is world-scale, not street-level or authoritative boundary data |
| Live-only ingestion | USGS/GDACS hazard records and configured international news feeds; optional additional adapters | No fictional fallback, seeded reports or demo mode; source availability and coverage can be incomplete |
| Provenance | Source URLs, publisher metadata, timestamp basis, health, location evidence and uncertainty | Publisher inclusion is not independent verification; editorial-origin diversity does not guarantee neutrality |
| Geography | Map only provider-supplied coordinates; keep unlocated articles accessible in the feed | A publisher's home country and a country-label anchor are not incident coordinates |
| Discovery | Search, filters, timeline and country/event views | Country activity depends on explicit location metadata; source-backed conflict assessments are not yet configured |
| Realtime UI | Cached provider polling plus bounded SSE snapshots | No provider push guarantee, delivery log, replay cursor or distributed fan-out |
| Playback | Cutoff filtering of the current snapshot | Cannot reconstruct historical revisions or past editorial state |
| Preferences | Browser-local watchlists, alert rules and display preferences | No account sync or authenticated server storage |
| Notifications | Explicit-permission browser notifications while the live app is open | No background push, email, SMS, Slack or webhook service |
| Assessment | Null unassessed scores, disclosed hazard-severity derivation, source-record counts | No automated confidence rating, country risk score or inference that no reports means safety |
| Persistence | Optional provider snapshots and latest raw record per provider ID in PostgreSQL | Not an immutable source archive or complete normalized event history |
| Operations | Docker web runtime, worker/migration commands, health metadata and checks | Public hosting, TLS, rate limiting, monitoring and backups remain operator work |

## Included foundations, not active services

- Normalized PostGIS event/source tables and bounding-box/radius query examples.
  Current API filtering still operates on snapshots, not those normalized tables.
- Tables for raw-ingestion history, event versions, conflicts, server watchlists
  and alert rules. The current adapter does not automatically populate them.
- An optional Redis Compose profile. No Redis cache adapter, BullMQ queue,
  distributed locking, or pub/sub is implemented.

## Next production increments

1. **Durable, auditable ingestion.** Materialize normalized events, preserve every
   source revision with an explicit retention policy, record changes and
   evidence, build tested reprocessing and retractions, and query PostGIS from
   the API.
2. **Coverage and source governance.** Review and approve provider usage for the
   actual deployment, add multilingual and geographically diverse sources,
   measure coverage gaps and shared reporting, and document attribution and
   source-specific handling. The default English-language selection is not
   representative of all countries, viewpoints or local reporting.
3. **Editorial workflows.** Authenticated reviewer roles, merge/reject/correct
   actions, provenance-preserving revisions, dispute handling and an immutable
   audit trail. Do not automatically turn high heuristic scores into “verified.”
4. **Accounts and reliable notifications.** Authentication, account ownership,
   protected server preferences, notification deduplication, background
   delivery, unsubscribe controls and explicit channel integrations.
5. **Scale and reliability.** Distributed fetch scheduling and rate limits,
   separate ingestion workers, shared stream fan-out, observability, backup
   restoration and load testing. Review tile-service arrangements only if
   adding external detailed or imagery basemaps.
6. **Measured intelligence.** Add source-backed conflict assessments and evaluate
   source correlation, entity extraction, geolocation, and any model-assisted
   summaries against labeled examples. None may fabricate article text,
   coordinates, certainty or conflict membership. Historical playback needs
   immutable versions; escalation models need transparent inputs, calibration,
   uncertainty and review.

Proprietary news integrations, satellite imagery, flight/vessel tracking,
commercial API access, monetization and any sensitive tactical dataset require
separate product, legal, privacy and safety decisions. They are not bundled into
the default local experience.
