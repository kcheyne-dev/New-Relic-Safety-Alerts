-- =============================================================================
-- One-time cleanup: mark existing events stale that the new severity-threshold
-- rules would have dropped at ingest. See docs/severity-thresholds.md.
--
-- USAGE — two-step, safe by default:
--
-- 1. DRY RUN (first invocation, ends with ROLLBACK — no changes committed):
--      psql postgres://nrsa:nrsa@localhost:5432/nrsa \
--        -f backend/scripts/cleanup-thresholds-2026-06-06.sql
--    Read the preview counts and the post-cleanup counts. Confirm the deltas
--    look reasonable (numbers should match the project memory's expected ranges:
--    ~329 active total → meaningful drop expected, especially in EONET/NWS).
--
-- 2. APPLY: change the last line from `ROLLBACK;` to `COMMIT;` and re-run.
--
-- Everything runs inside a single transaction so the dry run is a real dry run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Preview: counts of rows each block will mark stale
-- ---------------------------------------------------------------------------

\echo '--- preview: rows that will be marked is_stale=true ---'

SELECT 'state_dept L2 (severity=mod)' AS rule, COUNT(*) AS rows
FROM events
WHERE primary_source_id = 'state_dept' AND severity = 'mod' AND NOT is_stale
UNION ALL
SELECT 'gdacs Green (severity=mod)', COUNT(*)
FROM events
WHERE primary_source_id = 'gdacs' AND severity = 'mod' AND NOT is_stale
UNION ALL
SELECT 'nws Watches/Advisories (severity in low,mod)', COUNT(*)
FROM events
WHERE primary_source_id = 'nws' AND severity IN ('low','mod') AND NOT is_stale
UNION ALL
SELECT 'eonet drop-categories (drought/dust/snow/etc.)', COUNT(*)
FROM events
WHERE primary_source_id = 'eonet'
  AND type IN ('drought','manmade','temp_extreme','dust','sea_lake_ice','snow','water_color')
  AND NOT is_stale
UNION ALL
SELECT 'eonet wildfire/storm/flood/earthquake without office<=250km', COUNT(*)
FROM events e
WHERE e.primary_source_id = 'eonet'
  AND e.type IN ('wildfire','severe_storm','flood','earthquake')
  AND NOT e.is_stale
  AND NOT EXISTS (
    SELECT 1 FROM offices o WHERE ST_DWithin(o.geom, e.geom, 250 * 1000)
  )
UNION ALL
SELECT 'usgs+emsc M4.5–4.9 (severity=mod) without office<=250km', COUNT(*)
FROM events e
WHERE e.primary_source_id IN ('usgs','emsc')
  AND e.severity = 'mod'
  AND NOT e.is_stale
  AND NOT EXISTS (
    SELECT 1 FROM offices o WHERE ST_DWithin(o.geom, e.geom, 250 * 1000)
  )
UNION ALL
SELECT 'meteoalarm Yellow (severity=mod)', COUNT(*)
FROM events
WHERE primary_source_id = 'meteoalarm' AND severity = 'mod' AND NOT is_stale;

\echo ''
\echo '--- applying updates ---'

-- ---------------------------------------------------------------------------
-- 1. State Dept — old rules kept L2 (severity=mod). New rules drop L2.
--    L1 was already dropped at the adapter so severity=low shouldn't exist.
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id = 'state_dept'
  AND severity = 'mod'
  AND NOT is_stale;

-- ---------------------------------------------------------------------------
-- 2. GDACS — old rules kept Green (severity=mod). New rules: Orange/Red only.
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id = 'gdacs'
  AND severity = 'mod'
  AND NOT is_stale;

-- ---------------------------------------------------------------------------
-- 3. NWS — old rules kept all CAP severities. New rules: Severe/Extreme only
--    (i.e. severity in high/ext). Drop everything at low/mod (Watches,
--    Advisories, Statements).
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id = 'nws'
  AND severity IN ('low','mod')
  AND NOT is_stale;

-- ---------------------------------------------------------------------------
-- 4. EONET — drop categories outside the threshold whitelist.
--    Whitelist: volcanoes (always), wildfires/severeStorms/floods/earthquakes
--    (with proximity). Everything else drops entirely.
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id = 'eonet'
  AND type IN ('drought','manmade','temp_extreme','dust','sea_lake_ice','snow','water_color')
  AND NOT is_stale;

-- ---------------------------------------------------------------------------
-- 5. EONET — wildfires/severeStorms/floods/earthquakes that aren't within
--    250km of any office. Volcanoes always pass so they're explicitly excluded.
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id = 'eonet'
  AND type IN ('wildfire','severe_storm','flood','earthquake')
  AND NOT is_stale
  AND NOT EXISTS (
    SELECT 1 FROM offices o WHERE ST_DWithin(o.geom, events.geom, 250 * 1000)
  );

-- ---------------------------------------------------------------------------
-- 6. USGS/EMSC — M4.5–4.9 events (severity=mod) without an office within
--    250km. Skipping depth check here for simplicity; sweeper will catch
--    deep small quakes in the next 48h anyway. Severity=high (M5.0+)
--    deliberately not touched — gives the M5.0–5.4-far-from-office cohort
--    one extra cycle to clear via sweeper.
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id IN ('usgs','emsc')
  AND severity = 'mod'
  AND NOT is_stale
  AND NOT EXISTS (
    SELECT 1 FROM offices o WHERE ST_DWithin(o.geom, events.geom, 250 * 1000)
  );

-- ---------------------------------------------------------------------------
-- 7. MeteoAlarm — old rule dropped Green (low). New rule also drops Yellow
--    (mod). Adapter is currently broken (HTTP 406) so this should be empty
--    or near-empty, but kept for completeness.
-- ---------------------------------------------------------------------------
UPDATE events SET is_stale = TRUE
WHERE primary_source_id = 'meteoalarm'
  AND severity = 'mod'
  AND NOT is_stale;

-- ---------------------------------------------------------------------------
-- Post-cleanup sanity check: per-source active counts after the update.
-- Compare against your pre-cleanup numbers to confirm the deltas line up
-- with the preview block above.
-- ---------------------------------------------------------------------------

\echo ''
\echo '--- post-cleanup: per-source active event counts ---'

SELECT primary_source_id,
       COUNT(*) FILTER (WHERE NOT is_stale) AS active,
       COUNT(*) FILTER (WHERE is_stale)     AS stale,
       COUNT(*)                             AS total
FROM events
GROUP BY primary_source_id
ORDER BY active DESC;

-- ---------------------------------------------------------------------------
-- Default to ROLLBACK so the first invocation is a dry run. Change this to
-- COMMIT; once you've reviewed the preview + post-cleanup counts above.
-- ---------------------------------------------------------------------------
ROLLBACK;
