-- =========================================================================
-- NRSA smoke-test cleanup
-- =========================================================================
-- Removes incidents (and their cascaded messages/responses/notes/log entries)
-- created by the smoke harness. Two match patterns, OR'd:
--
--   (a) Incident has at least one crisis_message whose body CONTAINS the
--       smoke-harness RUN_ID. Catches both real-send AND test-send
--       incidents — test-mode bodies prepend a `[DRILL — TEST MESSAGE — DO
--       NOT ACT]` preamble, so the run-id ends up mid-body, not at the
--       start. The `%smoke-%` pattern matches either position.
--   (b) Incident TITLE starts with `smoke-`. Catches BCI-declaration
--       incidents from the smoke's BCI step, which have no message —
--       `declareBCP` creates the incident with a smoke-tagged title and
--       opens Crisis Comms for the operator to send manually; the smoke
--       stops short of that send.
--
-- Default-rolls-back: the first run is a dry-run that prints the rows it
-- WOULD delete. Flip ROLLBACK → COMMIT on the last line to actually delete.
--
-- HISTORY:
--   2026-06-18  Initial version, body LIKE 'smoke-%' (start-anchored).
--   2026-06-19  Added title LIKE 'smoke-%' for BCI incidents.
--   2026-06-24  Loosened body match to '%smoke-%' so test-mode messages
--               with the [DRILL] preamble are caught. Preview SELECT
--               updated to include title-matched incidents (so the dry-run
--               count matches the actual delete count).
--
-- Usage:
--   psql postgres://nrsa:nrsa@localhost:5432/nrsa -f cleanup-smoke-incidents.sql
-- =========================================================================

BEGIN;

-- 1. Identify the target incidents — anything that has at least one message
--    whose body contains the smoke RUN_ID, OR whose title starts with
--    `smoke-`. The pattern intentionally uses `%smoke-%` (not `smoke-%`)
--    so test-mode bodies — which have a [DRILL] preamble prepended — match.
WITH targets AS (
  SELECT i.id
    FROM incidents i
   WHERE i.title LIKE 'smoke-%'
      OR i.id IN (
        SELECT DISTINCT incident_id
          FROM crisis_messages
         WHERE incident_id IS NOT NULL
           AND body LIKE '%smoke-%'
      )
)
SELECT
  COUNT(*) AS incidents_to_delete
FROM targets;

-- 2. Show the titles, dates, and message counts for visibility before delete.
--    Mirrors the same OR'd match logic as the COUNT above so dry-run and
--    real-run numbers match.
SELECT
  i.id,
  i.title,
  i.created_at,
  COUNT(cm.id) FILTER (WHERE cm.is_test)        AS test_messages,
  COUNT(cm.id) FILTER (WHERE NOT cm.is_test)    AS real_messages
FROM incidents i
LEFT JOIN crisis_messages cm ON cm.incident_id = i.id
WHERE i.title LIKE 'smoke-%'
   OR i.id IN (
     SELECT DISTINCT incident_id
       FROM crisis_messages
      WHERE incident_id IS NOT NULL
        AND body LIKE '%smoke-%'
   )
GROUP BY i.id
ORDER BY i.created_at DESC;

-- 3. Also catch any STANDALONE comms (incident_id IS NULL) sent from the
--    harness — these wouldn't be hooked by the incident delete. Same
--    loosened `%smoke-%` pattern for the same reason as above.
DELETE FROM crisis_messages
 WHERE incident_id IS NULL
   AND body LIKE '%smoke-%';

-- 4. The big delete. ON DELETE CASCADE handles messages, responses, notes,
--    log entries, audit log via FK relationships in migrations 005 + 008.
DELETE FROM incidents
 WHERE title LIKE 'smoke-%'
    OR id IN (
      SELECT DISTINCT incident_id
        FROM crisis_messages
       WHERE incident_id IS NOT NULL
         AND body LIKE '%smoke-%'
    );

-- DEFAULT: dry run. Change to COMMIT to actually apply.
ROLLBACK;
