# NRSA / S.T.A.R. View — Action Plan (post-Gemini review, 2026-06-19)

**Source:** External code review by Gemini against `docs/project-status-2026-06-19.md`.
**Purpose:** Captures the actionable items from Gemini's pushback, with honest time estimates, sequencing, and explicit decisions about what NOT to do (with reasoning, so future-you doesn't relitigate).
**Style note:** Each item leads with the decision, then the rationale. If you only read the headers + the "First step" lines, you've got the workplan.

---

## Priority queue (do in this order)

### 1. Schedule the CMT colleague drill — THIS WEEK

**Decision: do it. No engineering. Single highest-leverage move on the queue.**

Gemini named this directly: hiding in the codebase is the failure mode. Test-message mode was built for this drill. The tool passes a 15-second smoke. It's stable enough.

The real question isn't "is the polish load-bearing" — it's "what's the smallest commitment that gets a real CMT colleague in front of the tool this week?" Anything less is procrastination dressed as engineering judgment.

- **Time:** 30 min calendar hold + 30 min walkthrough + 15 min note-taking = 75 min total.
- **Dependencies:** None. Tool is ready.
- **Risk if deferred:** Compounding. The longer this slips, the more the codebase grows and the harder it gets to point at "this is what you'd be drilling against." Worse: a real incident happens and the drill never happened.
- **First step:** Pick a colleague. Send the calendar hold today.

What to drill: walk them through one office-threat scenario (synthetic Tests pill → Office threat scenario → Crisis Comms pre-fill → operator drafts message in test mode → send → see it in the incident). End-to-end is ~10 minutes of clicking. The remaining time is for them to react, push back, and tell you what's confusing.

What to capture: write down every "wait, where's X?" / "what does this mean?" / "I expected Y" moment. Those are the next development sprint, not whatever you'd guess from inside.

---

### 2. Geo-fence + proximity-detection smoke spec — before any new feature work

**Decision: do it. ~90 min. Gates new feature work. Probably before the drill if the drill slips by more than a few days.**

Gemini's reframe was sharp: the math behind the tool's PURPOSE is untested. The tool's job is detecting office/traveler threats, and that detection runs through `enrichEventWithImpact` → proximity check (PostGIS server-side + client-side) → `relevanceTierOf`. The current smoke tests the UI flow downstream of detection, but doesn't assert that an event near an office triggers the right detection state in the first place.

The current Crisis Comms smoke could pass even if detection were silently broken — because the test seeds an alert that already has affectedOfficeIds set on it.

- **Time:** ~90 minutes. Single Playwright spec.
- **What to test:**
  - Inject a synthetic USGS-shaped event at a known office's lat/lng + radiusKm.
  - Assert: alert card renders with the correct office's IATA in the impact badges, `relevanceTier === 'direct'`, the right office's per-office count badge increments on the rail.
  - Inject a second event 800km from any office, sev=`ext`, assert: `relevanceTier === 'watch'`, alert is hidden under default `officeRelevantOnly` filter, becomes visible under `🌐 All`.
  - Inject a third event in a country with NR presence but no office (e.g., Brazil), sev=`high`, assert: `relevanceTier === 'indirect'`, amber chip.
- **Why this gates feature work:** Touching `enrichEventWithImpact` or any of its helpers (alertCountryFor, relevanceTierOf, distanceKm) without this test is risking silent detection regressions. The whole tool is downstream of these.
- **First step:** Open `tests/e2e/` and stub a new spec file `proximity-detection.spec.ts` next to `smoke-crisis-comms.spec.ts`. Look at how the existing spec injects test alerts via the `🧪 Tests` modal — same pattern, just with assertions on the detection output instead of the comms flow.

---

### 3. Failed-message outbox UI — queue, don't start until after drill

**Decision: queue, don't start yet. ~4-6 hours when ready. Wait for drill feedback.**

Gemini's strongest hit: the `_pendingMessages` queue-flush MED finding shouldn't be addressed by docs alone. The right pattern is a third option I missed — a visible failed-outbox UI with a manual retry button. Gives operator agency, eliminates duplicate-send risk AND silent drops.

- **Time:** ~4-6 hours. Persistent UI panel + render path + retry handler + dedup awareness.
- **Why wait for drill:** the drill might reveal that the operator's mental model around Crisis Comms differs from what we built. Could change what "outbox" should look like (separate panel? indicator on the existing log? toast that doesn't disappear?). Building before drill = building blind.
- **Architecture sketch when ready:**
  - New `state.failedOutbox = []` array (gets persisted via stripIncident exclusion list — it's transient state but the operator's choice on retry IS state we want to preserve across reloads).
  - New `failed-outbox` render path in render.js (small panel under Crisis Comms log? Or status-strip indicator?). Drill will inform.
  - On queue-flush failure, push `{msg, apiPayload, failedAt, lastError}` to `state.failedOutbox` instead of dropping.
  - "Retry" button calls `incidentsApi.sendMessage` again with same payload; on success, removes from outbox; on failure, updates `lastError`.
  - "Discard" button removes without retry (operator's call — they may know the message already went through some other channel).
- **First step (when ready):** sketch the UI panel on paper / in screenshots before writing code. Get operator buy-in on the placement.

---

### 4. Okta SSO integration — start now, parallel to everything else

**Decision: start the engineering now. Don't wait for ACLED or OSAC people-side.**

Gemini was right: Okta integration has known long lead times (corporate security review, redirect URI whitelisting, group attribute mapping). The first 80% is doable independent of Workday and produces a real win — staging deploys become possible, which means stakeholders can sign off on something that isn't `localhost:8000`.

Caveat Gemini missed: Okta SSO = authentication. Authorization (who can do what — declare BCI, send Crisis Comms, view audit log) eventually needs Workday for the manager-of org tree. The current JWT has cmt/admin roles; first version of Okta should map Okta groups directly to those roles. Defer the Workday-driven role tree.

- **Time:** ~2-3 weeks part-time. Mostly waiting on corporate security reviews + IdP config; engineering itself is ~16-20 hours scattered across that window.
- **Phasing:**
  - **Phase 1 (engineering, ~8 hrs):** Replace dev JWT issuance in `backend/src/routes/auth.ts` with OIDC redirect flow. Add `/auth/callback` endpoint that exchanges code → tokens → backend session JWT (issued internally; Okta is the IdP, not the session source). Frontend login modal → redirect to Okta instead of password prompt.
  - **Phase 2 (corporate, ~2-3 weeks elapsed):** New Relic Okta admin registers the app, whitelists redirect URIs (localhost:8080/auth/callback for dev + production URL when known), grants group attribute claim. Security review.
  - **Phase 3 (engineering, ~4 hrs):** Map Okta groups → backend roles (`nrsa-cmt`, `nrsa-admin` Okta groups → `cmt`, `admin` JWT claims). Add a "you don't have access" page for users authenticated via Okta but missing the right group.
  - **Phase 4 (deferred, weeks/months):** Workday-driven role tree (manager-of, office-of). Not blocking initial production.
- **First step:** Email someone on New Relic IT/Okta admin asking what the registration process looks like for an internal app. Get the lead time on their end before designing.

---

### 5. Bridge cleanup — incremental, lowest priority

**Decision: do it as background work over the next month. Don't panic-rewrite.**

Gemini's framing ("ticking time bomb") was overheated. The bridge isn't fragile — globalThis resolution is stable, and we don't bundle today, so the bundling-breaks-this concern is conditional.

The REAL debt Gemini named is correct: ES modules read blindly from window-bridged identifiers, which means typos like `STATT` instead of `STATE` slip past static analysis. The fix is incremental — convert bare-reference reads inside helpers/render/modals/etc. to explicit imports of state + sibling functions.

- **Time:** ~6-10 hours of careful work, distributable across multiple sessions.
- **Why incremental:** changing bare references to explicit imports inside ~150 functions across 7 modules is not risky individually, but is risky in aggregate without smoke catching regressions. Do one module per session, with smoke between each.
- **Order:** Start with `helpers.js` (lowest coupling), then `render.js` (biggest payoff but biggest diff), then `modals.js`. Save `incidents.js` and `demo.js` for last (most state coupling, smallest size).
- **What to keep:** legacy-app.js continues to read window globals. That's the bridge's reason to exist. We're only cleaning up the MODULE → window direction, not the legacy-app.js → window direction.
- **First step:** Pick `helpers.js` as the pilot. Convert 2-3 functions per session, run smoke, push. Goal: prove the pattern works before scaling.

---

### 6. Lint hygiene re-enable — gates on bridge cleanup

**Decision: re-enable `no-undef` per module as bridge cleanup lands. Don't enable globally.**

Gemini's lint point is real — disabling no-undef means typos slip through to runtime. But re-enabling it globally would force the bridge cleanup to be done all-at-once, which is what we explicitly want to avoid (see #5).

- **Time:** trivial per module — maybe 15 min each.
- **Sequencing:** as each module gets its bridge cleanup (per #5), add a per-file `/* eslint-disable no-undef */` removal commit. Test that lint passes.
- **First step:** add `eslint` as a dev dep + a basic `.eslintrc` if not already present. Then layer in module-by-module strictness.

---

## What we're explicitly NOT doing (and why)

### Not adopting a bundler (Vite/esbuild/etc.)

Gemini hinted that "transitioning from raw ESM to Vite" would be where the bridge breaks. We're not doing that transition. Native ESM over `npx http-server` works fine for an internal CMT dashboard with single-digit-to-low-tens of concurrent operators. No bundler = no bundle-time errors, no source maps drift, no extra build step. If we ever needed to scale to hundreds of users with cold-start latency concerns, revisit.

### Not pre-emptively rewriting the bridge

Gemini's "ticking time bomb" framing implied urgency. The bridge will continue to work indefinitely as long as we keep using native ESM. The cleanup in #5 is hygiene, not survival. If we ever decided to bundle, that's the trigger to do the cleanup completely.

### Not addressing the no-init-race claim

Gemini flagged a possible initialization race in module function bodies reading bridged globals. Verified false: module top-level code is imports + `export function` declarations only. Function bodies execute on call, after main.js's bridge has finished. The race Gemini worried about doesn't exist in this architecture. Captured here so future-me doesn't relitigate it.

### Not blocking new feature work on bridge cleanup

The bridge is good enough to ship features against. New work can land in the modular structure as it stands today. Bridge cleanup is background polish, not a gate.

### Not building the full Workday-driven role tree yet

Phase 4 of Okta. Defer until Phase 1-3 are real and we've felt the pain of two-role authorization. May find out the simple group-mapping is sufficient for the actual operational need.

---

## Sequencing diagram

```
This week (engineering nearly idle):
  1. Schedule CMT drill ───────────────────────┐
                                                │
  2. Geo-fence smoke spec (90 min) ────────────┤
                                                │
                                                ▼
                                          Drill happens
                                                │
                                                ▼
Week 2-3 (post-drill):                Drill feedback drives
                                       what's most important
                                                │
                                                ▼
  3. Failed-outbox UI (if drill confirms) ─────┐
                                                │
  4a. Okta Phase 1 (engineering) ──────────────┤
  4b. Okta Phase 2 (corporate review) ─────────┤
                                                │
                                                ▼
Week 3-6 (background):                  Whatever the drill
                                          + Okta surface as
                                          actual user pain
  5. Bridge cleanup module-by-module ──────────┐
  6. Lint hygiene per cleaned module ──────────┘
```

---

## What this isn't

This plan is queued work, not a roadmap. None of these items are committed dates. The sequencing reflects current best-judgment given Gemini's review; if the drill surfaces something completely different (e.g., the operator can't find the BCI button), that becomes priority 1 and everything else slides.

The plan also explicitly does NOT capture:
- ACLED license follow-up (user-side, in flight)
- OSAC compliance reply (blocked on State Dept, defer indefinitely)
- New feature work driven by drill feedback (TBD)

Pick this back up by re-reading the priority queue + Gemini's original review (`docs/project-status-2026-06-19.md`).
