# Atlas Signal

See the world as it changes.

A calm, map-first global-events workspace built with Next.js App Router, React,
TypeScript, and MapLibre GL. Explore geographic events, inspect source evidence,
filter the feed, and follow locations without creating an account.

Made by Sunil Warrier. Visit the live app at [as.uti1.com](https://as.uti1.com).

## Contributors

- Sunil Warrier — creator and project maintainer
- OpenAI Codex — AI-assisted development and documentation

## License

The original Atlas Signal source code and project documentation are licensed
under the [MIT License](LICENSE). You may use, modify, and redistribute them,
including in commercial projects, provided you retain the copyright and license
notice.

Third-party software, fonts, map data, publisher content, and other assets keep
their own copyright and license terms. See `public/data/ATTRIBUTION.md` and the
license files beside those assets. Publisher material visible in the screenshots
remains the property of its respective publishers.

## Screenshots

Captured from the live application on 22 October 2026.

![Atlas Signal world map and live event feed](docs/screenshots/atlas-signal-map.png)

![Atlas Signal report timeline](docs/screenshots/atlas-signal-timeline.png)

![Atlas Signal global briefing](docs/screenshots/atlas-signal-briefing.png)

Atlas Signal uses live source records only. There is no demo mode, seeded event
catalog, invented conflict timeline, or fictional fallback. If a feed is
unavailable, the app shows its last usable source snapshot with a stale warning,
or an honest empty state.

Live means fetched from the named provider, not independently verified or
unbiased. Original publishers can make mistakes, share reporting, or frame
events differently. Source links, wording, timestamps and location limitations
remain visible. See [coverage boundaries](docs/roadmap.md) and the
[verification record](docs/verification.md).

## Run locally

Use Node.js 22.19 or newer and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. No database, API key, subscription, or account is
required. Live feeds need outbound network access from the server. The Natural
Earth basemap and map glyphs are bundled; they are reference geography, not
incident data. Map rendering requires a WebGL-capable browser, while the list
also provides access to reports without coordinates.

Optional configuration:

```sh
cp .env.example .env.local
```

The adapters use fixed provider endpoints. USGS and GDACS provide hazard
records; selected international news feeds add publisher-attributed reporting.
The default news configuration, opt-outs and optional feeds are documented in
[operations](docs/operations.md#configuration). ReliefWeb requires an approved
`RELIEFWEB_APPNAME`. No paid API key is required for the default local setup.
Review [source usage notes](docs/architecture.md#sources-and-usage) before public
or commercial deployment.

## What is included

- A map-first dark/light interface, WebGL event layers and clustering.
- Source-linked report details, publisher metadata, timestamps and location
  evidence. Unassessed severity and confidence remain `null`.
- Search, category/region/time/severity/confidence filters, timeline and snapshot
  cutoff playback.
- Country and event routes; shareable map state. Conflict assessment endpoints
  remain empty until a source-backed conflict catalog is configured.
- Local watchlists, local alert rules, and optional browser notifications while
  the live application is open.
- Read-only JSON endpoints, Server-Sent Events, provider health and stale-cache
  warnings.
- Optional PostgreSQL snapshot/raw-record persistence, a PostGIS schema
  foundation, and an ingestion CLI.
- Standalone Docker web runtime, optional database/worker profiles, and tests.

News reports without provider-supplied coordinates remain in the feed; they do
not receive a guessed map pin. A publisher's home country is not an incident
location. Hazard severity, where available, discloses its numerical basis.
Record counts are not verified incident totals, country risk rankings, or
predictions. Synthetic fixtures are confined to automated tests.

## Useful commands

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

The production server uses port 3000 by default. The build's `postbuild` step
copies the matching public and static assets into the standalone output.
For another port, use `HOSTNAME=127.0.0.1 PORT=4011 npm start`. See
[operations](docs/operations.md) for packaging and deployment details.

## Optional persistent ingestion

Start the optional PostGIS service:

```sh
docker compose --profile database up -d db
```

Set this local value in `.env.local`:

```dotenv
DATABASE_URL=postgresql://atlas:atlas-local-only@localhost:5432/atlas_signal
```

Then apply the schema and ingest once:

```sh
npm run db:migrate
npm run ingest -- --once
```

Run `npm run ingest` for the long-running worker. It defaults to a five-minute
interval. The web server can also fetch feeds on demand, so a worker is not
required for local exploration. Without `DATABASE_URL`, each process has its own
bounded memory cache and a standalone worker cannot populate another process's
memory.

The active database adapter stores provider snapshots and the latest raw payload
per provider record. The normalized event, geographic, audit, watchlist, and alert
tables are a foundation, not a claim that authenticated persistence or complete
event-version history is implemented. Existing installations must apply
`0002_live_only.sql`: it invalidates old derived snapshots, removes explicitly
flagged fictional records, allows unassessed scores, and adds live-only
constraints. See [migration guidance](docs/operations.md#database-migrations-and-privileges)
before upgrading a database.

## Docker

The default command starts only the web app:

```sh
docker compose up --build -d app
```

Open `http://localhost:3000`. The published port is bound to loopback by default.
PostGIS and Redis are not prerequisites.

For a web app with persistent ingestion, copy `.env.example` to `.env`, uncomment
`DOCKER_DATABASE_URL`, and keep its password consistent with `POSTGRES_PASSWORD`.
Compose reads `.env`; it does not automatically read `.env.local`.

```sh
docker compose --profile database up -d db
docker compose --profile database run --build --rm migrate
docker compose up --build -d app
docker compose --profile worker up --build -d worker
```

The worker is optional. The `cache` profile provisions Redis for future work;
the application does **not** use Redis or BullMQ today. Deployment, TLS, scaling,
backups, and failure handling are documented in [operations](docs/operations.md).

## API examples

```sh
curl 'http://localhost:3000/api/events?since=24h'
curl 'http://localhost:3000/api/events?category=natural-disaster&severity=3'
curl 'http://localhost:3000/api/events?west=-20&south=20&east=50&north=65'
curl 'http://localhost:3000/api/search?q=Japan'
curl 'http://localhost:3000/api/sources'
curl 'http://localhost:3000/api/health'
curl -N 'http://localhost:3000/api/stream'
```

Live is the only supported mode. `/api/events` returns events, reference time,
last successful fetch time (or `null`), source health, total and warnings. All
four geographic bounds must be supplied together. The stream emits named
`events` messages; clients reconnect after its bounded connection lifetime.
See the full [API reference](docs/api.md).

## Project guide

| Area | Responsibility |
| --- | --- |
| `src/app/` | Application routes, API handlers and shell styling |
| `src/components/` | Map, feed, controls and detail views |
| `src/lib/` | Catalog, data access, filters and shared application logic |
| `src/types/index.ts` | Shared domain contracts |
| `scripts/` | Ingestion and schema migration commands |
| `database/` | Versioned PostGIS migration and parameterized query examples |
| `docs/architecture.md` | Data flow, trust boundaries and provider usage |
| `docs/operations.md` | Environment, deployment, failure modes and production checklist |
| `docs/roadmap.md` | Implemented scope versus remaining production work |

This is an information-exploration tool. Consult original sources and relevant
authorities before making safety-critical decisions.
