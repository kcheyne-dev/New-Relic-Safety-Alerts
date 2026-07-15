# MeteoAlarm direct API vs MeteoGate — comparison + recommendation

**Prompted by:** 2026-07-13 approval email granting direct access to MeteoAlarm's
"EDR & Metadata API" + "Feeds API" (token in `.env`, not this doc).

**Current production adapter:** `backend/src/adapters/meteoalarm.ts` uses
`api.meteogate.eu` (an intermediary hosted by MeteoGate). This document
compares the direct MeteoAlarm APIs against the incumbent MeteoGate approach
to inform whether a swap is worth doing.

**Status:** INVESTIGATION. No production code changes. Requires either docs
review from meteoalarm.org (blocked from Cowork sandbox) or a locally-run
probe script to confirm the direct API's exact shape.

## What we know for certain

| Dimension                        | MeteoGate (current)                        | MeteoAlarm direct (new access)             |
|----------------------------------|--------------------------------------------|--------------------------------------------|
| Base URL                         | `api.meteogate.eu`                         | Likely `feeds.meteoalarm.org` — verify     |
| Auth                             | `apikey: <TOKEN>` header (custom)          | `Authorization: Bearer <TOKEN>` OR `?token=<TOKEN>` |
| Approved surfaces                | EDR (single endpoint family)               | EDR & Metadata API + Feeds API (two separate) |
| Underlying data                  | EUMETNET MeteoAlarm CAP 1.2 messages       | EUMETNET MeteoAlarm CAP 1.2 messages (same producer) |
| Adapter status                   | Shipped 2026-06-29 (`1145eee`), in prod    | None                                       |

## What's likely true (but needs verification)

Based on the "EDR & Metadata API" naming and OGC EDR being an open standard,
the direct API is probably shape-compatible with what MeteoGate serves.
MeteoGate itself is essentially a hosted MeteoAlarm EDR endpoint with API-key
gating; the direct API likely serves the same OGC EDR spec.

Inferences to CONFIRM against docs:

1. **Endpoint paths** — is `/collections/warnings/locations/{loc}` the same?
   Or does direct MeteoAlarm use different collection names?
2. **Coverage** — same 40 locations (`ALL`, `MT`, `SI`, `EE`, ..., including
   `UK`)? Or does the direct feed have different territory scope?
3. **Feature shape** — same INDEX-API pattern (lightweight refs → DigitalOcean
   Spaces hubLinks)? Or does direct include CAP content inline?
4. **Query params** — same `datetime`, `awareness_level`, `awareness_type`,
   `language`, `page` support?
5. **Pagination limits** — 100 features/page? Different?
6. **Rate limits** — MeteoGate has none we've hit; MeteoAlarm direct may have
   documented quotas.
7. **Update cadence** — MeteoGate mirrors upstream in near-real-time (~15
   min). Direct is presumably the same or better since it IS upstream.
8. **Feeds API** — separate from EDR. Probably the classic Atom-XML per-country
   feeds (`feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe`) that we
   abandoned in the 2026-06-29 rewrite. Confirm if this is a valid fallback
   or purely legacy.

## Comparative trade-offs

### Pros of direct MeteoAlarm

- **One less service dependency.** MeteoGate is a hosted intermediary; if
  MeteoGate has an outage, a price change, or a shutdown, we lose weather
  warnings. Direct is the authoritative source.
- **Canonical latency.** MeteoGate ingests + serves. Direct skips the
  intermediary hop.
- **Two APIs available.** EDR for the index-driven approach we already use,
  plus Feeds as a potential fallback path if EDR has an issue.
- **Standard auth** (Bearer). Simplifies our HTTP client — no custom `apikey`
  header handling.
- **Free tier is unlikely to be worse.** Both are gated by approval; both are
  free at the volumes we operate at.

### Cons of a swap

- **MeteoGate is proven in prod.** ~14 days of clean cycle runs including
  live severe-weather peaks (Swiss thunderstorm 2026-06-29). Its edge cases
  are known and handled (supersede filtering, page-full warn, bbox geometry
  clamping).
- **Rewrite cost.** Even if the direct API is OGC-EDR-compliant, the exact
  endpoint paths, response envelopes, and error semantics probably differ
  enough to require a full adapter rewrite + probe scripts + smoke test.
- **Unknown constraints.** Rate limits, quota, page size, feature shape —
  all TBD. A swap without probing first risks silent regressions.
- **`stripIncident`-style attachment hazards.** If direct API includes CAP
  content inline (vs MeteoGate's index-only shape), the response payloads are
  10-100× larger and our per-cycle bandwidth/memory profile changes.
- **CAP-message hosting.** MeteoGate uses DigitalOcean Spaces for CAP JSON.
  If direct uses their own storage, the hubLink URL scheme changes and any
  future direct-fetch code path needs new handling.

### What we'd keep either way

- The `evaluateMeteoAlarm` threshold function (severity mapping).
- The bbox → centroid + radius geometry pipeline.
- The `source_id='meteoalarm'` identity in Postgres — dashboard labeling
  and downstream threshold rules don't need to change.
- The 15-min cycle cadence and idempotent `(source_id, source_event_id)`
  upsert dedupe.

## Round 1 probe findings (2026-07-13, `probe-meteoalarm-direct.ts` output)

**Definitive:** the direct MeteoAlarm EDR API is a full OGC EDR 1.0
implementation that mirrors MeteoGate's shape almost exactly.

- **Auth confirmed:** `Authorization: Bearer <TOKEN>` works. No `apikey`
  header, no query-param token needed.
- **OGC conformance identical to MeteoGate:** `/edr/v1/conformance` returns
  the same seven classes MeteoGate declares (core, collections, HTML,
  GeoJSON, WMO WIS2 publisher). This means the response shape / query
  semantics / pagination model / content negotiation are all the same by
  spec.
- **Single collection: `warnings`.** Same identifier as MeteoGate. Direct
  API description: _"Warnings issued by the MeteoAlarm Members. Only the
  'locations' data query is supported."_ — matches MeteoGate exactly.
- **Data query endpoint pattern:**
  `https://api.meteoalarm.org/edr/v1/collections/warnings/locations` —
  same shape as MeteoGate's `/warnings/collections/warnings/locations`.
  Just a different path prefix (`/edr/v1` vs `/warnings`).
- **Content negotiation matches:** `?f=json` query-param override works
  the same way as MeteoGate. No Accept header trick needed.
- **Output format:** GeoJSON (same as MeteoGate).
- **`/api` endpoint:** discoverable OpenAPI spec at
  `https://api.meteoalarm.org/edr/v1/docs/openapi` (JSON) or
  `/docs/openapi.yaml`. Swagger UI at `/edr/v1/docs`. Fetching + inspecting
  this spec is the fastest way to complete the comparison. TODO for a
  Round 2 probe.

**Also learned:** Metadata API root is an HTML portal (Phoenix LiveView,
same tech as MeteoGate). All initial endpoint guesses (`/locations`,
`/countries`, `/awareness`, `/agencies`) 404'd. The Metadata API's actual
routes must be discovered either via the OpenAPI spec at
`/metadata/v1/docs/openapi` (URL guess — needs probing) or by extracting
`data-phx-link` paths from the portal HTML like the MeteoGate discovery
did (`probe-meteogate-discover.ts` style).

**Strategic implication:** MeteoGate appears to be a re-hosted, API-key-
gated proxy over exactly this direct API. Same conformance classes, same
collection name, same query type, same output format, same content
negotiation. The only meaningful differences are:
- Path prefix (`/edr/v1` vs `/warnings`)
- Auth header (Bearer vs apikey)
- Hosting (api.meteoalarm.org vs api.meteogate.eu)

That means: **an adapter swap is mostly path rewrites + auth header
swap.** The 100+ lines of index-parsing / bbox math / supersede filtering
/ pagination logic already in `backend/src/adapters/meteoalarm.ts` should
carry over 1:1. Estimated diff: <20 lines.

Round 2 probe (endpoints still to verify against direct API):
- `/collections/warnings/locations` — list of territories (expect same
  40 as MeteoGate: ALL, MT, SI, EE, ..., UK, DE)
- `/collections/warnings/locations/ALL?f=json&datetime=<23h>` — actual
  data query. Expect a GeoJSON FeatureCollection with the same index-
  ref shape (alertId, countryCode, hubLink, supersededByAlertId,
  bbox geometry, `links[rel=canonical|json|geometry]`).
- `/api/docs/openapi` (or wherever the direct API hosts its OpenAPI JSON) —
  gets us the full endpoint catalog for both EDR and Metadata APIs.
- Metadata portal HTML extraction — same technique as
  `probe-meteogate-discover.ts` to find the real Metadata routes.

## Round 2 probe findings (2026-07-13, `probe-meteoalarm-direct-round2.ts` output)

**Definitive: the direct EDR API is byte-for-byte response-compatible with MeteoGate at the payload level.**

Concrete confirmations:

1. **Feature property set is IDENTICAL to MeteoGate.**
   Direct API returns (from `properties` of the first feature):
   ```
   OBJECTID, alertId, countryCode, featureType,
   geometryDescription, geometryType, hubLanguage, hubLink, hubTime,
   indexArea, indexFeature, indexInfo,
   supersedeType, supersededAt, supersededByAlertId
   ```
   Compare with MeteoGate memory doc (memory/meteogate_api.md, lines 51-64):
   ```
   alertId, countryCode, hubLink, hubTime,
   supersededByAlertId, supersededAt, supersedeType,
   geometryType, geometryDescription, featureType,
   indexArea, indexFeature, indexInfo,
   hubLanguage, OBJECTID
   ```
   Same 15 properties in different order. Every field the current adapter
   reads is present in the direct response.

2. **CAP backend storage is IDENTICAL.**
   `hubLink` and `links[rel=canonical|json|xml|geometry]` all point at
   `meteo.fra1.digitaloceanspaces.com/api/archive/...` — the same
   DigitalOcean Spaces bucket MeteoGate references. No mystery about
   CAP-fetch semantics or auth: it's a presigned URL, no headers needed,
   and the JSON variant that lets us skip XML parsing is present at
   `links[rel=json]`.

3. **Territory list matches.**
   `/collections/warnings/locations` returns a GeoJSON FeatureCollection
   with the same 40 territory codes (ALL, MT, EE, LT, ..., with
   country-shaped bbox Polygons and titles like "Malta", "Estonia").

4. **Query semantics match.**
   `datetime=<start>/<end>` closed-range works. `language=en` works.
   `?f=json` content negotiation works. Response shape is a standard
   GeoJSON FeatureCollection. Same 100-feature-page implied by returned
   count.

5. **Live volume is comparable.**
   23h window over ALL: 100 features returned, 38 superseded (38%).
   MeteoGate's 2026-06-29 sample showed 100 returned / 81 superseded
   (81%). Different supersede ratio is normal variance in different
   weather days — same shape, same semantics, just different alert
   populations.

6. **OpenAPI spec 404s at the discoverable path.** `/edr/v1/docs/openapi`
   returned 404 despite `/api` linking there. Suggests the docs URL
   might have moved, or docs are served only via the Swagger UI HTML.
   Not blocking — the /ALL response shape gives us everything we need.

7. **Metadata API is unclear.** Portal HTML extraction found only
   `/metadata/v1/changelog` linked (which itself returns HTML). Whatever
   the Metadata API's real routes are, they're not discoverable from
   the LiveView portal. Since our EDR use case doesn't need metadata
   right now, this is a follow-up for later, not a blocker.

## Round 3 probe findings (2026-07-13, Swagger UI extraction)

Round 3 fetched `/edr/v1/docs` (the Swagger UI page) and extracted the embedded OpenAPI spec URL from its JavaScript config. Findings:

1. **EDR OpenAPI spec is at `/edr/v1/docs/openapi.yaml`.** Round 2's guess at `/docs/openapi` (no extension) 404'd; the real URL is the `.yaml` suffix. Also implied to exist at `/docs/openapi.json` per Round 1's `/api` response but that returns 404 — YAML is the only format live.

2. **Metadata API `/metadata/v1/docs` returns 404.** No Swagger UI for Metadata. Either it's not publicly documented, or docs live at a non-standard path. **Concluded: treat Metadata API as a black box.** Not blocking the EDR swap; a future exploration if a specific capability from Metadata becomes valuable.

3. **API scale.** OpenAPI info block says "aggregates and accessibly provides warnings from 38 European National Meteorological and Hydrological Services" — matches the 40 territory codes we observed (38 countries + ALL + likely a "test" entry).

4. **Multiple environments available.** OpenAPI servers list:
   - Production: `https://api.meteoalarm.org/edr/v1`
   - Test: `https://api-test.meteoalarm.org/edr/v1`
   - Staging: `https://api.met.dev/edr/v1`
   
   Test/staging are useful for validating adapter changes without production impact — currently we don't have that option with MeteoGate.

5. **BIG FINDING: MQTT real-time streams.** OpenAPI documents a real-time push path via MQTT that MeteoGate doesn't advertise:
   - Broker: `mqtts://api.meteoalarm.org`
   - Test broker: `mqtts://api-test.meteoalarm.org`
   - Message format: GeoJSON
   - Auth: token
   - Topics: `warnings-ALL`, `warnings-MT`, `warnings-SI`, `warnings-EE`, `warnings-SE`, `warnings-FR`, `warnings-LT`, `warnings-PL`, `warnings-RO`, `warnings-IT`, ... one topic per territory + `-ALL`
   
   Current adapter polls REST every 15 min. MQTT subscribe would be true real-time with sub-second latency for new warnings. **Not a Day-1 swap concern** — MQTT adds a long-lived connection, reconnect logic, broker credentials — but it's a compelling reason to prefer the direct API long-term. Would need a separate adapter mode or a parallel MQTT-consumer service.

## Full OpenAPI spec review (2026-07-13, `/edr/v1/docs/openapi.yaml`)

Ran `fetch-meteoalarm-openapi.ts` to dump the full 19KB YAML to disk and read it end-to-end. Definitive findings that supersede earlier inferences:

### Documented endpoints (only 3 in the spec)

1. `GET /` — MQTT documentation only (not a data endpoint).
2. `GET /collections/warnings/locations` — territory list.
3. `GET /collections/warnings/locations/{locationId}` — data query.

The OGC boilerplate endpoints we hit in Round 1 (`/conformance`, `/collections`, `/api`) DO exist and respond — they just aren't documented in this spec. That's consistent with OGC EDR spec-conformant servers exposing the common paths implicitly.

### Auth: two schemes documented, both accepted

- `bearerAuth`: `Authorization: Bearer <token>` — declared as JWT format in the spec, but the actual issued token (`bB7Zo…`, 32 chars) is NOT JWT-shaped (no dots). The `bearerFormat: JWT` in the spec is aspirational or historically inaccurate. Works fine as opaque bearer.
- `tokenQuery`: `?token=<token>` — alternate for URL-only contexts. Not needed for our use case.

### Query parameters (the concrete contract)

| Param             | Required | Format                                              | Notes                                                                    |
|-------------------|----------|-----------------------------------------------------|--------------------------------------------------------------------------|
| `datetime`        | **YES**  | ISO8601 interval `<start>/<end>` (both required)    | Filters by SENT time. Current adapter already sends this correctly.       |
| `active`          | no       | ISO8601 interval, one endpoint may be omitted       | **NEW capability** not documented in MeteoGate. Filters by ACTIVE (effective) time, potentially simpler than sent-range + local filtering. |
| `page`            | no       | integer (no upper bound documented)                 | Same pagination as MeteoGate.                                             |
| `language`        | no       | locale format like `en-GB`, NOT bare `en`           | **Format differs from MeteoGate.** Current adapter sends `language=en`; needs to send `en-GB` (or omit) for direct API. |
| `awareness_type`  | no       | pipe-separated values, format `14; Marine-Hazard`   | Different from MeteoGate's comma-separated ints; MeteoAlarm CAP Profile v2.0 defines the codes. |
| `awareness_level` | no       | pipe-separated values, format `2; yellow; Moderate` | Same story — different separator + verbose string format.                 |

### Location codes: 38 in the spec (vs MeteoGate's 40)

Direct API enum: `ALL, SE, SI, RO, MK, PL, FR, EE, GR, LU, LT, IT, DE, ES, BA, NL, CH, FI, PT, RS, MD, SK, HR, BG, IE, CZ, LV, IS, HU, UK, BE, DK, ME, AT, MT, CY, IL, UA` = 38 total.

MeteoGate memory (2026-06-29 sample) listed 40: same as above **plus `NO` (Norway) and `AD` (Andorra)**. The direct API doesn't advertise those two. Not a coverage gap in practice — those countries have low warning volume — but worth noting if operators explicitly filter to `NO` or `AD`.

### Response schema is INCOMPLETE compared to actual response

The spec's `featureGeoJSON.properties` schema documents:
```
OBJECTID, alertId, countryCode, featureType, geometryDescription,
geometryTyoe (SIC — typo, actual field is geometryType),
hubLink, hubLanguage, indexArea, indexFeature, indexInfo
```

Round 2's empirical response ALSO returned:
```
hubTime, supersedeType, supersededAt, supersededByAlertId
```

These 4 fields exist in the wire response but the OpenAPI spec doesn't document them. Empirical > spec — the current adapter's supersede-filter logic is safe because the fields ARE present in the actual response, just undocumented.

### Storage backend URL disagrees with empirical

Spec example: `https://storage.meteoalarm.org/api/warnings/...`
Round 2 empirical: `https://meteo.fra1.digitaloceanspaces.com/api/archive/warnings/...`

Different hosts. Either the spec is outdated or `storage.meteoalarm.org` is a CNAME to the DigitalOcean bucket. The adapter should always follow whatever URL `hubLink` / `links[]` returns and never hardcode either host.

### Error responses

Documented: `401 Unauthorized` (JSON: `{code, description?}`), plus a `default` catch-all (JSON or HTML). NO documented `429` (rate limit), NO `5xx` schemas. Rate limits are not documented anywhere in the spec — matches MeteoGate's (also undocumented) behavior. Same operational posture: assume no throttling; watch for it in prod.

### MQTT (fuller confirmation)

- 37 country topics (`warnings-XX`) + `warnings-ALL`. Matches location enum minus ALL.
- QoS 0 (fire-and-forget; some warning loss possible on a hiccup). At the 15-min-poll cadence we have today, warnings are eventually picked up by the next poll — but if we go MQTT-only, we should periodically REST-poll as a reconciliation pass.
- WIS2 topic hierarchy: `origin/a/wis2/eu-eumetnet-warnings/data/core/weather/advisories-warnings` for `warnings-ALL`. Metadata at `origin/a/wis2/eu-eumetnet-warnings/metadata`.

### Impact on the swap (task #54)

Ports that need adjustment beyond "path + auth header":

1. **`language` param**: change `en` → `en-GB` OR drop it. Test both empirically.
2. **`awareness_level` / `awareness_type` param format**: if the current adapter uses these (memory says `awareness_level=3,4` was probed but not sure if it's in-adapter today), the separator + value format both change. Grep the adapter to confirm.
3. **Location codes**: existing adapter uses `ALL` — fine. If any special-case logic references `NO` or `AD`, revisit.
4. **Everything else** — path, auth, response parsing, supersede filtering, bbox math, JSON-variant fetch, geometry link — carries over 1:1.

## MQTT probe results (2026-07-15, `probe-meteoalarm-mqtt.ts` output)

Followed up on the OpenAPI's MQTT section with a 5-minute subscription probe. Definitive findings for architecting a future consumer:

**Auth pattern confirmed:** MQTT CONNECT with `username="token"` (literal string) + `password=<API_TOKEN>`. The other four patterns tried (token-as-username, password-only, `apikey` username, MQTT v5 Bearer) all failed with `Bad username or password`. The fixed literal `"token"` username is a quirk but reliably works.

**Message shape confirmed byte-for-byte compatible with REST /locations feature.** Each MQTT message is a single Feature (not a FeatureCollection). Same `properties`: OBJECTID, alertId, countryCode, featureType, geometryDescription, geometryType, hubLanguage, indexArea/Feature/Info. Same `links[rel=canonical|json|xml|geometry]` array. Same `meteo.fra1.digitaloceanspaces.com/api/archive/*` presigned URLs for CAP payloads. Two additional top-level fields on MQTT messages that REST doesn't have:
- `properties.rights` — WMO Unified Data Policy attribution notice string.
- `properties.pubtime` — broker-publish timestamp (distinct from `datetime` which is the event-issued time).

Since the message body is a full index-ref Feature, the existing REST adapter's helpers (`unionBboxCentroidAndRadiusKm`, `pickInfo`, `evaluateMeteoAlarm`, JSON-variant fetch via `links[rel=json]`) all apply unchanged. Only the transport wrapper differs.

**Live sample: 20 messages in 5 min.** First message arrived 157s after subscribe (broker sends no retained state; only live traffic from connect onward). Once activity started, delivery was bursty — 19 messages in the first 30s (likely one agency batch-reissuing), then 1 more, then quiet.

**Payload size:** ~2.7 KB per message. Same magnitude as an individual REST Feature. No compression noted.

**No retained messages** on connect. If a consumer disconnects and reconnects, any messages published during the gap are lost. **Implication:** MQTT alone cannot be the sole transport for a system that needs at-most-a-few-minutes staleness. REST poll must keep running as the reconciliation pass. This is the classic MQTT gotcha — QoS 0 + no retention = at-most-once with no recovery.

## MQTT consumer architecture (Task #56)

Based on the probe, the recommended shape is:

**Both transports run in parallel, MQTT-primary + REST-secondary.**

- **MQTT consumer:** new module `backend/src/consumers/meteoalarm-mqtt.ts`. Subscribes on backend boot; keeps a long-lived connection with reconnect-on-drop. On each message: fetch CAP JSON via `links[rel=json]`, run through the existing `pickInfo` + `evaluateMeteoAlarm` + `unionBboxCentroidAndRadiusKm` pipeline (imported from the current REST adapter — refactor those helpers into a shared module), emit a single-item batch to `persistBatch`. Idempotent on `(source_id, source_event_id)` so if the same alert also arrives via REST poll, the second write is a no-op.
- **REST adapter:** keeps its current 15-min cadence. Serves as the reconciliation pass — catches anything MQTT missed during a disconnect / reconnect window, plus supersede-filter recovery.
- **Gating:** new env var `METEOALARM_TRANSPORT=rest|mqtt|both`. Default `rest` (current behavior). Ops enables `both` to start dual-transport, monitors for a few days, then optionally switches to `mqtt` only if REST redundancy proves unnecessary (I recommend keeping `both` permanently — the reconciliation value is real).
- **Idempotency:** relies on the existing `persist.ts` upsert on `(source_id, source_event_id)`. Same alert arriving via both transports → single row, last write wins on any field diffs.
- **Consumer lifecycle:** starts in `server.ts` boot after DB connected. On SIGTERM cleanly disconnects. Reconnect loop uses exponential backoff on failures.

Latency win vs REST-only: sub-second push instead of up-to-15-min poll. Cost: one long-lived TLS connection + a small `mqtt` library dep (already added devDep).

## Recommendation

**FINAL after MQTT probe: SWAP the EDR path (done — commit f670b7d + 0090773) and build the MQTT consumer as an ADDITIVE transport gated by METEOALARM_TRANSPORT.**

The evidence:
- Response shape is byte-for-byte MeteoGate-compatible.
- CAP storage backend is literally the same DigitalOcean bucket.
- Auth pattern is standard (Bearer) — simpler HTTP client code.
- One less service dependency (retiring MeteoGate).
- Direct is upstream — one fewer layer that can have outages or policy
  changes.
- Estimated code delta: <20 lines, no logic changes.

Implementation approach — **make it configurable, not hard-coded**:

1. Introduce a `METEOALARM_PROVIDER` env var accepting `meteogate` or
   `meteoalarm-direct`. Defaults to `meteoalarm-direct` (new primary).
2. Adapter reads `MeteoAlarm.baseUrl` + `MeteoAlarm.authHeader` derived
   from the provider var, defaulting the auth to `Authorization: Bearer`
   for direct and `apikey: <TOKEN>` for MeteoGate.
3. Both tokens stay in `.env` under separate names so we can flip
   providers by changing one env var without editing code or re-issuing
   credentials.
4. Ship the swap behind the config flag; roll back is one env-var flip
   + restart.

Non-blocking follow-ups (future sessions):
- Discover the Metadata API's real routes (probe from Swagger UI HTML
  rather than the LiveView portal). Adds capabilities beyond MeteoGate
  parity if the metadata is useful for threshold tuning or
  operator context.
- Fetch + review the OpenAPI JSON if we can find its real URL — would
  document any rate limits or quota semantics we've inferred but not
  confirmed.

## Legacy: original recommendation (superseded above by Round 2)

**HOLD the swap, capture the token, run one probe.**

The direct API is almost certainly a viable swap target given the
OGC-EDR conformance match. But before recommending the swap definitively:

1. **Round 2 probe** should confirm the response shape at
   `/collections/warnings/locations/ALL` is identical to MeteoGate's. If
   it is, the adapter change is mechanical (path rewrite + auth header
   swap, both isolated to a handful of lines).
2. **OpenAPI spec fetch** documents the full contract — including
   pagination limits, rate limits, and error semantics that we've inferred
   from MeteoGate but haven't confirmed on the direct source.
3. **Metadata API exploration** may unlock capabilities MeteoGate doesn't
   expose (e.g., agency-level metadata, awareness taxonomies) that could
   improve threshold tuning or operator context.

Only after those three do we have enough to decide swap vs fallback
definitively.

Concrete next steps:

1. **Store the token** in `backend/.env` as `METEOALARM_DIRECT_TOKEN` (name
   different from `METEOGATE_API_KEY` so the two are unambiguous). Confirm
   `.env` is in `.gitignore`.
2. **Write one probe script:** `backend/scripts/probe-meteoalarm-direct.ts`.
   Attempt a health/discovery call against `feeds.meteoalarm.org` (or the
   URL from your approval email — check the docs link). Determine:
   - What's the base URL?
   - What's the discovery endpoint (OGC EDR `/collections`?)
   - What's the shape of a single warning fetch?
   - Do we get inline CAP content or index-style refs?
3. **Compare to MeteoGate** — write a second probe against `api.meteogate.eu`
   using the existing token, hit the same conceptual endpoints, diff the
   responses.
4. **Then decide.** If direct is OGC-EDR-compliant and the response shapes
   overlap 90%+ with MeteoGate, a swap is a couple hours of adapter work.
   If it's meaningfully different, keep MeteoGate and pocket the direct
   token as a fallback (option D from the AskUserQuestion).

**Why not swap now:** MeteoGate is running fine; the direct API's exact
shape is unknown; a rushed swap risks the "worked in prod for 2 weeks"
adapter being replaced by an untested one during a real severe-weather
event.

**Why not throw the token away:** having direct access is a strategic hedge.
If MeteoGate has an incident or a policy change, we have a fallback path
that's already authorized and just needs an adapter build-out.

## What the user needs to do (post-investigation)

- If you have a URL for the direct API docs, share it — I can either fetch
  it (some domains may work) or you can paste key sections into chat.
- Or run the probe script locally once we've drafted it and paste the
  responses. Same technique used for the original MeteoGate discovery
  (see `backend/scripts/probe-meteogate-*.ts`).
