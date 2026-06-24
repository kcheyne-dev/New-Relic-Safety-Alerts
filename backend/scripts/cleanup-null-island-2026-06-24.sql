-- =============================================================================
-- One-time cleanup: Null Island event purge + bad geocode cache flush.
--
-- Background: today's MeteoAlarm adapter rewrite emitted events with
-- lat=0/lng=0 expecting the backend geocoder to resolve via Nominatim.
-- Bare regional names (e.g. "Ortenaukreis") got cached as NULL/NULL misses
-- by Nominatim (the place name is too ambiguous without country context).
-- The persist pipeline then upserted the events with lat=0/lng=0, which
-- plotted them at Null Island (Gulf of Guinea) on the dashboard map.
--
-- The adapter fix (this commit, alongside): append country name so location
-- becomes "Ortenaukreis, Germany" — Nominatim resolves cleanly.
--
-- The persist.ts fix (also this commit): refuse to upsert events with
-- lat=0&&lng=0 even if geocoding fails. The unresolved warn still fires
-- but the row is skipped (counted in `skipped` stats).
--
-- This SQL handles the rows already in the DB from before the fix:
--   1. Mark all existing Null Island events stale (lat=0 AND lng=0).
--   2. Delete cached NULL/NULL miss entries for known MeteoAlarm area
--      names so they get re-resolved on next poll with the new country-
--      qualified location string.
--
-- USAGE: this script COMMITS by default. The cleanup is reversible
-- (un-set is_stale to restore) and the cache invalidation is harmless
-- (just forces a fresh Nominatim lookup).
-- =============================================================================

BEGIN;

\echo ''
\echo '--- before: Null Island event count by source ---'
SELECT primary_source_id, severity, COUNT(*) AS rows
FROM events
WHERE NOT is_stale AND lat = 0 AND lng = 0
GROUP BY primary_source_id, severity
ORDER BY 1, 2;

\echo ''
\echo '--- marking Null Island events stale ---'
UPDATE events
SET is_stale = true,
    updated_at = NOW()
WHERE NOT is_stale
  AND lat = 0
  AND lng = 0;

\echo ''
\echo '--- after: Null Island event count by source ---'
SELECT primary_source_id, severity, COUNT(*) AS rows
FROM events
WHERE NOT is_stale AND lat = 0 AND lng = 0
GROUP BY primary_source_id, severity
ORDER BY 1, 2;

\echo ''
\echo '--- before: cached NULL/NULL geocode entries (Nominatim misses) ---'
SELECT COUNT(*) AS null_misses
FROM geocode_cache
WHERE lat IS NULL AND lng IS NULL;

\echo ''
\echo '--- preview: a sample of those misses ---'
SELECT query, provider, fetched_at, expires_at
FROM geocode_cache
WHERE lat IS NULL AND lng IS NULL
ORDER BY fetched_at DESC
LIMIT 20;

\echo ''
\echo '--- deleting cached misses so they re-resolve on next poll with the new country-qualified location ---'
DELETE FROM geocode_cache
WHERE lat IS NULL AND lng IS NULL;

\echo ''
\echo '--- after: cached NULL/NULL geocode entries ---'
SELECT COUNT(*) AS null_misses
FROM geocode_cache
WHERE lat IS NULL AND lng IS NULL;

COMMIT;
