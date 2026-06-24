-- =============================================================================
-- One-time cleanup: demote existing sf_police + atl_apd events from ext/high
-- to mod. Triggered by 2026-06-20 operator feedback that 3 SFPD 'high' events
-- near SFO (aggravated assault + weapons offense, 35-39 hours old) were all
-- after-the-fact records, not active threats.
--
-- See:
--   backend/src/pipeline/thresholds.ts → evaluatePoliceRecordsFeed (rationale)
--   backend/src/adapters/sf_police.ts  → call site
--   backend/src/adapters/atl_apd.ts    → call site
--
-- Events stay visible — they just stop driving office-relevant ext/high
-- alerts, stop firing the status-strip wash, and stop reading as "CMT
-- mobilize." They remain in geo-fence results as situational-awareness
-- context.
--
-- This script COMMITS by default. The change is reversible
-- (UPDATE ... SET severity = 'high' WHERE ...) and the dry-run version was
-- the source code change itself, which makes ongoing ingest produce 'mod'.
-- =============================================================================

BEGIN;

\echo ''
\echo '--- before: severity distribution for police-records sources ---'
SELECT primary_source_id, severity, COUNT(*) AS rows
FROM events
WHERE primary_source_id IN ('sf_police', 'atl_apd')
  AND NOT is_stale
GROUP BY primary_source_id, severity
ORDER BY primary_source_id,
  CASE severity WHEN 'ext' THEN 1 WHEN 'high' THEN 2 WHEN 'mod' THEN 3 ELSE 4 END;

\echo ''
\echo '--- preview: events being demoted (ext/high → mod) ---'
SELECT primary_source_id, severity, COUNT(*) AS rows
FROM events
WHERE primary_source_id IN ('sf_police', 'atl_apd')
  AND severity IN ('ext', 'high')
  AND NOT is_stale
GROUP BY primary_source_id, severity
ORDER BY primary_source_id, severity;

\echo ''
\echo '--- applying: demoting ext/high → mod ---'
UPDATE events
SET severity = 'mod',
    updated_at = NOW()
WHERE primary_source_id IN ('sf_police', 'atl_apd')
  AND severity IN ('ext', 'high')
  AND NOT is_stale;

\echo ''
\echo '--- after: severity distribution for police-records sources ---'
SELECT primary_source_id, severity, COUNT(*) AS rows
FROM events
WHERE primary_source_id IN ('sf_police', 'atl_apd')
  AND NOT is_stale
GROUP BY primary_source_id, severity
ORDER BY primary_source_id,
  CASE severity WHEN 'ext' THEN 1 WHEN 'high' THEN 2 WHEN 'mod' THEN 3 ELSE 4 END;

COMMIT;
