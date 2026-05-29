import type { SourceAdapter } from '../types.js';
import { usgsAdapter } from '../adapters/usgs.js';
import { nwsAdapter } from '../adapters/nws.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { persistBatch, markSourceOk, markSourceError } from '../pipeline/persist.js';

/** All adapters this build supports. Add new sources by importing + registering here. */
const ADAPTERS: { adapter: SourceAdapter; disabled: boolean }[] = [
  { adapter: usgsAdapter, disabled: config.sources.usgs.disabled },
  { adapter: nwsAdapter,  disabled: config.sources.nws.disabled  },
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

export function startScheduler(): void {
  for (const { adapter, disabled } of ADAPTERS) {
    if (disabled) {
      log.warn({ source: adapter.id }, 'source.disabled');
      continue;
    }
    log.info({ source: adapter.id, intervalSeconds: adapter.intervalSeconds }, 'source.scheduled');
    // Fire immediately on boot, then on interval
    runOnce(adapter);
    setInterval(() => runOnce(adapter), adapter.intervalSeconds * 1000);
  }
}

// Allow running this file standalone (npm run ingest)
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
  // Keep the process alive
  process.on('SIGINT', () => {
    log.info('shutdown');
    process.exit(0);
  });
}
