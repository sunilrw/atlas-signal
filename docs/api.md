# Read API

The MVP exposes same-origin, read-only endpoints, not a versioned commercial API.
All timestamps are ISO strings. Source publication time, event update time,
snapshot reference time and last provider fetch time are distinct.

Data endpoints use live provider records. Where a route accepts `mode`, omit it
or supply `mode=live` for compatibility. Other values, including the removed
demonstration mode, return `400`; there is no API path that serves fictional
events. The health endpoint reports service status, not event data.

## Endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /api/events` | Filtered normalized event snapshot |
| `GET /api/events/:id` | One event and its provenance |
| `GET /api/countries/:country` | Supported country context and available events |
| `GET /api/conflicts` | Empty catalog with an explicit source-backed-assessment-unavailable notice |
| `GET /api/conflicts/:id` | `404` until an attributed conflict assessment is configured |
| `GET /api/search?q=…` | Search available report and country information |
| `GET /api/risk` | Legacy route returning observed source-record counts only; no risk score |
| `GET /api/timeline` | Timeline from the currently available snapshot |
| `GET /api/sources` | Provider status and last-success metadata |
| `GET /api/health` | Service health |
| `GET /api/stream` | SSE snapshots |

There are no public POST/PUT/PATCH/DELETE operations, administration endpoints,
user account endpoints, remote alert delivery, or user-configured upstream
fetch targets.

Invalid filter values or repeated supported parameters return `400`; unknown
event/country/conflict identifiers return `404`. Recognized retired
demonstration event identifiers return `410`. Unexpected service failures
return `503` with a safe message. A provider outage can still produce a `200`
response with other feeds, cached data or an empty list: inspect source health
and warnings, not HTTP status alone.

## Event filters

| Parameter | Accepted value |
| --- | --- |
| `mode` | Optional; only `live` is accepted |
| `q` | Search text |
| `category` | Comma-separated category IDs from `EventCategory` |
| `severity` | Minimum severity, integer 1–7 |
| `confidence` | Minimum confidence, 0–100 |
| `since` | `1h`, `6h`, `24h`, `7d`, or `30d` |
| `region` | Region identifier used by the application catalog |
| `west`, `south`, `east`, `north` | Four finite geographic bounds, supplied together |

Longitude bounds are within −180 to 180; latitude bounds are within −90 to 90.
South must not exceed north. West greater than east denotes crossing the
antimeridian. Reports without coordinates do not match a geographic filter;
they can still appear in an unbounded list or search.

Default thresholds (`severity=1`, `confidence=0`) include unassessed records.
Higher thresholds require an actual non-null value. Ingestion does not assign
confidence scores, so a positive confidence threshold can legitimately return
no records. Missing assessment is not evidence of low confidence or low impact.

## Events envelope

The exact TypeScript contract is `EventsResponse` in `src/types/index.ts`:

```ts
{
  events: AtlasEvent[];
  mode: "live";
  referenceTime: string;
  updatedAt: string | null;
  sources: FeedHealth[];
  total: number;
  warnings: string[];
}
```

`AtlasEvent.isDemo` is a legacy compatibility field and is always `false`.
`FeedHealth.status` is `healthy`, `degraded`, `disabled`, or `error`. Its
`lastFetchedAt` is nullable when the provider has not successfully fetched.
Check `warnings` even after a successful HTTP response: a valid response can
contain usable stale data and an unavailable provider.

`updatedAt` is the latest successful provider fetch represented in the envelope,
not the current clock or a new story's publication time. It is `null` when no
provider has successfully fetched. `referenceTime` is the current snapshot
filtering clock; its changing does not establish fresh source data. Inspect each
provider's `lastFetchedAt` and status, not the aggregate timestamp alone.

`AtlasEvent.severity` and `AtlasEvent.confidence` are nullable. News severity is
unassessed, and all automated source confidence values remain `null`. A
non-null hazard severity includes `severityReason`; it is a disclosed
transformation of a provider measurement or alert level, not measured casualties
or independent verification. `verificationNote` states remaining limits.

Sources retain the publisher URL and name, with available `providerId`,
`publisherCountry`, `language`, `byline`, `publisherUrl`, `licenseUrl`,
`observedAt` and `timestampBasis`. Preserve license and attribution links
alongside any displayed excerpt.

Publisher country describes editorial provenance only. `published`, `occurred`
and `observed` timestamp bases distinguish publication, incident time and first
detection; a discovery time is not invented publication time. `reportKind` can
distinguish incident records, news and analysis. Preserve these distinctions when
building another client.

## Streaming

```js
function subscribeToEvents(renderSnapshot, showConnectionWarning) {
  const stream = new EventSource("/api/stream");

  stream.addEventListener("events", (message) => {
    const snapshot = JSON.parse(message.data);
    // Replace/update the snapshot and show provider health.
    // A record in a snapshot is not necessarily a newly occurring event.
    renderSnapshot(snapshot);
  });

  stream.onerror = () => showConnectionWarning();
  return () => stream.close();
}

// Keep and call this cleanup when the view unmounts.
const unsubscribe = subscribeToEvents(renderSnapshot, showConnectionWarning);
```

Call `unsubscribe()` on unmount, not immediately after creating a connection.
Native `EventSource` reconnects after the server's 55-second connection closes,
using a 3-second retry delay. Heartbeats arrive every 20 seconds between snapshots.
No replay cursor, immutable message log, or exactly-once delivery contract is
provided.

The JSON and SSE endpoints share the same provider cache. Opening another
connection does not guarantee a new upstream fetch or a new observation.
