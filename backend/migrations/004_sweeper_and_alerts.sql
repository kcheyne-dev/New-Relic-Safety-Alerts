-- ============================================================================
-- NR Safety Alerts — Sprint 4 schema additions
-- ============================================================================
-- - Stale-event sweeper index
-- - GDELT source registration
-- - Alert-history table (so we don't spam the same source-down notification)

-- Index for the stale sweeper: find non-stale events older than 24h
CREATE INDEX IF NOT EXISTS events_sweeper_idx
  ON events (created_at)
  WHERE NOT is_stale;

-- Track outbound notifications so we throttle "source down" alerts to once-per-incident
CREATE TABLE IF NOT EXISTS source_alert_state (
  source_id     TEXT PRIMARY KEY REFERENCES sources(id),
  alerted_at    TIMESTAMPTZ,                -- when we last fired a "down" notification
  recovered_at  TIMESTAMPTZ                 -- when we last fired a "recovered" notification
);

INSERT INTO sources (id, name, kind, url, fetch_interval_seconds) VALUES
  ('gdelt', 'GDELT 2.0 — Global Database of Events', 'civil',
   'https://api.gdeltproject.org/api/v2/doc/doc', 900)
ON CONFLICT (id) DO NOTHING;
