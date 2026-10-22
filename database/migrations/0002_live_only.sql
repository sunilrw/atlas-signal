-- Live-only storage boundary. Keep 0001_core.sql immutable for installations
-- that have already recorded its checksum.
--
-- Provider snapshots are disposable derived caches, not source archives.
-- Invalidate old snapshots so invented scores and legacy location inference
-- cannot survive an upgrade. The next successful fetch rebuilds them from the
-- configured providers; an outage must remain empty, never use seeded records.
DELETE FROM atlas_ingestion_snapshots;

-- Remove only explicitly flagged demonstration records from retained raw data.
-- Do not infer that a report is fictional from words in a real source headline.
DELETE FROM atlas_source_records
WHERE provider_id = 'demo'
   OR payload ->> 'isDemo' = 'true'
   OR payload ->> 'is_demo' = 'true';

DELETE FROM raw_ingestion
WHERE provider_id = 'demo'
   OR payload ->> 'isDemo' = 'true'
   OR payload ->> 'is_demo' = 'true';

-- event_versions.event_id deliberately has no delete cascade in 0001.
-- Remove versions belonging to flagged events before deleting those events.
DELETE FROM event_versions
WHERE event_id IN (
  SELECT id FROM events
  WHERE is_demo
     OR payload ->> 'isDemo' = 'true'
     OR payload ->> 'is_demo' = 'true'
     OR jsonb_path_exists(
       payload,
       '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
     )
)
   OR new_value ->> 'isDemo' = 'true'
   OR new_value ->> 'is_demo' = 'true'
   OR previous_value ->> 'isDemo' = 'true'
   OR previous_value ->> 'is_demo' = 'true'
   OR jsonb_path_exists(
     new_value,
     '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
   )
   OR jsonb_path_exists(
     previous_value,
     '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
   );

-- Event-source and event-conflict relationships cascade from deleted events.
DELETE FROM events
WHERE is_demo
   OR payload ->> 'isDemo' = 'true'
   OR payload ->> 'is_demo' = 'true'
   OR jsonb_path_exists(
     payload,
     '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
   );

DELETE FROM event_sources WHERE is_demo;
DELETE FROM conflicts WHERE is_demo;

-- Unknown is not a low score or a fabricated confidence estimate. PostgreSQL
-- range checks continue to enforce the existing limits for non-null values.
ALTER TABLE events
  ALTER COLUMN severity DROP NOT NULL,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN is_demo SET DEFAULT false,
  ADD CONSTRAINT event_live_only CHECK (is_demo = false),
  ADD CONSTRAINT event_payload_live_only CHECK (
    (payload ->> 'isDemo') IS DISTINCT FROM 'true'
    AND (payload ->> 'is_demo') IS DISTINCT FROM 'true'
    AND NOT jsonb_path_exists(
      payload,
      '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
    )
  );

ALTER TABLE event_sources
  ALTER COLUMN is_demo SET DEFAULT false,
  ADD CONSTRAINT event_source_live_only CHECK (is_demo = false);

ALTER TABLE conflicts
  ALTER COLUMN is_demo SET DEFAULT false,
  ADD CONSTRAINT conflict_live_only CHECK (is_demo = false);

ALTER TABLE atlas_ingestion_snapshots
  ADD CONSTRAINT atlas_snapshot_live_provider CHECK (provider_id <> 'demo'),
  ADD CONSTRAINT atlas_snapshot_live_records CHECK (
    (snapshot ->> 'isDemo') IS DISTINCT FROM 'true'
    AND (snapshot ->> 'is_demo') IS DISTINCT FROM 'true'
    AND (snapshot ->> 'mode') IS DISTINCT FROM 'demo'
    AND (snapshot ->> 'providerId') IS DISTINCT FROM 'demo'
    AND NOT jsonb_path_exists(
      snapshot,
      '$.events[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
    )
    AND NOT jsonb_path_exists(
      snapshot,
      '$.events[*].sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
    )
  );

ALTER TABLE atlas_source_records
  ADD CONSTRAINT atlas_raw_live_only CHECK (
    provider_id <> 'demo'
    AND (payload ->> 'isDemo') IS DISTINCT FROM 'true'
    AND (payload ->> 'is_demo') IS DISTINCT FROM 'true'
  );

ALTER TABLE raw_ingestion
  ADD CONSTRAINT raw_ingestion_live_only CHECK (
    provider_id <> 'demo'
    AND (payload ->> 'isDemo') IS DISTINCT FROM 'true'
    AND (payload ->> 'is_demo') IS DISTINCT FROM 'true'
  );

ALTER TABLE event_versions
  ADD CONSTRAINT event_version_live_only CHECK (
    (new_value ->> 'isDemo') IS DISTINCT FROM 'true'
    AND (new_value ->> 'is_demo') IS DISTINCT FROM 'true'
    AND (previous_value ->> 'isDemo') IS DISTINCT FROM 'true'
    AND (previous_value ->> 'is_demo') IS DISTINCT FROM 'true'
    AND NOT jsonb_path_exists(
      new_value,
      '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
    )
    AND NOT coalesce(jsonb_path_exists(
      previous_value,
      '$.sources[*] ? (@.isDemo == true || @.isDemo == "true" || @.is_demo == true || @.is_demo == "true")'
    ), false)
  );

COMMENT ON COLUMN events.severity IS
  'NULL means unassessed. Any derived hazard severity must disclose its basis in the event payload.';
COMMENT ON COLUMN events.confidence IS
  'NULL means unassessed. Automated ingestion does not assign publisher confidence or verification scores.';
COMMENT ON COLUMN events.is_demo IS
  'Legacy compatibility column constrained to false; no demonstration records are permitted.';
COMMENT ON TABLE atlas_ingestion_snapshots IS
  'Last successful live provider snapshot. Disposable cache; never an immutable source archive.';

-- User preferences and the unflagged source registry are intentionally
-- preserved. Neither has a reliable demonstration flag; do not delete users'
-- own data or infer fabrication from a source name.
