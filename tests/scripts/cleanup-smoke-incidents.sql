-- =========================================================================
-- NRSA smoke-test cleanup
-- =========================================================================
-- Removes incidents (and their cascaded messages/responses/notes/log entries)
-- created by the smoke harness. Identifies them by the `smoke-` prefix that
-- the harness embeds in message bodies via RUN_ID.
--
-- Default-rolls-back: the first run is a dry-run that prints the count of
-- rows it WOULD delete. Flip ROLLBACK → COMMIT on the last line to actually
-- delete.
--
-- Usage:
--   psql postgres://nrsa:nrsa@localhost:5432/nrsa -f cleanup-smoke-incidents.sql
-- =========================================================================

BEGIN;

-- 1. Identify the target incidents — anything that has at least one message
--    whose body starts with the smoke-harness RUN_ID prefix.
WITH targets AS (
  SELECT DISTINCT incident_id
    FROM crisis_messages
   WHERE incident_id IS NOT NULL
     AND body LIKE 'smoke-%'
)
SELECT
  COUNT(*) AS incidents_to_delete
FROM targets;

-- 2. Show the message titles + dates for visibility before delete.
SELECT
  i.id,
  i.title,
  i.created_at,
  COUNT(cm.id) FILTER (WHERE cm.is_test)        AS test_messages,
  COUNT(cm.id) FILTER (WHERE NOT cm.is_test)    AS real_messages
FROM incidents i
JOIN crisis_messages cm ON cm.incident_id = i.id
WHERE i.id IN (
  SELECT DISTINCT incident_id
    FROM crisis_messages
   WHERE incident_id IS NOT NULL
     AND body LIKE 'smoke-%'
)
GROUP BY i.id
ORDER BY i.created_at DESC;

-- 3. Also catch any STANDALONE comms (incident_id IS NULL) sent from the
--    harness — these wouldn't be hooked by the incident delete.
DELETE FROM crisis_messages
 WHERE incident_id IS NULL
   AND body LIKE 'smoke-%';

-- 4. The big delete. ON DELETE CASCADE handles messages, responses, notes,
--    log entries, audit log via FK relationships in migrations 005 + 008.
--
--    Two match patterns:
--      a) Incident has at least one message body starting with 'smoke-'
--         (catches the real-send + test-send incidents from the Crisis
--         Comms smoke flow).
--      b) Incident TITLE starts with 'smoke-'
--         (catches BCI-declaration incidents from the smoke's BCI step,
--         which has no message — declareBCP creates the incident and
--         opens the Crisis Comms compose form for the operator to send
--         a message manually; the smoke stops short of that send).
DELETE FROM incidents
 WHERE id IN (
   SELECT DISTINCT incident_id
     FROM crisis_messages
    WHERE incident_id IS NOT NULL
      AND body LIKE 'smoke-%'
 )
    OR title LIKE 'smoke-%';

-- DEFAULT: dry run. Change to COMMIT to actually apply.
ROLLBACK;
