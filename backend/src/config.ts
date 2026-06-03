import 'dotenv/config';

const num = (s: string | undefined, d: number): number => (s ? Number(s) : d);
const flag = (s: string | undefined): boolean => s === 'true';

export const config = {
  databaseUrl:  process.env.DATABASE_URL  ?? 'postgres://nrsa:nrsa@localhost:5432/nrsa',
  port:         num(process.env.PORT, 8080),
  logLevel:     process.env.LOG_LEVEL ?? 'info',
  corsOrigin:   process.env.CORS_ORIGIN ?? '*',

  geocode: {
    nominatimUrl:       process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search',
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? 'nr-safety-alerts/0.1 (cmt-dashboard@example.com)',
    cacheTtlDays:       num(process.env.GEOCODE_CACHE_TTL_DAYS, 180),
  },

  /** Generic webhook for source-down / source-recovery / future incident notifications.
   *  Auto-detects Slack / PagerDuty / generic by URL. Empty = log-only. */
  webhookUrl: process.env.WEBHOOK_URL ?? '',

  auth: {
    jwtSecret:    process.env.JWT_SECRET ?? 'dev-only-do-not-use-in-prod',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    /** Set these when migrating to Okta. When all three are set the JWT verifier
     *  switches to verifying Okta-signed tokens via JWKS instead of locally-issued ones. */
    oktaIssuer:   process.env.OKTA_ISSUER ?? '',
    oktaAudience: process.env.OKTA_AUDIENCE ?? '',
    oktaJwksUri:  process.env.OKTA_JWKS_URI ?? '',
  },

  /** Source-quality knobs. Tightens the firehose at ingest time. */
  quality: {
    /** EONET keeps wildfires "open" for years if no one closes them.
     *  Only ingest events whose latest geometry is within this many days.
     *  Matches staleAfterDays (2) so we don't ingest what we'd immediately sweep. */
    eonetMaxAgeDays: num(process.env.EONET_MAX_AGE_DAYS, 2),
    /** Sweeper marks non-NWS events older than this as is_stale.
     *  Default 2 days = 48h — aligned with CMT use case (events with extreme
     *  likelihood to affect office/traveler/BCP, not historical context). */
    staleAfterDays:  num(process.env.STALE_AFTER_DAYS, 2),
  },

  sources: {
    usgs:       { disabled: flag(process.env.USGS_DISABLED),       intervalSeconds: num(process.env.USGS_FETCH_INTERVAL, 60) },
    nws:        { disabled: flag(process.env.NWS_DISABLED),        intervalSeconds: num(process.env.NWS_FETCH_INTERVAL, 300) },
    eonet:      { disabled: flag(process.env.EONET_DISABLED),      intervalSeconds: num(process.env.EONET_FETCH_INTERVAL, 600) },
    gdacs:      { disabled: flag(process.env.GDACS_DISABLED),      intervalSeconds: num(process.env.GDACS_FETCH_INTERVAL, 600) },
    emsc:       { disabled: flag(process.env.EMSC_DISABLED),       intervalSeconds: num(process.env.EMSC_FETCH_INTERVAL, 300) },
    meteoalarm: { disabled: flag(process.env.METEOALARM_DISABLED), intervalSeconds: num(process.env.METEOALARM_FETCH_INTERVAL, 900) },
    stateDept:  { disabled: flag(process.env.STATE_DEPT_DISABLED), intervalSeconds: num(process.env.STATE_DEPT_FETCH_INTERVAL, 86400) },
    sfPolice:       { disabled: flag(process.env.SF_POLICE_DISABLED),       intervalSeconds: num(process.env.SF_POLICE_FETCH_INTERVAL, 600) },
    atlApd:         { disabled: flag(process.env.ATL_APD_DISABLED),         intervalSeconds: num(process.env.ATL_APD_FETCH_INTERVAL, 900) },
    pdxFlashalert:  { disabled: flag(process.env.PDX_FLASHALERT_DISABLED),  intervalSeconds: num(process.env.PDX_FLASHALERT_FETCH_INTERVAL, 600) },
    londonTfl:      { disabled: flag(process.env.LONDON_TFL_DISABLED),      intervalSeconds: num(process.env.LONDON_TFL_FETCH_INTERVAL, 600) },
    gdelt:          { disabled: flag(process.env.GDELT_DISABLED),           intervalSeconds: num(process.env.GDELT_FETCH_INTERVAL, 900) },
    acled:          {
      disabled:        flag(process.env.ACLED_DISABLED) || !process.env.ACLED_EMAIL || !process.env.ACLED_PASSWORD,
      intervalSeconds: num(process.env.ACLED_FETCH_INTERVAL, 900),
      email:           process.env.ACLED_EMAIL    ?? '',
      password:        process.env.ACLED_PASSWORD ?? '',
      lookbackDays:    num(process.env.ACLED_LOOKBACK_DAYS, 7),
    },
  },
};
