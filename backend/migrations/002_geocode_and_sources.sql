-- ============================================================================
-- NR Safety Alerts — Sprint 2 schema additions
-- ============================================================================
-- - Geocode cache (so we don't hammer Nominatim)
-- - Register the new sources we ingest in this sprint

-- ----------------------------------------------------------------------------
-- Geocode cache: query string → (lat, lng) with timestamp
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geocode_cache (
  query       TEXT PRIMARY KEY,                 -- normalized lowercase, trimmed
  lat         DOUBLE PRECISION,                 -- null if geocoder couldn't resolve
  lng         DOUBLE PRECISION,
  display     TEXT,                             -- the canonical place label from the geocoder
  provider    TEXT NOT NULL,                    -- 'nominatim' for now
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- TTL: re-resolve entries after this. NULL = never expire.
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS geocode_cache_fetched_idx ON geocode_cache (fetched_at DESC);

-- ----------------------------------------------------------------------------
-- Add new sources we begin ingesting in Sprint 2
-- ----------------------------------------------------------------------------
INSERT INTO sources (id, name, kind, url, fetch_interval_seconds) VALUES
  ('eonet',      'NASA Earth Observatory Natural Event Tracker', 'natural',
   'https://eonet.gsfc.nasa.gov/api/v3/events?status=open', 600),
  ('gdacs',      'Global Disaster Alert and Coordination System', 'natural',
   'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH', 600),
  ('emsc',       'European Mediterranean Seismological Centre',  'natural',
   'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200&minmag=4', 300),
  ('meteoalarm', 'MeteoAlarm — European weather warnings',       'natural',
   'https://feeds.meteoalarm.org/api/v1/warnings/feeds-europe', 900),
  ('state_dept', 'US Department of State — Travel Advisories',   'travel',
   'https://travel.state.gov/_res/rss/TAsTWs.xml', 86400)
ON CONFLICT (id) DO NOTHING;
