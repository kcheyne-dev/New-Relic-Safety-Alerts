-- =============================================================================
-- One-time cleanup: stale TfL events that ONLY matched the over-loose
-- "incident" keyword from the 2026-06-20 regex.
--
-- Background: the 2026-06-20 TfL keyword-gate filter included the bare word
-- "incident" in its match regex. TfL uses "customer incident" as a routine
-- euphemism for passenger-related issues (medical calls, trespassers, etc.),
-- and that single keyword was matching essentially all noise events through
-- the gate. Operator observed this on 2026-06-29 — the dashboard showed ~16
-- active TfL events at Extreme/High severity, all with "customer incident"
-- in their reason text.
--
-- Fix: regex updated in `pipeline/thresholds.ts` (removed "incident") so
-- future ingest properly drops these. This script handles the existing
-- rows: marks stale any active TfL event whose summary text contains
-- "incident" but NONE of the other (still-valid) CMT keywords.
--
-- Pattern is OR'd across all the other CMT keywords — if any of those is
-- present, the event was legit-matched by the gate and stays active.
--
-- COMMITS by default. Reversible via `UPDATE events SET is_stale = false
-- WHERE primary_source_id = 'london_tfl' AND ...` if needed.
-- =============================================================================

BEGIN;

\echo ''
\echo '--- before: active TfL events ---'
SELECT severity, COUNT(*) AS rows
FROM events
WHERE primary_source_id = 'london_tfl' AND NOT is_stale
GROUP BY severity
ORDER BY 1;

\echo ''
\echo '--- preview: events that will be marked stale (incident-only match) ---'
SELECT id, severity, title, LEFT(summary, 80) AS summary_preview
FROM events
WHERE primary_source_id = 'london_tfl'
  AND NOT is_stale
  AND summary ~* '\mincident\M'
  AND NOT (
    summary ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
    OR title ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
  )
ORDER BY issued_at DESC;

\echo ''
\echo '--- preview: events that will be kept (genuine CMT keyword present) ---'
SELECT id, severity, title, LEFT(summary, 80) AS summary_preview
FROM events
WHERE primary_source_id = 'london_tfl'
  AND NOT is_stale
  AND (
    summary ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
    OR title ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
  )
ORDER BY issued_at DESC
LIMIT 10;

\echo ''
\echo '--- applying: marking incident-only matches stale ---'
UPDATE events
SET is_stale = true,
    updated_at = NOW()
WHERE primary_source_id = 'london_tfl'
  AND NOT is_stale
  AND summary ~* '\mincident\M'
  AND NOT (
    summary ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
    OR title ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
  );

\echo ''
\echo '--- after: active TfL events ---'
SELECT severity, COUNT(*) AS rows
FROM events
WHERE primary_source_id = 'london_tfl' AND NOT is_stale
GROUP BY severity
ORDER BY 1;

COMMIT;
