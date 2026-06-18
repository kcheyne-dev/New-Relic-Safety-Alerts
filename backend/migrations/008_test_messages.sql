-- ============================================================================
-- NR Safety Alerts — Sprint 5 follow-on: test-message flag on crisis_messages
-- ============================================================================
-- Adds an `is_test` flag to crisis_messages so operators can rehearse the
-- Crisis Comms workflow without polluting the real audit trail. Test messages
-- live in real incidents (the auto-created incident from a standalone test
-- send is itself real — see project-review-2026-06-16.md and the design Q&A
-- on 2026-06-18). They render with a 🧪 TEST badge across every surface that
-- shows the message: Comms tab, incident Log, standalone Crisis Comms log,
-- and the Export Report.
--
-- Forward compatibility note: if a future iteration ever introduces a
-- "test incident" classification, this migration is independent — that would
-- be a separate column on `incidents`. Today the property lives only on the
-- message row.

ALTER TABLE crisis_messages
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Index on the test flag so dashboards / reports can fast-filter to either
-- real-only or test-only views. Selectivity will be high in practice (most
-- messages are real), so a partial index limited to test rows is the most
-- efficient shape.
CREATE INDEX IF NOT EXISTS crisis_messages_is_test_idx
  ON crisis_messages (incident_id, sent_at DESC)
  WHERE is_test = TRUE;
