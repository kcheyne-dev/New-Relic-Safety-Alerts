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

  sources: {
    usgs:       { disabled: flag(process.env.USGS_DISABLED),       intervalSeconds: num(process.env.USGS_FETCH_INTERVAL, 60) },
    nws:        { disabled: flag(process.env.NWS_DISABLED),        intervalSeconds: num(process.env.NWS_FETCH_INTERVAL, 300) },
    eonet:      { disabled: flag(process.env.EONET_DISABLED),      intervalSeconds: num(process.env.EONET_FETCH_INTERVAL, 600) },
    gdacs:      { disabled: flag(process.env.GDACS_DISABLED),      intervalSeconds: num(process.env.GDACS_FETCH_INTERVAL, 600) },
    emsc:       { disabled: flag(process.env.EMSC_DISABLED),       intervalSeconds: num(process.env.EMSC_FETCH_INTERVAL, 300) },
    meteoalarm: { disabled: flag(process.env.METEOALARM_DISABLED), intervalSeconds: num(process.env.METEOALARM_FETCH_INTERVAL, 900) },
    stateDept:  { disabled: flag(process.env.STATE_DEPT_DISABLED), intervalSeconds: num(process.env.STATE_DEPT_FETCH_INTERVAL, 86400) },
  },
};
