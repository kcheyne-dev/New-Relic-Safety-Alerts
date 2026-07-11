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

## Recommendation

**Hold the swap, capture the token, run one probe.**

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
