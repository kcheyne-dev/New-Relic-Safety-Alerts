-- =============================================================================
-- One-time cleanup: mark existing TfL events stale that the new CMT keyword
-- gate would have dropped at ingest. Triggered by 2026-06-20 operator feedback
-- that LON's alert feed was being flooded with routine commuter disruptions
-- (signal failures, leaves-on-the-line, planned engineering) that don't meet
-- the Q1/Q2/Q3 CMT bar.
--
-- See:
--   backend/src/pipeline/thresholds.ts → evaluateLondonTfl (keyword regex)
--   backend/src/adapters/london_tfl.ts → call site
--   docs/severity-thresholds.md         → philosophy ("tight for low-sev")
--
-- THIS VERSION COMMITS. The original dry-run version (ROLLBACK by default)
-- was reviewed; flipping to COMMIT was the deliberate next step.
-- =============================================================================

BEGIN;

\echo ''
\echo '--- before: total active TfL events ---'
SELECT COUNT(*) AS active_tfl
FROM events
WHERE primary_source_id = 'london_tfl' AND NOT is_stale;

\echo ''
\echo '--- preview: TfL events being marked stale (no CMT keyword) ---'
SELECT severity, COUNT(*) AS rows
FROM events
WHERE primary_source_id = 'london_tfl'
  AND NOT is_stale
  AND NOT (
    summary ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|incident|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
    OR title ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|incident|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
  )
GROUP BY severity
ORDER BY severity;

\echo ''
\echo '--- preview: TfL events being kept (CMT keyword matched) ---'
SELECT id, severity, title, LEFT(summary, 100) AS summary_preview
FROM events
WHERE primary_source_id = 'london_tfl'
  AND NOT is_stale
  AND (
    summary ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|incident|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
    OR title ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|incident|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
  )
ORDER BY issued_at DESC
LIMIT 20;

\echo ''
\echo '--- applying: marking non-keyword TfL events stale ---'
UPDATE events
SET is_stale = true,
    updated_at = NOW()
WHERE primary_source_id = 'london_tfl'
  AND NOT is_stale
  AND NOT (
    summary ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|incident|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
    OR title ~* '\m(police|fire|evacuat[a-z]*|emergency|suspicious|incident|security|casualt[a-z]*|fatal[a-z]*|explos[a-z]*|attack|terror[a-z]*|hostile|lockdown|crime|stab[a-z]*|shoot[a-z]*|riot[a-z]*|protest[a-z]*|bomb)\M'
  );

\echo ''
\echo '--- after: total active TfL events ---'
SELECT COUNT(*) AS active_tfl
FROM events
WHERE primary_source_id = 'london_tfl' AND NOT is_stale;

COMMIT;
