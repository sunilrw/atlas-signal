# Operations

## Supported starting point

Use Node.js 22.19 or newer, npm, and a long-running Node host. The app also has a standalone
Docker target. The local live-only reader needs no account, database, paid API
token, or subscription. It does need outbound server access to configured
provider feeds. The map geometry and glyphs are bundled local resources; no
fictional reporting is bundled for offline use.

This repository provides deployable source and Docker configuration; it does
not by itself imply a public deployment, production uptime, feed licensing
clearance, or editorial verification.

## Configuration

Copy `.env.example` to `.env.local` for local Next.js and CLI commands. The
ingestion and migration commands load `.env.local`, then `.env`, without
overriding exported process environment variables. Do not commit secrets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Unset | Optional PostgreSQL persistence. Run migrations before enabling. Use a server-only connection string. |
| `RELIEFWEB_APPNAME` | Unset | Approved ReliefWeb application name; blank disables its adapter. |
| `USGS_ENABLED` | `true` | Set exactly `false` to disable the default USGS feed. |
| `GDACS_ENABLED` | `true` | Set exactly `false` to disable the default GDACS feed. |
| `RSS_ENABLED` | `true` | Master RSS switch; exactly `false` disables all configured RSS news feeds. |
| `BBC_ENABLED` | `true` | Set exactly `false` to disable BBC World RSS. |
| `DW_ENABLED` | `true` | Set exactly `false` to disable DW World headline/link discovery. |
| `UN_NEWS_ENABLED` | `true` | Set exactly `false` to disable UN News. |
| `GLOBAL_VOICES_ENABLED` | `true` | Set exactly `false` to disable Global Voices. |
| `FRANCE24_ENABLED` | `false` | Explicit opt-in after reviewing source-usage permission. |
| `ALJAZEERA_ENABLED` | `false` | Explicit opt-in after reviewing automated-access and redistribution restrictions. |
| `GDELT_ENABLED` | `false` | Opt-in GDELT adapter when exactly `true`. |
| `INGEST_INTERVAL_SECONDS` | `300` | Worker cycle interval from 60 to 86,400 seconds. |
| `PORT` | `3000` | Export in the shell for the local server, or set in Compose's `.env` for its published host port. |
| `POSTGRES_PORT` | `5432` | Compose loopback host port for the optional database. |
| `POSTGRES_PASSWORD` | `atlas-local-only` | Compose database bootstrap password; replace outside local development. |
| `DOCKER_DATABASE_URL` | Unset for web | Database connection from a Compose container, using `db` as host. |

Upgrading an older local setup: its copied environment file may still contain
`RSS_ENABLED=false`. That value intentionally disables news ingestion even
though the new default enables it. Remove it or change it to `true` if news
feeds are wanted, then restart the application and any worker. Individual
source opt-outs continue to be respected.

The enabled news selection is an English-language subset with different
editorial origins, not a guarantee of neutral or complete reporting. Default
local access is not blanket public/commercial republication permission. Review
[each source's usage notes](architecture.md#sources-and-usage) before publishing
the application; disable any feed whose terms do not cover the deployment.

Compose reads `.env`, not `.env.local`. The example Docker connection is:

```dotenv
DOCKER_DATABASE_URL=postgresql://atlas:atlas-local-only@db:5432/atlas_signal
```

If the database password changes, update the connection string as well and
percent-encode reserved URI characters. Changing `POSTGRES_PASSWORD` does not
rotate an already-initialized database user's password; use an intentional
database password rotation and then update clients.

There are no arbitrary upstream URL settings, public provider-key inputs,
`INGESTION_TOKEN`, or implemented `REDIS_URL`. Do not expose database credentials
through `NEXT_PUBLIC_*` variables.

## Local production build

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm run build` prepares the standalone server and copies same-build public and
static assets through its `postbuild` hook. `npm start` runs that standalone
server, matching the Docker runtime. Select the port and binding through exported
environment variables, for example `HOSTNAME=127.0.0.1 PORT=4011 npm start`.
Do not rely on `PORT` inside `.env.local`, which is loaded after port selection.

With the application running, verify the real provider path and retired-data
boundaries:

```sh
ATLAS_BASE_URL=http://127.0.0.1:4011 npm run verify:live
```

This check makes actual feed requests through the application and requires both
source-backed reports and news coverage. It fails on an outage instead of
substituting fixtures. Unit tests remain separate and deterministic.

If preparing the standalone assets manually:

```sh
mkdir -p .next/standalone/public .next/standalone/.next/static
cp -R public/. .next/standalone/public/
cp -R .next/static/. .next/standalone/.next/static/
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

Keep `public` and `.next/static` from the same build as the standalone server.
Do not copy `.env.local` into a published build artifact.

The `predev` and `prebuild` hooks synchronize same-origin MapLibre worker
assets and their license from the installed package. Keep the worker and shared
module together, matching the package lock and main browser bundle. Do not
replace only one of these files during an upgrade.

## Docker profiles

| Profile / service | Function |
| --- | --- |
| Default `app` | Non-root Node web runtime; no database dependency |
| `database`: `db`, `migrate` | Optional PostGIS service and one-shot migration image |
| `worker`: `db`, `worker` | Optional persistent ingestion worker |
| `cache`: `redis` | Reserved infrastructure only; unused by the application |

Start just the application:

```sh
docker compose up --build -d app
docker compose logs -f app
```

For persistent ingestion, configure `.env` as above, then:

```sh
docker compose --profile database up -d db
docker compose --profile database run --build --rm migrate
docker compose up --build -d app
docker compose --profile worker up --build -d worker
```

Use named services in these commands. Starting all profile services at once
is not a substitute for waiting for migrations to complete before web/worker
traffic.

The official `postgis/postgis:17-3.5` image is configured as `linux/amd64`.
Apple Silicon hosts need Docker's amd64 emulation. The database volume is
mounted at `/var/lib/postgresql/data`. The default PostgreSQL credentials are
only for loopback-bound local development.

`docker compose down` stops project services and preserves named data volumes.
Do not use `down -v` unless deliberate, irreversible deletion of the project's
database and cache data is intended.

## Database migrations and privileges

```sh
npm run db:migrate
```

The runner connects through `DATABASE_URL`, obtains an advisory lock, and applies
each SQL file in a transaction. `atlas_schema_migrations` records the filename
and SHA-256 checksum. Running the command again skips unchanged migrations.
Editing an already-applied migration is rejected; add a new migration instead.
A failed migration rolls back that migration's changes.

For an installation created before the live-only conversion, stop its old
application/worker processes, take a restorable backup, and apply
`0002_live_only.sql` before starting the new build. Do not rewrite
`0001_core.sql` or delete the migration ledger to bypass its checksum.

The second migration:

- Invalidates `atlas_ingestion_snapshots`, a disposable derived cache, so old
  fabricated scores or location assumptions cannot persist after upgrade.
  Real providers rebuild the cache; an outage remains empty.
- Removes explicitly flagged demonstration records and their normalized
  relationships/version entries. Unflagged raw provider records, the source
  registry, countries and user-owned preferences are preserved.
- Allows `NULL` severity/confidence and constrains legacy demonstration flags
  to false, including explicit flags inside normalized JSON source records.

The migration does not reinterpret unflagged historical normalized scores as
verified assessments. Those normalized tables are not the current API read
path; review/reprocess them from retained original sources before activating a
future normalized query path. Backups can still contain old fictional records;
restoring one requires reapplying the live-only migration and validation.

The first migration creates the PostGIS extension. On managed databases,
provision PostGIS with an appropriately privileged migration account, or
pre-enable it through the provider's supported mechanism. Use separate,
least-privilege runtime credentials in production; the local Compose account is
not a production privilege model.

The current runtime adapter needs access only to `atlas_ingestion_snapshots` and
`atlas_source_records`. It does not need permission to create extensions or
tables. Restrict database network access, use certificate-validated TLS for
remote connections, and do not set `rejectUnauthorized: false` as a workaround.

There is no automatic retention job, replica, backup service, immutable raw
revision archive, or event-audit trigger. Set a retention policy before operating
long-term. Back up PostgreSQL with the provider's backup service or `pg_dump`,
encrypt backups, and periodically test restoration into a separate database.
Preserve the migration ledger with the data.

## Ingestion

```sh
npm run ingest -- --once
npm run ingest
```

Use `--once` for a controlled fetch and an external scheduler, or the continuous
worker for a long-running service. A worker without PostgreSQL only warms its
own memory; it does not warm another web process. Do not run one aggressive
worker per web replica.

The runtime enforces a provider-cache floor of 60 seconds and longer
source-specific minimums; BBC uses 15 minutes, including worker refreshes.
This is not a deployment-wide distributed rate limiter. Multiple independent
instances can still multiply upstream traffic. Observe the configured providers'
current quotas; ReliefWeb's documentation currently lists a 1,000-call daily
allowance. Use a longer interval where necessary, especially across replicas.

The source adapters do not accept a URL from a public request. To add a source,
review access and redistribution requirements, implement a fixed endpoint
adapter, test malformed/error responses and location handling, then expose its
health and provenance. Do not turn the server into an arbitrary URL proxy.

## Health and stale data

`GET /api/health` is a service-health endpoint. It is not a guarantee that every
source is fresh, that external sources are reachable, or that records are true.
Inspect `GET /api/sources`, the events response's `sources` and
`warnings`, and the UI source-status view for provider state.

| Symptom | Meaning and response |
| --- | --- |
| Provider `disabled` | Optional configuration is absent or the provider has not been enabled. This is intentional, not an outage. |
| Provider `degraded` | A last successful source snapshot remains within the stale-cache limit after a fetch failure. Inspect its retained fetch time; it is not fresh reporting. |
| Provider `error` | No usable provider snapshot is available, or its maximum stale age has expired. Inspect connection, access approval, response format and provider status. |
| Database warning | Memory data may still work, but persistence is unavailable. Check migrations, credentials and database reachability. |
| No matching events | Coverage, filters, time window or viewport can legitimately be empty. Never fill it with fictional events or generated headlines. |
| Missing point on map | The report may lack usable coordinates; inspect the list and source precision instead of geocoding by guess. |
| Unavailable basemap | Inspect WebGL/CSP and same-origin `/data` asset responses. No external tile provider is required. The list remains the non-map path to event details. |

Log failures without credentials, personal preferences, or full source bodies.
Add structured metrics and alerting appropriate to the host before production:
fetch latency, consecutive failures, last success age, persistence errors, SSE
connections and memory usage.

`updatedAt` in the event envelope is the latest successful provider fetch time,
or `null` when none exists. It does not assert that every feed is current or that
a new event occurred. Each source keeps its own fetch time; publication,
occurrence and first-observation timestamps remain separate. A healthy provider
can return a legitimately empty feed.

Failed providers may retain their last good snapshot for at most 24 hours
since its successful fetch. After that, the records are omitted and the provider
shows an error with its retained last-success timestamp. Report publication
dates may be older than fetch dates; a refreshed seven-day feed is not composed
only of newly occurring events.

## SSE and reverse proxies

`GET /api/stream` uses `text/event-stream` and named `events` messages.
The connection is intentionally bounded and periodically re-established. Clients
must handle reconnection and should display stale/offline state when updates
stop. It is a snapshot feed, not a guaranteed event-delivery log.

Use a host that supports streaming responses and concurrent open connections.
Disable reverse-proxy buffering and caching for this route; do not compress it
in a way that buffers messages. Set proxy idle limits above the heartbeat
interval. A typical Nginx location requires:

```nginx
location /api/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 75s;
    add_header X-Accel-Buffering no;
}
```

Test through the actual production proxy with `curl -N`; a successful local
stream does not verify CDN or serverless streaming behavior. There is no Redis
pub/sub fan-out or distributed queue. Snapshot persistence alone is not a
cross-instance real-time message bus.

## Public deployment checklist

- Keep source attribution, report-kind/timestamp labels, assessment limits and
  stale/error states visible, including direct event/country routes and copied
  links. Confirm obsolete scenario identifiers cannot return fictional records.
- Obtain provider approvals and review source and bundled-asset usage terms
  for the specific deployment.
- Use HTTPS, trusted proxy configuration, protected environment variables,
  database network isolation, and least-privilege runtime credentials.
- Apply an origin-aware CSP after testing the map style, local fonts and worker
  requirements. The bundled MapLibre worker URL is same-origin and needs
  `worker-src 'self'`; map data connections are also same-origin. Review any
  later external tile integration separately.
- Add edge request/concurrency limits to read APIs and SSE. Provider caching is
  not protection against unlimited inbound requests.
- Keep public APIs read-only. There is no authenticated admin or mutation API;
  do not expose migrations or an ingestion trigger as an unauthenticated route.
- Add authentication, ownership checks, CSRF protection where applicable,
  audit logging and appropriate row-level permissions before adding remote
  watchlist, alert or moderation writes.
- Define raw-record retention, restoration drills, error monitoring and an
  operational owner.
- Test keyboard access, reduced motion, mobile layout, empty/stale source
  states and denied browser notification permission.
- Review [remaining scope](roadmap.md); publisher diversity, real feed access and
  analytical labels are not substitutes for independent verification or
  editorial review.
