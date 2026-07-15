/**
 * MeteoAlarm MQTT real-time push probe.
 *
 * Prompted by Round 3 (`probe-meteoalarm-direct-round3.ts`) discovering
 * an MQTT broker documented in the OpenAPI spec at:
 *   mqtts://api.meteoalarm.org           (production)
 *   mqtts://api-test.meteoalarm.org      (test)
 * Topics: warnings-ALL + warnings-<XX> per country (37 codes).
 * Message format: GeoJSON, QoS 0, authentication: token.
 *
 * Goal: confirm broker access + auth pattern + message shape + arrival
 * cadence before scoping a permanent MQTT consumer (task #56). The spec
 * says "authentication: token" but doesn't specify HOW to pass the token
 * — MQTT CONNECT has username + password fields, and providers vary in
 * which they use. This probe tries the common patterns until one works.
 *
 * Runs for 5 minutes then disconnects and reports.
 *
 * Usage (from backend/):
 *   npm install                                    # picks up mqtt dep
 *   npx tsx scripts/probe-meteoalarm-mqtt.ts
 *
 * If you want to point at the test broker for a first check:
 *   METEOALARM_MQTT_BROKER=mqtts://api-test.meteoalarm.org npx tsx scripts/probe-meteoalarm-mqtt.ts
 *   (Note: your token may only work against the production broker —
 *   Round 1 REST probe hit 401 against api-test with the prod token.)
 */

import 'dotenv/config';
import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';

const TOKEN = process.env.METEOALARM_DIRECT_TOKEN;
const BROKER = process.env.METEOALARM_MQTT_BROKER || 'mqtts://api.meteoalarm.org';
const TOPIC = process.env.METEOALARM_MQTT_TOPIC || 'warnings-ALL';
const DURATION_MS = 5 * 60 * 1000;   // 5 minutes
const CONNECT_TIMEOUT_MS = 15_000;

interface AuthAttempt {
  label: string;
  build: (token: string) => Pick<IClientOptions, 'username' | 'password' | 'protocolVersion'>;
}

/** Auth patterns to try, in order. MQTT auth conventions vary — brokers
 *  can use username=token+empty-password, password=token+empty-username,
 *  or fixed username like "token"/"apikey" + password=<token>. We try the
 *  most common first; move on to the next if we get a connection reject. */
const AUTH_PATTERNS: AuthAttempt[] = [
  {
    label: 'username=<token>, no password',
    build: (t) => ({ username: t }),
  },
  {
    label: 'password=<token>, no username',
    build: (t) => ({ password: t }),
  },
  {
    label: 'username="token", password=<token>',
    build: (t) => ({ username: 'token', password: t }),
  },
  {
    label: 'username="apikey", password=<token>',
    build: (t) => ({ username: 'apikey', password: t }),
  },
  {
    label: 'MQTT v5 with Bearer authenticationMethod (advanced)',
    build: (t) => ({
      protocolVersion: 5,
      // v5 has properties.authenticationMethod / authenticationData —
      // the mqtt library exposes these via a properties block. Some
      // brokers accept Bearer this way. This is a "just try it" attempt.
      // If it errors, move on.
      username: t,
    }),
  },
];

interface ProbeResult {
  pattern: string;
  connected: boolean;
  connectError?: string;
  messagesReceived: number;
  firstMessageAtMs?: number;
  sampleMessage?: string;
  distinctTopics: Set<string>;
}

async function tryPattern(pattern: AuthAttempt): Promise<ProbeResult> {
  const result: ProbeResult = {
    pattern: pattern.label,
    connected: false,
    messagesReceived: 0,
    distinctTopics: new Set(),
  };

  console.log(`\n─── Attempt: ${pattern.label} ───`);
  console.log(`   Broker: ${BROKER}`);
  console.log(`   Topic:  ${TOPIC}`);

  const opts: IClientOptions = {
    ...pattern.build(TOKEN!),
    connectTimeout: CONNECT_TIMEOUT_MS,
    reconnectPeriod: 0,   // don't auto-reconnect during the probe
    clientId: `nrsa-probe-${Math.random().toString(36).slice(2, 10)}`,
    rejectUnauthorized: true,
  };

  let client: MqttClient | null = null;
  const connectStart = Date.now();

  try {
    client = mqtt.connect(BROKER, opts);

    // Wait for connect or fail. Race the connect event with a manual timeout.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS + 500);
      client!.once('connect', () => { clearTimeout(t); resolve(); });
      client!.once('error', (err) => { clearTimeout(t); reject(err); });
    });

    result.connected = true;
    const connectDt = Date.now() - connectStart;
    console.log(`   ✓ Connected in ${connectDt}ms`);

    // Subscribe.
    await new Promise<void>((resolve, reject) => {
      client!.subscribe(TOPIC, { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`   ✓ Subscribed to ${TOPIC}. Listening for ${DURATION_MS / 1000}s…`);

    // Wire message handler.
    client.on('message', (topic, payload) => {
      result.messagesReceived++;
      result.distinctTopics.add(topic);
      if (result.firstMessageAtMs === undefined) {
        result.firstMessageAtMs = Date.now() - connectStart;
        // Capture the first message body as a sample.
        result.sampleMessage = payload.toString('utf8').slice(0, 2000);
        console.log(`   ← First message on ${topic} (${payload.length} bytes) after ${result.firstMessageAtMs}ms`);
      } else if (result.messagesReceived <= 5) {
        console.log(`   ← Message #${result.messagesReceived} on ${topic} (${payload.length} bytes)`);
      } else if (result.messagesReceived === 6) {
        console.log(`   ← [further messages logged only at end]`);
      }
    });

    // Progress heartbeat every 30s so the operator knows we're still alive.
    const hbInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - connectStart) / 1000);
      console.log(`   ⏱  ${elapsed}s elapsed — ${result.messagesReceived} messages received`);
    }, 30_000);

    // Run for DURATION_MS.
    await new Promise(r => setTimeout(r, DURATION_MS));
    clearInterval(hbInterval);
  } catch (err) {
    result.connectError = (err as Error).message;
    const connectDt = Date.now() - connectStart;
    console.log(`   ✗ FAILED after ${connectDt}ms: ${result.connectError}`);
  } finally {
    if (client) {
      client.end(true);
    }
  }

  return result;
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_DIRECT_TOKEN not set in .env.');
    process.exit(1);
  }

  console.log('MeteoAlarm MQTT probe — trying auth patterns until one works.');
  console.log(`Duration per successful pattern: ${DURATION_MS / 1000}s.`);
  console.log(`Total worst-case runtime: ~${(AUTH_PATTERNS.length * (CONNECT_TIMEOUT_MS + 500)) / 1000}s of tries + up to ${DURATION_MS / 1000}s listening on the first success.`);

  for (const pattern of AUTH_PATTERNS) {
    const result = await tryPattern(pattern);
    if (result.connected) {
      // Success — report and stop trying further patterns.
      console.log('');
      console.log('══════════════════════════════════════════════════════════════');
      console.log(`  SUCCESS with auth pattern: ${result.pattern}`);
      console.log(`  Broker:                    ${BROKER}`);
      console.log(`  Topic:                     ${TOPIC}`);
      console.log(`  Messages received:         ${result.messagesReceived}`);
      console.log(`  Distinct topics observed:  ${[...result.distinctTopics].join(', ') || '(none)'}`);
      if (result.firstMessageAtMs !== undefined) {
        console.log(`  First message latency:     ${result.firstMessageAtMs}ms after connect`);
      } else {
        console.log(`  No messages arrived during the ${DURATION_MS / 1000}s window.`);
        console.log(`  (Possible reasons: quiet weather, wrong topic, or retained-only.`);
        console.log(`   Try again during a live severe-weather event, or subscribe to`);
        console.log(`   a specific country topic like warnings-DE where DWD reissues`);
        console.log(`   every ~30 min.)`);
      }
      if (result.sampleMessage) {
        console.log('');
        console.log('  First message payload (first 2000 chars):');
        console.log('  ' + result.sampleMessage.replace(/\n/g, '\n  '));
      }
      console.log('══════════════════════════════════════════════════════════════');
      console.log('');
      console.log('Next: paste this output back. Feeds into task #56 architecture');
      console.log('decisions (standalone consumer vs adapter mode, reconciliation');
      console.log('strategy vs REST poll, message-shape parser reuse).');
      return;
    }
    // Otherwise try the next pattern.
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  ALL AUTH PATTERNS FAILED');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Neither username-only, password-only, "token"/"apikey" fixed username,');
  console.log('nor MQTT v5 Bearer worked. Options from here:');
  console.log('  1. The broker may require pre-registration of MQTT client IDs');
  console.log('     (some brokers issue MQTT-specific credentials separately);');
  console.log('     check the MeteoAlarm API portal at https://api.meteoalarm.org/edr/v1/docs');
  console.log('     for MQTT-specific docs or contact their support.');
  console.log('  2. The token may be REST-only. The approval email said "As a Bearer');
  console.log('     token" and "as a query parameter" — no mention of MQTT.');
  console.log('  3. The broker may use TLS client-certificate auth (mqtts:// + cert).');
  console.log('');
  console.log('Task #56 remains blocked until we know the correct auth pattern.');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
