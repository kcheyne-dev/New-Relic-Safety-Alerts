import 'dotenv/config';

export const config = {
  databaseUrl:  process.env.DATABASE_URL  ?? 'postgres://nrsa:nrsa@localhost:5432/nrsa',
  port:         Number(process.env.PORT ?? 8080),
  logLevel:     process.env.LOG_LEVEL ?? 'info',
  corsOrigin:   process.env.CORS_ORIGIN ?? '*',
  sources: {
    usgs: {
      disabled: process.env.USGS_DISABLED === 'true',
      intervalSeconds: Number(process.env.USGS_FETCH_INTERVAL ?? 60),
    },
    nws: {
      disabled: process.env.NWS_DISABLED === 'true',
      intervalSeconds: Number(process.env.NWS_FETCH_INTERVAL ?? 300),
    },
  },
};
