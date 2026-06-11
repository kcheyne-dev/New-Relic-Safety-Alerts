-- 007_who_outbreaks.sql
-- WHO Disease Outbreak News (DON) — vetted disease outbreak reports.
--
-- This data is *context*, not a real-time alert: WHO has a 5-30 day publication
-- lag between an outbreak emerging and a DON entry appearing. We store it
-- separately from the `events` table so it doesn't pollute the live alert
-- pipeline. The frontend's Risk Profile modal queries it for the disease
-- outbreak detail rows.
--
-- Schema mirrors the WHO_OUTBREAKS_MOCK shape on the frontend so the swap
-- from mock → real is data-only, not UI work.

CREATE TABLE IF NOT EXISTS who_outbreaks (
  id              BIGSERIAL PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE,                 -- WHO RSS guid (or link if guid missing)
  country         TEXT NOT NULL,                        -- e.g. 'Yemen', 'Sudan'
  disease         TEXT NOT NULL,                        -- e.g. 'Cholera', 'Marburg virus'
  severity        TEXT NOT NULL CHECK (severity IN ('low','mod','high','ext')),
  cases           INTEGER,                              -- nullable; not always reported
  issued_at       TIMESTAMPTZ NOT NULL,                 -- pubDate from RSS, falls back to fetched_at
  link            TEXT,                                 -- direct WHO DON URL
  summary         TEXT,                                 -- short operator-facing summary
  raw_payload     JSONB NOT NULL,                       -- full RSS item for forensics
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale        BOOLEAN NOT NULL DEFAULT FALSE,       -- swept after WHO_STALE_AFTER_DAYS
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS who_outbreaks_country_idx ON who_outbreaks (country);
CREATE INDEX IF NOT EXISTS who_outbreaks_issued_idx  ON who_outbreaks (issued_at DESC);
CREATE INDEX IF NOT EXISTS who_outbreaks_active_idx  ON who_outbreaks (is_stale) WHERE NOT is_stale;

-- Trigger to keep updated_at in sync
CREATE OR REPLACE FUNCTION who_outbreaks_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS who_outbreaks_touch_trg ON who_outbreaks;
CREATE TRIGGER who_outbreaks_touch_trg
  BEFORE UPDATE ON who_outbreaks
  FOR EACH ROW EXECUTE FUNCTION who_outbreaks_touch();

-- Register the source
INSERT INTO sources (id, name, kind, url, fetch_interval_seconds) VALUES
  ('who_don', 'WHO — Disease Outbreak News', 'health',
   'https://www.who.int/feeds/entity/csr/don/en/rss.xml', 21600)  -- 6 hours
ON CONFLICT (id) DO NOTHING;
