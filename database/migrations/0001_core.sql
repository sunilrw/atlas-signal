-- Atlas Signal storage baseline.
--
-- The current ingestion adapter writes atlas_ingestion_snapshots and
-- atlas_source_records. The normalized tables below are a migration-ready
-- foundation; they are not automatically populated by the current adapter.
-- Apply with `npm run db:migrate`, not as an untracked startup script.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE atlas_ingestion_snapshots (
  provider_id text PRIMARY KEY,
  fetched_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  CONSTRAINT atlas_snapshot_is_object CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE atlas_source_records (
  provider_id text NOT NULL,
  provider_record_id text NOT NULL,
  fetched_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (provider_id, provider_record_id)
);

CREATE INDEX atlas_source_records_fetched_idx
  ON atlas_source_records (fetched_at DESC);

CREATE TABLE countries (
  code text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  region text NOT NULL,
  boundary geometry(MultiPolygon, 4326),
  CONSTRAINT country_iso_code CHECK (code ~ '^[A-Z]{2}$')
);

CREATE INDEX countries_boundary_idx ON countries USING gist (boundary);

CREATE TABLE sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  source_type text NOT NULL,
  homepage_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  license_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_type_allowed
    CHECK (source_type IN ('primary', 'news', 'ngo', 'dataset')),
  CONSTRAINT source_homepage_http CHECK (homepage_url ~* '^https?://')
);

CREATE TABLE events (
  id text PRIMARY KEY,
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  subcategory text,
  severity smallint NOT NULL,
  status text NOT NULL,
  confidence smallint NOT NULL,
  latitude double precision,
  longitude double precision,
  geom geography(Point, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      ELSE NULL
    END
  ) STORED,
  location_name text NOT NULL,
  location_accuracy text NOT NULL,
  country_code text REFERENCES countries (code),
  region text NOT NULL,
  first_reported_at timestamptz NOT NULL,
  last_updated_at timestamptz NOT NULL,
  is_demo boolean NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_category_allowed CHECK (category IN (
    'conflict', 'military', 'terrorism', 'civil-unrest', 'political',
    'diplomatic', 'cyber', 'infrastructure', 'energy', 'economic',
    'humanitarian', 'natural-disaster', 'maritime', 'aviation',
    'health', 'crime', 'other'
  )),
  CONSTRAINT event_severity_range CHECK (severity BETWEEN 1 AND 7),
  CONSTRAINT event_confidence_range CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT event_status_allowed CHECK (
    status IN ('reported', 'developing', 'confirmed', 'resolved', 'disputed')
  ),
  CONSTRAINT event_location_accuracy_allowed CHECK (location_accuracy IN (
    'exact', 'city', 'region', 'country', 'approximate', 'unknown'
  )),
  CONSTRAINT event_coordinates_paired CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  ),
  CONSTRAINT event_latitude_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT event_longitude_range CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT unknown_location_has_no_point CHECK (
    location_accuracy <> 'unknown' OR (latitude IS NULL AND longitude IS NULL)
  ),
  CONSTRAINT event_timestamp_order CHECK (last_updated_at >= first_reported_at),
  CONSTRAINT event_payload_is_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX events_geo_idx ON events USING gist (geom);
CREATE INDEX events_bbox_idx ON events USING gist ((geom::geometry));
CREATE INDEX events_updated_idx ON events (is_demo, last_updated_at DESC);
CREATE INDEX events_category_idx ON events (is_demo, category, last_updated_at DESC);
CREATE INDEX events_country_idx ON events (country_code, last_updated_at DESC);
CREATE INDEX events_severity_idx ON events (severity DESC, last_updated_at DESC);
CREATE INDEX events_tags_idx ON events USING gin (tags);
CREATE INDEX events_search_idx ON events USING gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))
);

CREATE TABLE event_sources (
  event_id text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources (id),
  provider_record_id text NOT NULL,
  url text NOT NULL,
  published_at timestamptz NOT NULL,
  is_demo boolean NOT NULL,
  PRIMARY KEY (event_id, source_id, provider_record_id),
  CONSTRAINT event_source_http CHECK (url ~* '^https?://')
);

CREATE INDEX event_sources_provider_idx
  ON event_sources (source_id, provider_record_id);

-- An append-only envelope for a future normalized ingestion pipeline.
-- atlas_source_records above retains the latest raw record per provider ID
-- today; it is not an immutable full revision archive.
CREATE TABLE raw_ingestion (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL,
  provider_record_id text NOT NULL,
  source_url text,
  received_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  CONSTRAINT raw_source_http CHECK (
    source_url IS NULL OR source_url ~* '^https?://'
  ),
  CONSTRAINT raw_sha256_format CHECK (payload_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX raw_ingestion_provider_idx
  ON raw_ingestion (provider_id, provider_record_id, received_at DESC);
CREATE INDEX raw_ingestion_received_idx ON raw_ingestion (received_at DESC);

CREATE TABLE event_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  changed_fields text[] NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  source_id text REFERENCES sources (id),
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  CONSTRAINT event_version_actor_allowed
    CHECK (actor_kind IN ('system', 'reviewer')),
  CONSTRAINT event_version_new_value_object
    CHECK (jsonb_typeof(new_value) = 'object'),
  CONSTRAINT event_version_previous_value_object
    CHECK (previous_value IS NULL OR jsonb_typeof(previous_value) = 'object')
);

CREATE INDEX event_versions_event_idx
  ON event_versions (event_id, recorded_at DESC);

CREATE TABLE conflicts (
  id text PRIMARY KEY,
  name text NOT NULL,
  summary text NOT NULL,
  country_codes text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  is_demo boolean NOT NULL,
  analytical_note text NOT NULL,
  boundary geometry(MultiPolygon, 4326),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conflicts_boundary_idx ON conflicts USING gist (boundary);

CREATE TABLE event_conflicts (
  event_id text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  conflict_id text NOT NULL REFERENCES conflicts (id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, conflict_id)
);

-- Deliberately no public CRUD endpoints or authentication tables.
-- owner_id is reserved for a future server-verified authentication subject,
-- never an owner identifier accepted on trust from a request body.
CREATE TABLE user_watchlists (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_kind_allowed CHECK (kind IN ('country', 'event')),
  UNIQUE (owner_id, kind, value)
);

CREATE INDEX user_watchlists_owner_idx ON user_watchlists (owner_id);

CREATE TABLE alert_rules (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  country_code text,
  category text NOT NULL,
  min_severity smallint NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_country_code CHECK (
    country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT alert_severity_range CHECK (min_severity BETWEEN 1 AND 7),
  CONSTRAINT alert_category_allowed CHECK (category IN (
    'all', 'conflict', 'military', 'terrorism', 'civil-unrest', 'political',
    'diplomatic', 'cyber', 'infrastructure', 'energy', 'economic',
    'humanitarian', 'natural-disaster', 'maritime', 'aviation',
    'health', 'crime', 'other'
  ))
);

CREATE INDEX alert_rules_owner_idx ON alert_rules (owner_id, enabled);

COMMENT ON TABLE atlas_ingestion_snapshots IS
  'Current adapter: last successful normalized provider snapshot.';
COMMENT ON TABLE atlas_source_records IS
  'Current adapter: latest raw payload per provider record; not an immutable revision history.';
COMMENT ON TABLE events IS
  'Normalized PostGIS foundation. Not automatically populated by the snapshot ingestion adapter.';
COMMENT ON COLUMN events.confidence IS
  'Automated source-evidence heuristic, not a probability or human verification.';
COMMENT ON COLUMN events.is_demo IS
  'Required explicit mode boundary; demo events must never be exposed as live reporting.';
COMMENT ON TABLE event_versions IS
  'Future append-only event audit trail; no automatic versioning trigger is installed.';
COMMENT ON TABLE user_watchlists IS
  'Future authenticated persistence; current user preferences are browser-local.';
COMMENT ON TABLE alert_rules IS
  'Future authenticated persistence; no server notification dispatcher is installed.';
