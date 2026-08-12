/**
 * MeteoAlarm MQTT real-time consumer.
 *
 * Additive transport alongside the REST adapter (backend/src/adapters/
 * meteoalarm.ts). Both feed the same events table via persist.ts;
 * idempotency on (source_id='meteoalarm', source_event_id=cap.identifier)
 * means duplicates dedupe automatically — last write wins on any field
 * diffs.
 *
 * Gated by METEOALARM_TRANSPORT env var:
 *   rest   — REST only (default; MQTT consumer never starts)
 *   mqtt   — MQTT only (REST adapter registration skipped in scheduler.ts)
 *   both   — REST + MQTT run in parallel; REST serves as reconciliation
 *            pass to catch anything MQTT missed during a disconnect.
 *
 * Broker: mqtts://api.meteoalarm.org (QoS 0, GeoJSON message format)
 * Auth:   username='token' (literal string) + password=<METEOALARM_DIRECT_TOKEN>
 *         Confirmed by 2026-07-15 probe (probe-meteoalarm-mqtt.ts). Only
 *         works against the direct API's broker; api.meteogate.eu does
 *         not advertise MQTT so METEOALARM_PROVIDER=meteogate + transport=mqtt
 *         is not a supported combination.
 * Topic:  warnings-ALL (all warnings across all territories)
 *
 * Message shape is byte-for-byte compatible with the REST /locations
 * Feature (probed 2026-07-15) — same properties (alertId, countryCode,
 * hubLink, indexArea/Feature/Info, supersede*), same links[rel=json|xml|
 * canonical|geometry] pointing at the same DigitalOcean Spaces backend.
 * Two MQTT-only extras: properties.rights (WMO attribution notice) and
 * properties.pubtime (broker publish timestamp; issue time is under
 * `datetime`).
 *
 * NO RETAINED MESSAGES: subscribing only shows live traffic from that
 * point forward. Disconnect gaps lose data. MQTT alone is NOT viable
 * for anything requiring at-most-few-minutes staleness — that's why the
 * default is 'both': REST poll every 15 min serves as the reconciliation
 * pass.
 *
 * Multi-region warnings arrive as MULTIPLE MQTT messages sharing an
 * alertId, one per area. Each message goes through normalizeOneAlert
 * with fList=[thisOneFeature]; the bbox is that ONE region's bbox, not
 * the union. The persist upsert on (source_id, source_event_id) means
 * later messages overwrite earlier ones — the LAST message's bbox stays.
 * Not identical to REST behavior (REST computes proper union across all
 * areas), but the next REST reconciliation cycle re-computes with the
 * full union — eventually consistent within 15 min.
 */

import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import { config } from '../config.js';
import { log } from '../log.js';
import { persistBatch, markSourceOk, markSourceError } from '../pipeline/persist.js';
import {
  type IndexFeature,
  fetchJsonVariant,
  normalizeOneAlert,
} from '../adapters/meteoalarm-shared.js';

const SOURCE_ID = 'meteoalarm';
const BROKER   = process.env.METEOALARM_MQTT_BROKER || 'mqtts://api.meteoalarm.org';
const TOPIC    = process.env.METEOALARM_MQTT_TOPIC  || 'warnings-ALL';
/** Fixed literal username from the 2026-07-15 probe. */
const MQTT_USERNAME = 'token';

export interface MqttConsumerHandle {
  /** Cleanly disconnect the MQTT client. Call from server SIGINT handler. */
  stop(): Promise<void>;
}

/**
 * Start the MQTT consumer. Non-blocking; returns immediately after kicking
 * off the connect. All subsequent activity is event-driven via mqtt.js
 * client callbacks. If the initial connect fails, the client's built-in
 * reconnect loop (reconnectPeriod=5000ms) keeps trying.
 *
 * Caller (server.ts) invokes the returned .stop() on SIGINT to close
 * cleanly. Consumer swallows message-processing errors (per-msg) so a
 * malformed message doesn't kill the whole connection.
 */
export function startMeteoalarmMqttConsumer(): MqttConsumerHandle {
  const token = process.env.METEOALARM_DIRECT_TOKEN;
  if (!token) {
    log.warn({}, 'meteoalarm.mqtt.no_token');
    return { async stop() { /* nothing to stop */ } };
  }

  const opts: IClientOptions = {
    username: MQTT_USERNAME,
    password: token,
    clientId: `nrsa-mqtt-${Math.random().toString(36).slice(2, 10)}`,
    // Auto-reconnect on drop. mqtt.js handles the backoff internally;
    // reconnectPeriod is the DELAY between attempts once disconnected.
    // We stay generous (5s) to avoid hammering the broker.
    reconnectPeriod: 5000,
    // TLS verification on. mqtts:// broker; we want cert validation.
    rejectUnauthorized: true,
    // Client will queue up to 128 outbound messages while disconnected —
    // we're subscribe-only so this is defensive, not load-bearing.
    queueQoSZero: false,
  };

  log.info({ broker: BROKER, topic: TOPIC, clientId: opts.clientId }, 'meteoalarm.mqtt.connect_start');
  const client: MqttClient = mqtt.connect(BROKER, opts);

  client.on('connect', () => {
    log.info({ broker: BROKER }, 'meteoalarm.mqtt.connected');
    client.subscribe(TOPIC, { qos: 0 }, (err) => {
      if (err) {
        log.error({ err: err.message, topic: TOPIC }, 'meteoalarm.mqtt.subscribe_failed');
        // Client will keep the connection open; operator can investigate.
      } else {
        log.info({ topic: TOPIC }, 'meteoalarm.mqtt.subscribed');
      }
    });
  });

  client.on('reconnect', () => {
    log.info({ broker: BROKER }, 'meteoalarm.mqtt.reconnect_attempt');
  });

  client.on('close', () => {
    // Fires on both graceful disconnect and drop. mqtt.js auto-reconnects
    // unless we explicitly call end(force=true).
    log.warn({ broker: BROKER }, 'meteoalarm.mqtt.disconnected');
  });

  client.on('error', (err) => {
    log.error({ err: err.message }, 'meteoalarm.mqtt.error');
    // Don't rethrow — mqtt.js recovers via reconnect.
  });

  client.on('offline', () => {
    log.warn({}, 'meteoalarm.mqtt.offline');
  });

  client.on('message', (topic, payload) => {
    // Fire-and-forget the async processing so we don't block the mqtt
    // client's event loop while a slow DigitalOcean Spaces fetch resolves.
    // Errors are caught inside handleMessage.
    void handleMessage(topic, payload);
  });

  return {
    async stop() {
      log.info({}, 'meteoalarm.mqtt.stop_requested');
      await new Promise<void>((resolve) => {
        // end(force=false) sends a proper DISCONNECT packet. false timeout
        // arg is because 4s is plenty for a QoS 0 client with no pending
        // publishes.
        client.end(false, {}, () => resolve());
      });
      log.info({}, 'meteoalarm.mqtt.stopped');
    },
  };
}

/**
 * Per-message handler. Parses the GeoJSON Feature, fetches CAP JSON via
 * links[rel=json], runs the same normalize pipeline the REST adapter uses,
 * then persists a single-item batch. Failures are logged but never thrown
 * — one bad message shouldn't take down the connection.
 */
async function handleMessage(topic: string, payload: Buffer): Promise<void> {
  let feature: IndexFeature;
  try {
    feature = JSON.parse(payload.toString('utf8')) as IndexFeature;
  } catch (err) {
    log.warn({ topic, err: (err as Error).message, payloadLen: payload.length }, 'meteoalarm.mqtt.parse_failed');
    return;
  }
  const alertId = feature?.properties?.alertId;
  const countryCode = feature?.properties?.countryCode;

  // Superseded messages skip processing — the newer version is either
  // already in the pipeline or will arrive shortly on its own topic.
  if (feature?.properties?.supersededByAlertId) {
    log.debug({ alertId, supersededBy: feature.properties.supersededByAlertId }, 'meteoalarm.mqtt.superseded');
    return;
  }

  log.debug({ alertId, countryCode, topic }, 'meteoalarm.mqtt.message.received');

  // Fetch CAP JSON — same DO Spaces URL scheme the REST path uses.
  const cap = await fetchJsonVariant(feature);
  if (!cap) {
    log.debug({ alertId }, 'meteoalarm.mqtt.dropped.no_cap');
    return;
  }

  // Normalize — SAME pipeline the REST adapter runs. MQTT gets fList=[one]
  // (single-feature per message); multi-region alerts arrive as separate
  // messages and the persist upsert dedupes on cap.identifier.
  const result = normalizeOneAlert([feature], cap);
  if (result.kind === 'drop') {
    log.debug({ alertId, reason: result.reason, detail: result.detail }, `meteoalarm.mqtt.dropped.${result.reason}`);
    return;
  }

  // Persist single-item batch. persist.ts's upsert on (source_id,
  // source_event_id) handles dedup vs REST (or vs prior MQTT messages
  // for the same alertId).
  try {
    await persistBatch(SOURCE_ID, [result.item]);
    await markSourceOk(SOURCE_ID);
    log.info(
      {
        alertId,
        countryCode,
        severity: result.item.normalized.severity,
        title:    result.item.normalized.title.slice(0, 80),
      },
      'meteoalarm.mqtt.persisted',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ alertId, err: msg }, 'meteoalarm.mqtt.persist_failed');
    await markSourceError(SOURCE_ID, msg);
  }
}

/**
 * Convenience predicate for callers (server.ts + scheduler.ts) to decide
 * whether to start MQTT / register REST. Reading config.sources.meteoalarm
 * .transport directly.
 */
export function shouldStartMqtt(): boolean {
  const t = config.sources.meteoalarm.transport;
  return t === 'mqtt' || t === 'both';
}

export function shouldRegisterRest(): boolean {
  const t = config.sources.meteoalarm.transport;
  return t === 'rest' || t === 'both';
}
