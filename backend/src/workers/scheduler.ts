import type { SourceAdapter } from '../types.js';
import { usgsAdapter } from '../adapters/usgs.js';
import { nwsAdapter } from '../adapters/nws.js';
import { eonetAdapter } from '../adapters/eonet.js';
import { gdacsAdapter } from '../adapters/gdacs.js';
import { emscAdapter } from '../adapters/emsc.js';
import { meteoalarmAdapter } from '../adapters/meteoalarm.js';
import { stateDeptAdapter } from '../adapters/state_dept.js';
import { sfPoliceAdapter } from '../adapters/sf_police.js';
import { atlApdAdapter } from '../adapters/atl_apd.js';
import { londonTflAdapter } from '../adapters/london_tfl.js';
import { whoDonAdapter } from '../adapters/who_don.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { persistBatch, markSourceOk, markSourceError } from '../pipeline/persist.js';

/** All adapters this build supports. Add new sources by importing + registering here. */
const ADAPTERS: { adapter: SourceAdapter; disabled: boolean }[] = [
  { adapter: usgsAdapter,       disabled: config.sources.usgs.disabled       },
  { adapter: nwsAdapter,        disabled: config.sources.nws.disabled        },
  { adapter: eonetAdapter,      disabled: config.sources.eonet.disabled      },
  { adapter: gdacsAdapter,      disabled: config.sources.gdacs.disabled      },
  { adapter: emscAdapter,       disabled: config.sources.emsc.disabled       },
  { adapter: meteoalarmAdapter, disabled: config.sources.meteoalarm.disabled },
  { adapter: stateDeptAdapter,  disabled: config.sources.stateDept.disabled  },
  { adapter: sfPoliceAdapter,      disabled: config.sources.sfPolice.disabled      },
  { adapter: atlApdAdapter,        disabled: config.sources.atlApd.disabled        },
  { adapter: londonTflAdapter,     disabled: config.sources.londonTfl.disabled     },
  // ACLED / GDELT / PDX FlashAlert removed 2026-07-13 — see
  // docs/data-sources.md § Archived sources for rationale.
];

async function runOnce(adapter: SourceAdapter): Promise<void> {
  try {
    log.debug({ source: adapter.id }, 'fetch.start');
    const items = await adapter.fetch();
    await persistBatch(adapter.id, items);
    await markSourceOk(adapter.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ source: adapter.id, err: msg }, 'fetch.failed');
    await markSourceError(adapter.id, msg);
  }
}

/** WHO DON has its own custom path — persists to who_outbreaks table, not events.
 *  Same source-health bookkeeping as regular adapters so the dashboard's
 *  Sources X/Y indicator covers it consistently. */
async function runWhoOnce(): Promise<void> {
  try {
    log.debug({ source: whoDonAdapter.id }, 'fetch.start');
    await whoDonAdapter.run();
    await markSourceOk(whoDonAdapter.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ source: whoDonAdapter.id, err: msg }, 'fetch.failed');
    await markSourceError(whoDonAdapter.id, msg);
  }
}

export function startScheduler(): void {
  for (const { adapter, disabled } of ADAPTERS) {
    if (disabled) {
      log.warn({ source: adapter.id }, 'source.disabled');
      continue;
    }
    log.info({ source: adapter.id, intervalSeconds: adapter.intervalSeconds }, 'source.scheduled');
    // Stagger initial fetches by 0-3s so we don't fire all 7 sources simultaneously on boot
    const stagger = Math.floor(Math.random() * 3000);
    setTimeout(() => runOnce(adapter), stagger);
    setInterval(() => runOnce(adapter), adapter.intervalSeconds * 1000);
  }

  // WHO DON — separate path because it persists to its own table.
  // Disable knob: WHO_DON_DISABLED=true (defaults to enabled).
  if (config.sources.whoDon?.disabled) {
    log.warn({ source: whoDonAdapter.id }, 'source.disabled');
  } else {
    log.info({ source: whoDonAdapter.id, intervalSeconds: whoDonAdapter.intervalSeconds }, 'source.scheduled');
    setTimeout(runWhoOnce, Math.floor(Math.random() * 3000));
    setInterval(runWhoOnce, whoDonAdapter.intervalSeconds * 1000);
  }
}

// Allow running this file standalone (npm run ingest)
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
  process.on('SIGINT', () => {
    log.info('shutdown');
    process.exit(0);
  });
}
