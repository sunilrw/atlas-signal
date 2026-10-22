# Architecture

Atlas Signal is one modular Next.js application. The map is the primary
interface; provider adapters, normalization, caching and read APIs remain on the
server. Shared contracts live in `src/types/index.ts`.

## Data flow

```text
Fixed public provider endpoints
              |
              v
Provider adapters -> raw records -> normalization and conservative deduplication
              |                                  |
              v                                  v
       provider health                    normalized snapshots
                                                  |
                         +------------------------+-------------------+
                         |                                            |
                  in-process cache                    optional PostgreSQL
                         |                          provider snapshots + raw
                         +------------------------+-------------------+
                                                  |
                                        JSON API + SSE stream
                                                  |
                                   MapLibre / feed / detail views
```

No browser request can choose an upstream URL. Provider endpoints are configured
in code; optional feeds are enabled through operator-owned environment
variables. Provider failures remain failures or explicitly stale cached data.
There is no demonstration path, seeded event catalog, fictional source
relationship, or sample-data fallback. Synthetic fixtures are test-only.

## Contracts and geography

`AtlasEvent` carries its own ID, source links, source publication times, first
report and latest update, category, status, severity, confidence, geographic
precision and assessment provenance. The legacy `isDemo` compatibility field
must be `false`; both source and event flags are checked before a record enters
an application response. API timestamps are ISO strings.

Coordinates are optional. Records without known coordinates remain list/search
items and do not acquire a guessed point on the map. A publisher's home country,
a named place in a headline and a catalog centroid are not incident coordinates.
Use explicit provider geography and retain its precision/evidence. News may
describe several places or a general topic rather than one incident. Latitude
and longitude are validated; GeoJSON points are `[longitude, latitude]`.

Publisher publication/update times, incident occurrence times and aggregator
observation times are different. `timestampBasis`, `observedAt` and `detectedAt`
preserve that distinction where available. A fetch timestamp is never substituted
for a missing original publication time without a visible observation label.
Provider titles are preserved after safe plain-text extraction; no model invents
headlines, summaries or developments.

The map uses GeoJSON/WebGL layers and clustering rather than one React DOM node
per marker. The API accepts bounded geographic queries. In the current adapter,
these queries filter the cached snapshot in application code; the optional
normalized PostGIS tables and indexed query examples provide a future database
query path, not the current read path.

## Three separate trust boundaries

1. **Source record versus invention.** Every runtime report must originate from
   a configured provider response and retain its source URL. Removed scenario
   URLs do not resolve to replacement fictional events. Outages, missing fields
   and empty coverage remain visible instead of being filled with plausible text.
2. **Observation versus verification.** Reachability, publisher inclusion and
   repeated reporting do not independently verify a claim. A varied publisher
   selection reduces reliance on one newsroom but cannot guarantee neutrality,
   accuracy or independent corroboration. Provider review status concerns that
   provider's own process, not an Atlas editorial review.
3. **Observation versus analysis.** Disclosed hazard-severity transformations and
   source-record counts organize the available data. They are not forecasts,
   country safety rankings, authoritative travel advice, emergency instructions,
   or evidence that an escalation will happen.

The product does not use a paid model or an LLM to invent article summaries.
Conservative normalization and the available source evidence determine the
displayed record. Uncertainty, precision limitations and contradictory reports
must remain visible.

## Processing and scores

Conservative duplicate handling must preserve source identity and links.
Geographic proximity, matching keywords or multiple publishers repeating one
story are not evidence of independent confirmation. There are no
distance-generated conflict memberships or invented relationships.

All automated confidence values are `null`. News and humanitarian-report
severity are also `null`, not a fixed default suggesting assessed impact.
USGS magnitude and GDACS alert level can produce a derived hazard severity, but
the event must include `severityReason`. The number does not assert observed
casualties, damage or a verified escalation. Unknown/missing hazard values remain
unassessed. Default filters include null assessments; a stricter threshold
requires a non-null value.

The legacy `/api/risk` route returns source-record counts and explicit
limitations only, with no numerical risk score or country risk level. These are
not independently verified incident totals. There is no fabricated risk overlay.
Conflict endpoints return an empty catalog and an explanatory notice until an
attributed assessment source exists. Sparse coverage never means low
real-world risk.

## Sources and usage

Sources are a selected set, not complete global coverage. The default news
subset is English-language and includes different editorial origins; it does
not establish balanced representation of every region, language or viewpoint.
Publisher country is displayed only as source provenance.

The links below are official documentation for operator review, not a license
grant or a legal determination. Public feed access does not automatically grant
public/commercial redistribution rights. Use headline-and-link discovery where
required, retain publisher/byline/attribution, and follow source-specific
restrictions. Do not fetch and republish full linked articles or images. Review
current terms for the intended deployment, particularly before public hosting.

| Source | Default | Purpose and boundary | Official reference |
| --- | --- | --- | --- |
| USGS | Enabled | M4.5+ weekly earthquake feed; retain attribution and original event URLs. Non-earthquake seismic records are not relabeled as earthquakes. | [GeoJSON feed documentation](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), [copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) |
| GDACS | Enabled | Disaster alerts. Preserve GDACS attribution and per-record acknowledgements. Modeled alerts retain uncertainty and do not replace local authorities. | [Feed reference](https://www.gdacs.org/feed_reference.aspx), [terms of use](https://www.gdacs.org/About/termofuse.aspx) |
| BBC World | Enabled for local use | Publisher-attributed RSS discovery. Review business-use permission and metadata conditions before reuse beyond the local reader. | [BBC terms, section 15](https://www.bbc.co.uk/usingthebbc/terms-of-use/#15metadataandrssfeeds) |
| DW World | Enabled | Headline and original article link only; the adapter does not redistribute feed descriptions or images. Follow attribution and use conditions. | [DW general terms](https://corporate.dw.com/en/general-terms-and-conditions-for-the-use-of-dw-world/a-326547) |
| UN News | Enabled for local use | United Nations reporting, not independent confirmation of all quoted parties' claims. Keep source links and review reuse conditions. | [UN terms of use](https://www.un.org/en/about-us/terms-of-use) |
| Global Voices | Enabled | Preserve author, original link and the applicable attribution/license notice. Third-party material can have separate conditions. | [Attribution policy](https://globalvoices.org/about/global-voices-attribution-policy/) |
| ReliefWeb | Disabled until configured | Humanitarian reports. An approved `appname` has been required since November 1, 2025. API access does not grant blanket rights to redistribute original-source reports. | [API documentation and terms](https://apidoc.reliefweb.int/), [appname parameter](https://apidoc.reliefweb.int/parameters#appname) |
| GDELT | Opt-in | News discovery. Attribute GDELT and retain publisher links. GDELT dataset permissions do not imply permission to republish linked articles. | [GDELT terms](https://www.gdeltproject.org/about.html#termsofuse) |
| France 24 | Opt-in | Enable only after reviewing private/public-use and republication restrictions for the intended deployment. | [France Medias Monde legal notice](https://www.francemm.com/en/legal-notice) |
| Al Jazeera English | Opt-in | Automated access and redistribution need a source-usage review; enabling an environment variable is not permission. | [Al Jazeera terms](https://www.aljazeera.com/terms-and-conditions) |

Adapters retain HTTP(S) source URLs and use source IDs to preserve provenance.
Source availability is not a claim that a publisher is infallible or unbiased.
No direct Reuters/AP subscription, ACLED, proprietary satellite, AIS, ADS-B, or
paid news access is bundled or implied.

The default map geometry, label anchors and Noto Sans glyph subset are bundled
under `public/data`; they do not call a third-party tile service. Natural Earth
attribution remains visible. See [asset attribution](../public/data/ATTRIBUTION.md),
the [Natural Earth notice](../public/data/NATURAL-EARTH-LICENSE.md), and the
[included font license](../public/data/fonts/Noto%20Sans%20Regular/LICENSE.md).
The UI's Inter variable font is also self-hosted; its original
[Inter font license](../public/data/fonts/INTER-LICENSE.txt) is bundled separately.
Country and city label anchors are reference cartography, never fallback
incident coordinates. The glyph subset covers Latin labels; full Unicode event
text remains available in DOM tooltips and details.

The bundled map is world-scale reference geometry, not a street map or
authoritative boundary/legal determination. If adding a detailed, satellite or
terrain tile service later, review its capacity, attribution and usage terms
before deployment.

## Runtime storage

Without `DATABASE_URL`, normalized snapshots and retained source records live
in bounded process memory. Restarts discard them. Multiple web instances do not
share memory.

When configured and migrated, PostgreSQL stores:

| Table | Current use |
| --- | --- |
| `atlas_ingestion_snapshots` | Last successful normalized snapshot per provider |
| `atlas_source_records` | Latest raw payload per provider record ID |
| `atlas_schema_migrations` | Applied migration filenames, checksums and timestamps |

`atlas_source_records` is an upserted latest-record store, not an immutable
archive of every source revision. Persistence errors produce operational
warnings; the local cache can remain usable. Database availability is not
represented as human validation of a record.

The first migration also creates a normalized foundation:

| Tables / columns | Intended role; not automatically materialized today |
| --- | --- |
| `events`, generated `geom`, search index | Normalized event payload and geographic/time/category queries |
| `sources`, `event_sources` | Provider registry and many-to-many provenance |
| `raw_ingestion`, `event_versions` | Append-only raw envelopes and explicit event audit history |
| `countries`, `conflicts`, `event_conflicts` | Geographic context and attributed analytical relationships |
| `user_watchlists`, `alert_rules` | Future authenticated server persistence |

Migration `0002_live_only.sql` invalidates legacy derived provider snapshots and
removes explicitly flagged fictional records, while preserving legitimate raw
source data and user-owned preferences. It adds false-only legacy `is_demo`
constraints and permits null severity/confidence. It must be applied after the
unchanged first migration.

The normalized schema enforces paired coordinates, legal ranges, live-only
flags, status/category values, HTTP(S) source URL prefixes, and valid non-null
severity/confidence ranges. The database URL checks are a defense-in-depth guard,
not a substitute for full application URL validation. Geography and
geometry-expression GiST indexes support radius and rectangular bounding-box
queries respectively. Query examples split boxes crossing the antimeridian.

No automatic audit trigger, role provisioning, row-level security, server
watchlist writes, or authenticated alert dispatcher is installed. Migrations
must precede enabling persistence.

## Updates and freshness

The server caches provider requests for at least 60 seconds and coalesces work
within a process. Source-specific minimums take precedence: BBC uses a
15-minute fetch interval. The optional ingestion worker defaults to 300 seconds
and accepts intervals from 60 to 86,400 seconds; it does not bypass a provider's
longer minimum.

Server-Sent Events carry complete, bounded snapshots. The stream uses named
`events` messages, 20-second heartbeat comments, and a 55-second connection
lifetime; native `EventSource` reconnection opens the next connection after the
3-second retry delay. The route checks the cache every 15 seconds and does not
use the reference clock alone as its change signal. `updatedAt` is a successful
provider fetch timestamp, not a fabricated current time; it is `null` before any
successful fetch. A provider outage retains its last successful time and
explicit stale/error state. Cached records older than the server's maximum
usable age of 24 hours since fetch are omitted rather than presented
indefinitely as live. This is an outage-retention limit, not a promise that the
source observations themselves are less than 24 hours old.

A connection being open does not mean a provider has published a new
observation. Per-provider fetch times, report timestamps, the filtering clock
and stale/degraded states are separate signals.

This is near-real-time polling plus SSE delivery, not a guaranteed push feed
from every source. Source update schedules, rate limits, network failures and
the cache interval all affect freshness.

## Local preferences and notifications

Watchlists, alert rules and display preferences are saved in the browser. They
are not linked to a server account and do not synchronize between devices.
Clearing browser storage clears them. Browser notification permission is
explicit; matching notifications can run only while the live application is
open. There is no background push service, email, Slack, webhook, billing or
authentication system.

Timeline playback filters the current snapshot by cutoff time. It does not
reconstruct source revisions or replay the event state that existed at a past
instant. Historical reconstruction requires durable versioned ingestion.

## Scope

See [the roadmap](roadmap.md) for the boundary between the functioning MVP,
optional infrastructure, and future editorial, account and intelligence
services. See [operations](operations.md) for deployment constraints.
