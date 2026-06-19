# NRSA / S.T.A.R. View — Project Status (2026-06-19)

**Purpose:** self-contained status writeup prepared as a second-opinion prompt for an external model (Gemini). Captures architecture state, recent decisions, and the specific open questions where outside judgment is wanted.

---

## What this is

**New Relic Safety Alerts** ("S.T.A.R. View") — a global threat-monitoring + crisis-communications dashboard for New Relic's internal Crisis Management Team (CMT). NOT a portfolio piece, NOT a paid-product replacement. It exists to answer three operational questions:

- **Q1 — Office threat:** event with extreme likelihood to affect an office (shelter-in-place / evacuation level).
- **Q2 — Traveler threat:** event with extreme likelihood to affect a traveling employee.
- **Q3 — Business continuity:** event affecting a population large enough to disrupt business (terror attacks, major earthquakes, typhoons).

Q1/Q2 are detection problems. Q3 is a *response* problem — by the time a 9/11-class event happens, operators already know from any news source; the tool's job is computing affected population + drafting comms + tracking responses.

## Current state

**Frontend** — single-page web app, served over `http://localhost:5173` (or GitHub Pages bare). Web stack: Leaflet for the map, vanilla JS, ~600 lines of CSS. Just completed a multi-week modularization: the original 6,485-line inline `<script>` is now 12 ES modules + a 1,366-line `legacy-app.js` (boot wiring + event handlers only). The architecture that made this tractable is a "bridge pattern":

- `main.js` loads as `<script type="module">` BEFORE `legacy-app.js` (deferred classic external script).
- Bridge does `Object.assign(window, module)` for each module's exports, plus `Object.defineProperty` getter/setter for reassignable identifiers (ALERTS, TRAVELERS, EMPLOYEES, etc.).
- Function bodies inside ES modules read bare identifiers like `STATE.feedTab`, `OFFICES.map()`, `addIncidentLog(...)` — these resolve via globalThis fallthrough at call time.
- Net: 161 function extractions across 4 weeks required ZERO function-body rewrites. ~70 names end up on `window`.

**Backend** — Fastify + TypeScript + Postgres 16 + PostGIS. 7 working source adapters (USGS, NWS, EONET, GDACS, EMSC, TfL, WHO Disease Outbreak News), 4 disabled (GDELT noise, MeteoAlarm + FlashAlert URLs 404, ACLED awaiting commercial license). Severity thresholds tuned per-source with a "tight for low-sev, loose for high-sev" philosophy + proximity-gate on borderline events. JWT auth (dev-only — Okta scaffolded but not wired). Sprint 5 (incidents/responses/comms persistence to Postgres, replacing localStorage) closed last week. ~329 active events flowing.

**Test coverage** — Playwright e2e smoke harness (`tests/`) covers boot → login → backfill → alert click → Crisis Comms (real send + test send via the test-message drill mode) → note → close → reopen → Risk Profile open → BCI declare. ~15s end-to-end. Caught a real production race condition (`dispatchSend` skipping the first message persist when create was in flight) on its first run; that's now fixed via a queue+flush pattern. Smoke is happy-path only — does not cover demo cycler, geo-fence math, panel resize, theme toggle.

## Recent work (2026-06-19 evening)

Closed the four optional cleanup tasks that finished modularization:

1. Stripped 177 stub markers (`/* X moved to helpers.js */`) from legacy-app.js.
2. Dropped 21 inline constant duplicates from legacy-app.js (drift-checked vs. constants.js first).
3. Extracted 4 incident state-mutation helpers (createIncident, buildResponseShells, reopenIncident, addIncidentLog) to a new `js/incidents.js`.
4. Replaced two inline IIFEs (~555 lines: demo cycler + synthetic test scenarios) with bridged calls to `js/demo.js`. demo.js had been a session-1 byte-equivalent shadow; this made it the live source.

Independent code review on cleanups #3+#4 came back: **0 BLOCKERs, 1 MED, 7 NITs.** The MED was a documentation gap around the `_pendingMessages` queue flush in `createIncident.then()` — addressed by adding a 24-line comment block explaining the closure-over-`inc` reasoning + the deliberate best-effort failure semantics (queued message fails → toast + drop, vs preserving in localStorage which would risk duplicate sends after a server-side success the client never saw).

## Open architectural questions / things I want a second opinion on

1. **Bridge architecture trade-offs.** ~70 names on `window`. The benefit was zero body rewrites across 161 extractions, which is why the modularization actually shipped. But long-term, is global-namespace pollution a real liability, or is it cosmetic? If the alternative was a multi-week mass-rename project that risks breaking demo / geo-fence / Risk Profile (none of which are smoke-covered), is the bridge the right load-bearing pattern, or am I deferring debt?

2. **Strict-mode read fallthrough confidence.** I'm relying on the fact that ES module function bodies can READ bare identifiers that resolve to globalThis properties (e.g., `STATE` → `window.STATE`), even though strict mode blocks WRITES to undeclared identifiers. Is this guaranteed by the spec across all evergreen browsers, or am I one V8 update away from breakage? (My confidence: high, based on testing across Chrome/Safari/Firefox + the Node ESM bridge sim, but I want a sanity check.)

3. **Queue-flush MED — was the doc-only call right?** The failure mode requires backend success on incident-create + failure on the queued message's send + operator missing the toast. Rare. Persisting failed-queue entries to localStorage for retry would introduce a duplicate-send risk (server success that client never saw → retry on next boot resends). My judgment was that duplicate Crisis Comm > rare lost queued message in the CMT failure-mode hierarchy. Is that the right risk ranking?

4. **Smoke harness coverage gap.** It's happy-path Crisis Comms + BCI + Risk Profile. It does NOT cover: demo cycler (~600 lines of behavior), geo-fence draw/highlight/filter math (Leaflet.draw bindings), panel resize state, theme toggle, error paths (failed sends, network drops), Export Report popup. Is this a tolerable v1 of the harness, or should I be expanding before the next round of feature work?

5. **Production-readiness sequence.** Auth model is dev-only JWT (single biggest production blocker). ACLED license is in flight (user-side). OSAC compliance is blocked on State Dept reply. If I were the project owner, what's the right ORDER to unblock these? Specifically: should I be planning Okta SSO integration NOW to be ready when the people-side approvals land, or wait until they're actually approved before investing the engineering?

6. **CMT colleague drill keeps slipping.** Test-message mode was specifically built for a real CMT colleague to drill the Crisis Comms flow against it (no real channels delivered, full audit trail). It still hasn't happened — keeps getting pushed in favor of more code. Is this a "shipping over polishing" failure mode, or is the polish actually load-bearing for the drill to be useful?

## Stack summary

```
Frontend:  index.html (225 lines) + css/styles.css (600) + 12 ES modules
           + legacy-app.js (1,366) - 6,485 → 1,366 (~79% extracted)
Backend:   TypeScript + Fastify + Postgres 16 + PostGIS, ~25 files,
           7 adapters healthy, JWT auth dev-only
Tests:     Playwright e2e ~15s, happy-path Crisis Comms + BCI + Risk Profile
Persist:   localStorage (UI cache) + Postgres (incidents/responses/comms)
Deploy:    GitHub Pages (mock mode) + local Mac (live mode against
           localhost:8080 backend)
```

## Risk register at end of today

```
✅ Closed:    No tests, race conditions documented but unfixed,
              no backend-down indicator, incomplete persistence migration,
              5,500-line frontend (modularization debt)
🟨 Open:      Auth (dev-only JWT, biggest production blocker),
              smoke harness happy-path-only, no real-operator UAT
🚫 Blocked:   ACLED commercial license (user-side, in flight),
              OSAC compliance answer (State Dept written guidance pending)
```

## What I'm asking for

Read the open architectural questions section. For each one, give me an honest reaction — agree, disagree, or "you're missing X." Don't hedge; I'd rather have a strong opinion to push against than mushy validation.

Specifically interested in: (a) whether the bridge pattern is sustainable or technical debt, (b) whether my queue-flush risk ranking is right or wrong, (c) what the right production-readiness sequence is given the people-side blockers.
