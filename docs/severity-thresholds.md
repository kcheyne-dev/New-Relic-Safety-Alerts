# Severity Thresholds — Per-Source Rules

**Status:** v1, 2026-06-06. Single source of truth for the rules that turn raw feed data into the four-tier severity used by the dashboard (`low | mod | high | ext`) and decide which events are worth ingesting at all.

**Implementation:** [`backend/src/pipeline/thresholds.ts`](../backend/src/pipeline/thresholds.ts). Every adapter calls its evaluator. The proximity pass in [`pipeline/persist.ts`](../backend/src/pipeline/persist.ts) applies the second-stage geographic filter for events tagged `requiresProximityKm`.

## Why this exists

The CMT use case ([memory: project_nr_safety_alerts](../README.md)) is to answer three operational questions:

- **Q1 — Office threat:** event with extreme likelihood to affect an office (shelter / evacuate)
- **Q2 — Traveler threat:** event with extreme likelihood to affect a traveling employee
- **Q3 — Business continuity:** mass-casualty / mass-disruption event affecting employee population

"Extreme likelihood to affect" is a much higher bar than the default severity mappers gave us. Pre-tightening, EONET alone polluted the dataset with 6,700 stale or non-actionable events. Each source needs its own rules so the firehose only carries what could plausibly clear that bar.

## Tuning principle

**Tight for low-sev, loose for high-sev.**

- High-severity events (M6+, GDACS Red, NWS Extreme, State Dept L4, ACLED 5+ fatalities) pass globally. Zero proximity gating, zero category filtering. We accept all noise at the top end because false negatives are unacceptable.
- Mid-severity events (M5–6, GDACS Orange, NWS Severe, State Dept L3, ACLED 1–4 fatalities) pass globally as well — these are the meat of the use case.
- Low-severity events (M4.5–5, GDACS Green, NWS Watches/Advisories, State Dept L1–2, ACLED 0-fatality riots) get aggressive filtering: most drop at ingest; a few survive only if they're geographically close to an office.

This asymmetry is deliberate. CMT culture errs on over-alerting, but operator attention is the scarcest resource on the team. Anything that doesn't clear "could plausibly affect an office or traveler" gets dropped before it ever reaches the dashboard.

## Two-stage evaluation

Most rules can be applied at the adapter (no DB needed). Some require knowing the distance to the nearest office, which is computed by PostGIS in `persist.ts`. To handle both cases, evaluators return:

```ts
{
  pass: boolean,                  // false = drop entirely
  severity: Severity,             // overrides adapter default
  requiresProximityKm?: number,   // if set: drop if no office within this distance
  reason: string,                 // for logs / future "why was this dropped?" UI
}
```

Adapter drops the event immediately if `pass=false`. If `requiresProximityKm` is set, the event flows into persist.ts, which does an extended PostGIS check and drops the event if no office sits within that radius. The default office-match radius (set per category in `persist.ts`) handles "officeIds for display" — `requiresProximityKm` is a separate, looser radius used only for the threshold gate.

## Rules by source

### USGS / EMSC — Earthquakes

USGS feed URL is hard-coded to M4.5+/week. EMSC feed is `minmag=4`. These thresholds further tighten that.

| Magnitude | Depth | Severity | Proximity gate | Rationale |
| --- | --- | --- | --- | --- |
| ≥ 6.5 | any | **ext** | none — pass globally | Major damage, mass impact, regional+ |
| 6.0–6.4 | any | **high** | none — pass globally | Significant shaking, damage likely |
| 5.5–5.9 | any | **high** | none — pass globally | Felt across hundreds of km |
| 5.0–5.4 | any | **high** | 500 km from any office | Strong but localized; only relevant if near a hub |
| 4.5–4.9 | ≤ 30 km | **mod** | 250 km from any office | Shallow quakes are felt at the surface; require near-office |
| 4.5–4.9 | > 30 km | — | drop | Deep small quakes rarely felt at surface |
| < 4.5 | any | — | drop | Below feed threshold; should not appear |

EMSC's `evtype != 'ke'` (suspected, induced, etc.) drops at the adapter as today.

### NWS — US National Weather Service

CAP severity is the cleanest signal. We keep Severe and Extreme; drop the rest. Watches, Advisories, and Special Weather Statements are explicitly out of scope.

| CAP severity | Severity | Action | Notes |
| --- | --- | --- | --- |
| Extreme | **ext** | pass globally | Tornado/Hurricane/Tsunami Warning, Flash Flood Emergency |
| Severe | **high** | pass globally | Severe Thunderstorm Warning, Flash Flood Warning, Excessive Heat Warning |
| Moderate | — | drop | Watches, low-impact Advisories — out of scope |
| Minor | — | drop | Special Weather Statement, low-end Advisories |
| Unknown | **high** | pass if event name ends with "Warning"; else drop | Fallback for malformed feeds |

Cancel-message types and `status != 'Actual'` already drop at the adapter.

### GDACS — Global Disaster Alert Coordination

GDACS publishes a vetted 3-tier severity already. We accept the top two.

| Alert level | Severity | Action |
| --- | --- | --- |
| Red | **ext** | pass globally |
| Orange | **high** | pass globally |
| Green | — | drop |

Adapter currently passes Green/Orange/Red into the pipeline; this rule drops Green at evaluation time.

### EONET — NASA Earth Observatory Natural Event Tracker

EONET doesn't publish severity, just categories. Most categories are not corporate-CMT-actionable on their own. EONET's role in this system is **cross-source corroboration plus volcanic activity**, nothing else.

| Category | Severity | Proximity gate | Action |
| --- | --- | --- | --- |
| volcanoes | **high** | none — pass globally | Rare; usually meaningful even if no office nearby |
| severeStorms | **mod** | 250 km from any office | Cyclones/hurricanes worth flagging only if near hub |
| wildfires | **mod** | 250 km from any office | RX/prescribed already filtered upstream |
| floods | **mod** | 250 km from any office | Mostly long-running events |
| earthquakes | **low** | 250 km from any office | USGS/EMSC are primary; EONET is corroboration |
| drought, dust, snow, sea-lake-ice, water-color, manmade, tempExtremes | — | drop | Below threshold for CMT response |

EONET's existing recency floor (default 2 days, env `EONET_MAX_AGE_DAYS`) and prescribed-fire title filter remain in place upstream.

### State Department — Travel Advisories

| Travel level | Severity | Action |
| --- | --- | --- |
| 4 — Do Not Travel | **ext** | pass globally |
| 3 — Reconsider Travel | **high** | pass globally |
| 2 — Exercise Increased Caution | — | drop |
| 1 — Exercise Normal Precautions | — | drop |

Memory note: Q2 (traveler threat) is the consumer of this source. L2 advisories are essentially "be a normal tourist" and would drown out genuine warnings. L1 was already dropped.

### ACLED — Armed Conflict Location & Event Data

ACLED is the high-quality civil-unrest source — vetted, real lat/lng, fatalities count. The current adapter already implements a sensible severity ladder. We add a proximity gate to suppress zero-fatality noise.

| Event type | Fatalities | Severity | Proximity gate |
| --- | --- | --- | --- |
| Battles / Explosions/Remote violence / Violence against civilians | ≥ 5 | **ext** | pass globally |
| Battles / Explosions/Remote violence / Violence against civilians | 1–4 | **high** | pass globally |
| Battles / Explosions/Remote violence / Violence against civilians | 0 | **mod** | 500 km from any office |
| Riots | ≥ 5 | **high** | pass globally |
| Riots | 1–4 | **mod** | pass globally |
| Riots | 0 | — | drop |
| Strategic developments | > 0 | **high** | pass globally |
| Strategic developments | 0 | — | drop |

The adapter already drops generic "Protests" and any `event_type` outside the five-category whitelist.

### MeteoAlarm — European weather warnings

| Color | Severity | Action |
| --- | --- | --- |
| Red | **ext** | pass globally |
| Orange | **high** | pass globally |
| Yellow | — | drop |
| Green | — | drop |

Mirrors the NWS "Warnings only" stance. Yellow-level MeteoAlarm warnings are advisory and would dominate the European feed without adding signal. Currently the adapter drops `low` (green); this tightens to also drop `mod` (yellow). MeteoAlarm is HTTP 406 broken at the moment, but the rule applies the day it comes back.

## How proximity gating works

When `requiresProximityKm` is set, `persist.ts` runs a second PostGIS `ST_DWithin` query against `offices.geom` at that radius. If the result is empty, the event is dropped entirely (counted in `stats.skipped`). This is independent of the per-category radii used to populate `affected_office_ids` — that field is for "highlight on the dashboard" while `requiresProximityKm` is for "is this worth ingesting at all".

For travelers and remote employees, the proximity gate is intentionally office-only in v1. Once Workday/Navan are wired in, a second gate can compare against current traveler positions and dense remote-employee clusters to satisfy Q2/Q3 directly. Until then, treat travelers as office-attached.

## Tuning knobs

All proximity radii live in `pipeline/thresholds.ts` as named constants. Recommended tuning sequence if false-negatives surface:

1. Loosen the proximity radius for the affected source (e.g. ACLED 500 → 800 km).
2. Promote the borderline severity tier (e.g. M5.0–5.4 from "high near 500 km" to "high globally").
3. Add a new severity tier for niche cases rather than expanding existing ones.

If false-positives surface (operator reports too much noise):

1. Tighten the proximity radius.
2. Promote `requiresProximityKm` to a hard `pass: false` for the bottom tier.
3. Add a category-specific exclusion in the adapter, not the threshold module.

Don't relax CAP severity, ACLED fatality bands, or GDACS alert levels — those are vetted external classifications and we lose more than we gain by overriding them.

## Rules NOT applied at threshold time

These are policy decisions handled elsewhere; listed here so this doc is the index:

- **Recency / staleness** — `workers/sweeper.ts`, measured from `issued_at` (env `STALE_AFTER_DAYS`, default 2)
- **Expiry** — `routes/events.ts` query filter on `expires_at > now()`
- **Office-relevant toggle** — frontend `STATE.officeRelevantOnly` filter, not a backend gate
- **Cross-source clustering** — `pipeline/cluster.ts` (separate concern: dedup, not severity)

## Open questions for future tuning

- **Country-level employee headcount.** Once Workday delivers per-country headcount, we can promote events that would otherwise drop because they're nowhere near an office but in a country with a meaningful remote-employee population. This is the missing piece for Q3 (business continuity).
- **Severity decay with age.** Currently severity is fixed at ingest. A 6-day-old "high" advisory probably isn't urgent anymore. Sweeper handles drop-dead, but a soft demotion (high → mod after 48h, mod → low after 72h) would let the operator focus on fresh events without losing context.
- **Per-source override of ACLED 500 km.** APAC offices are sparse (TYO/BLR/HYD/SIN-eventual). 500 km may underweight events relative to the country. Consider per-region radii once we have enough operational data.
