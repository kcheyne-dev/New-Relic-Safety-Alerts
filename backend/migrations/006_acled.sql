-- 006_acled.sql
-- Register ACLED as a source. GDELT is left in the table but disabled via env;
-- existing GDELT events are marked stale in a one-shot UPDATE so they clear from
-- the dashboard immediately.

INSERT INTO sources (id, name, kind, url, fetch_interval_seconds) VALUES
  ('acled', 'ACLED — Armed Conflict Location & Event Data', 'civil',
   'https://acleddata.com/api/acled/read', 900)
ON CONFLICT (id) DO NOTHING;

-- Mark every still-active GDELT event as stale (we already disabled the source
-- via .env, but old rows would otherwise linger until the sweeper hits them).
UPDATE events SET is_stale = TRUE, updated_at = NOW()
WHERE primary_source_id = 'gdelt' AND NOT is_stale;
