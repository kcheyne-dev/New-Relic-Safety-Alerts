import { EventEmitter } from 'node:events';

/**
 * Tiny in-process pub/sub. Decouples the ingestion pipeline from the SSE route
 * so the persist code doesn't import HTTP plumbing.
 *
 * For multi-process production, swap this for Redis pub/sub or Postgres LISTEN/NOTIFY.
 * The interface stays the same — just the underlying transport changes.
 */
class EventBus extends EventEmitter {
  publish(channel: string, payload: unknown): void {
    this.emit(channel, payload);
  }
}

export const bus = new EventBus();
// Allow many SSE subscribers without warnings
bus.setMaxListeners(1000);
