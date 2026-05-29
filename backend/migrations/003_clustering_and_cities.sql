-- ============================================================================
-- NR Safety Alerts — Sprint 3 schema additions
-- ============================================================================
-- - Index for cluster lookups (time + space + type)
-- - Register the 4 city open-data adapters

-- Composite index supporting the cluster-match query
CREATE INDEX IF NOT EXISTS events_cluster_lookup_idx
  ON events (type, issued_at)
  WHERE NOT is_stale;

-- Cluster id index — for fetching all events in a cluster
CREATE INDEX IF NOT EXISTS events_cluster_id_idx
  ON events (cluster_id)
  WHERE cluster_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- City open-data sources
-- ----------------------------------------------------------------------------
INSERT INTO sources (id, name, kind, url, fetch_interval_seconds) VALUES
  ('sf_police',     'San Francisco Police — Open Data (Socrata)',    'public_safety',
   'https://data.sfgov.org/resource/wg3w-h783.json', 600),
  ('atl_apd',       'Atlanta Police Department — Open Data',         'public_safety',
   'https://services2.arcgis.com/4FcmTqzRN6XvUDA8/arcgis/rest/services/COBRA_Daily_Updated/FeatureServer/0/query', 900),
  ('pdx_flashalert','Portland / Oregon — FlashAlert Network',        'public_safety',
   'https://www.flashalert.net/api/messages.xml', 600),
  ('london_tfl',    'Transport for London — disruption feed',        'public_safety',
   'https://api.tfl.gov.uk/Line/Mode/tube,bus,dlr,overground,tflrail/Status?detail=true', 600)
ON CONFLICT (id) DO NOTHING;
