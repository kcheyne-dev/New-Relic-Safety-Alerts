-- ============================================================================
-- NR Safety Alerts — initial schema (Sprint 1)
-- ============================================================================
-- Idempotent: safe to run on a fresh DB. Drops are commented out;
-- if you need a clean reset, drop the database itself instead.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Source registry
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL,                  -- natural | civil | public_safety | travel | health
  url                     TEXT NOT NULL,
  fetch_interval_seconds  INTEGER NOT NULL DEFAULT 300,
  enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  last_ok_at              TIMESTAMPTZ,
  last_error_at           TIMESTAMPTZ,
  last_error              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the sources we ingest in Sprint 1
INSERT INTO sources (id, name, kind, url, fetch_interval_seconds) VALUES
  ('usgs', 'US Geological Survey — earthquakes', 'natural',
   'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', 60),
  ('nws',  'US National Weather Service — alerts', 'natural',
   'https://api.weather.gov/alerts/active', 300)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Offices (canonical from prototype; will sync from Workday later)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offices (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  country   TEXT NOT NULL,
  region    TEXT,
  address   TEXT,
  lat       DOUBLE PRECISION NOT NULL,
  lng       DOUBLE PRECISION NOT NULL,
  geom      GEOGRAPHY(POINT, 4326),
  headcount INTEGER
);
CREATE INDEX IF NOT EXISTS offices_geom_idx ON offices USING GIST (geom);

-- ----------------------------------------------------------------------------
-- Raw events (audit log of every ingested item)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_events (
  id              BIGSERIAL PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(id),
  source_event_id TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload         JSONB NOT NULL,
  UNIQUE (source_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS raw_events_fetched_idx ON raw_events (fetched_at DESC);

-- ----------------------------------------------------------------------------
-- Normalized events (what the dashboard reads)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id            UUID,                              -- null until clustering is enabled (Sprint 3)
  title                 TEXT NOT NULL,
  summary               TEXT,
  severity              TEXT NOT NULL CHECK (severity IN ('low','mod','high','ext')),
  category              TEXT NOT NULL,                     -- natural | civil | public_safety | travel | health
  type                  TEXT,                              -- earthquake | flood | protest | heat | ...
  location              TEXT,
  lat                   DOUBLE PRECISION,
  lng                   DOUBLE PRECISION,
  radius_km             DOUBLE PRECISION,
  geom                  GEOGRAPHY(POINT, 4326),
  issued_at             TIMESTAMPTZ NOT NULL,
  expires_at            TIMESTAMPTZ,
  primary_source_id     TEXT NOT NULL REFERENCES sources(id),
  contributing_sources  TEXT[] NOT NULL DEFAULT '{}',
  source_url            TEXT,
  affected_office_ids   TEXT[] NOT NULL DEFAULT '{}',
  is_stale              BOOLEAN NOT NULL DEFAULT FALSE,
  raw_event_id          BIGINT REFERENCES raw_events(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (primary_source_id, source_url, issued_at)
);
CREATE INDEX IF NOT EXISTS events_geom_idx     ON events USING GIST (geom);
CREATE INDEX IF NOT EXISTS events_issued_idx   ON events (issued_at DESC);
CREATE INDEX IF NOT EXISTS events_severity_idx ON events (severity);
CREATE INDEX IF NOT EXISTS events_offices_idx  ON events USING GIN (affected_office_ids);

-- ----------------------------------------------------------------------------
-- Trigger to keep updated_at + geom in sync
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION events_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS events_touch_trg ON events;
CREATE TRIGGER events_touch_trg BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_touch();

CREATE OR REPLACE FUNCTION offices_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS offices_touch_trg ON offices;
CREATE TRIGGER offices_touch_trg BEFORE INSERT OR UPDATE ON offices
  FOR EACH ROW EXECUTE FUNCTION offices_touch();
