-- Reference queries for the normalized schema, NOT the active snapshot API.
-- All values must be passed as database parameters. Do not interpolate SQL.
--
-- Bounding box: $1 west, $2 south, $3 east, $4 north, $5 oldest timestamp.
-- Validate [-180,180] longitude, [-90,90] latitude, south <= north.
-- west > east denotes a box crossing the antimeridian.
-- The legacy is_demo column is constrained to false by 0002_live_only.sql;
-- keeping the explicit predicate also protects use on an older installation.
-- Missing coordinates cannot match a geographic predicate.
-- The geometry-expression GiST index supports rectangular bounding boxes.
-- This avoids interpreting the rectangle edges as geography great circles.
SELECT id, payload
FROM events
WHERE is_demo = false
  AND last_updated_at >= $5::timestamptz
  AND geom IS NOT NULL
  AND (
    (
      $1::double precision <= $3::double precision
      AND ST_Intersects(
        geom::geometry,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
    )
    OR (
      $1::double precision > $3::double precision
      AND (
        ST_Intersects(
          geom::geometry,
          ST_MakeEnvelope($1, $2, 180, $4, 4326)
        )
        OR ST_Intersects(
          geom::geometry,
          ST_MakeEnvelope(-180, $2, $3, $4, 4326)
        )
      )
    )
  )
ORDER BY last_updated_at DESC
LIMIT 1000;

-- Radius query: $1 longitude, $2 latitude, $3 radius in metres,
-- $4 oldest timestamp. For example, 50000 metres is a 50 km radius.
-- ST_DWithin uses the separate geography GiST index.
SELECT id, payload
FROM events
WHERE is_demo = false
  AND last_updated_at >= $4::timestamptz
  AND ST_DWithin(
    geom,
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    $3::double precision
  )
ORDER BY last_updated_at DESC
LIMIT 1000;
