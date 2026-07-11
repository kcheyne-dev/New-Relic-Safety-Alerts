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

## Recommendation

**REVISED after Round 1: HOLD, run Round 2, then likely swap or add fallback.**

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
