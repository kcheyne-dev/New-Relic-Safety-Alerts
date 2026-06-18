# NRSA / S.T.A.R. View — Project Review

**Date:** 2026-06-16
**Audience:** Project owner; carry into a future session.
**Purpose:** Honest, broad assessment of the project at this point in its life, plus prioritized UI recommendations. Read alongside `docs/data-sources.md`, `docs/severity-thresholds.md`, `docs/modularization-plan.md`, `docs/osac-integration-plan.md`.

---

## TL;DR

The project is in better shape than most prototypes at this stage of life. The use case is clearly framed (Q1 office / Q2 traveler / Q3 BCI), the data plumbing works for 10 of 14 adapters, severity-tuning philosophy is sophisticated, and the mock-data discipline is unusually disciplined for a prototype. Sprint 5 (Postgres-persisted incidents) closed the largest single architectural gap.

What's holding it back from being production-ready isn't the feature set — it's the foundations underneath: a 5500-line single-file frontend with no tests, a still-incomplete persistence migration, a local-JWT auth model, two hard ToS blockers (ACLED license, OSAC compliance), and zero real-operator UAT.

UI is solid and the operator-facing aesthetic works. The valuable UI work right now is *polish and signal-clarity* — not restructuring. The "Monday morning" wins are small, cheap, and high-leverage.

---

## What's working well

**Use-case framing.** Most safety dashboards blur the three things this project keeps distinct: localized threat to an office, localized threat to a traveler, and large-scale business-continuity-class events. Q3 is correctly identified as a *response* problem (declarative trigger + scope computation), not a detection problem. That's a sharper design than what comparable commercial tools ship with.

**Severity-tuning philosophy.** "Tight for low-severity sources, loose for high-severity" is the right instinct for a CMT tool, and the per-source threshold tables in `pipeline/thresholds.ts` reflect it. The proximity-gate pattern (extended `ST_DWithin` for borderline events) is a clean architectural choice — doesn't pollute clusters, doesn't require per-source bespoke logic.

**Mock-data discipline.** Three independent "people" sources (`OFFICE_HEADCOUNTS_MOCK`, `TRAVELERS_MOCK`, `REMOTE_EMPLOYEES_MOCK`) each gated behind `#api=mock`, each with honest "pending Workday/Navan integration" placeholders in live mode. No fake numbers leak into live. When the integrations land, the swap is data-only. This is above-average prototype hygiene.

**Backend health.** 10 adapters ingesting cleanly (USGS, NWS, EMSC, EONET, GDACS, TfL, SF Police, ATL APD, State Dept, WHO DON), cross-source clustering working (EMSC contributing to USGS quake records), severity bars correctly tightened so zero `mod`-tier noise is reaching the operator. The 2026-05-31 audit (~7000 events → ~329 trustable) was the right surgery at the right time.

**Sprint 5 persistence.** Incidents / responses / notes / messages / comms log now in Postgres, fire-and-forget mutation pattern with appropriate revert-on-failure, audit-logged, role-protected. End-to-end verified. Incident state finally survives a backend restart, which is table stakes for a real CMT tool.

**ToS posture overall.** With the exception of the two hard blockers, the project doesn't ride free on commercial sources, doesn't strip attributions, and doesn't redistribute restricted content. That's a defensible production starting point.

**Documentation discipline.** `docs/severity-thresholds.md`, `docs/modularization-plan.md`, `docs/osac-integration-plan.md`, the new `docs/data-sources.md`, plus the user manual — most prototypes don't have any of this. The plans-deferred-to-doc pattern (modularization, OSAC integration) is the right way to keep momentum without losing context.

---

## Architectural concerns

**Single-file frontend is starting to creak.** ~5500 lines of HTML+CSS+JS in `index.html`. The recent comment-delimiter syntax error from a clipped block was an early tell. Each session compounds the risk of silent regression because there's no automated catch. The modularization plan in `docs/modularization-plan.md` is the right answer; the realistic scope is 8-10 hours of focused work, which is why it's been deferred. **It should not be deferred forever** — every new feature widens the per-edit blast radius.

**No tests anywhere.** For a tool that will be in operator hands during a real crisis, this is the most uncomfortable gap. A minimal Playwright smoke harness (boot live mode → log in → backfill events → render alert feed → click an alert → open Crisis Comms → send a message → verify incident created) would catch ~80% of the silent regressions the modularization plan is otherwise vulnerable to. **Recommendation:** add this *before* modularizing, so the modularization has a safety net.

**State coherence between localStorage and Postgres.** Sprint 5 moved incidents/responses/messages/notes to Postgres. Still in localStorage: panel widths, drafts, custom templates, custom locations, room state, JWT, theme preference. The boundary is reasonable (UI preferences in localStorage; operational state in Postgres) but isn't documented anywhere except inferred from the code. Worth writing down so a future session doesn't accidentally migrate the wrong things.

**Auth model is dev-only.** Locally-issued JWT with a hardcoded dev secret in `.env.example`, two test users, no SSO. `OKTA_ISSUER` / `OKTA_AUDIENCE` / `OKTA_JWKS_URI` env vars are scaffolded but unused. For a tool that surfaces traveler PII (when Navan lands) and triggers mass communications, this is the single biggest production blocker after ToS. **Action:** Okta integration should be sequenced before any non-prototype rollout.

**No "backend down" indicator.** The 2026-06-10 incident (backend down 4 days, only noticed because alerts looked stale) is exactly the kind of failure mode a CMT tool can't have. The status strip's "Sources health X/15" was designed to surface adapter failures, not backend-frontend disconnection. A "last successful fetch X minutes ago" indicator in the chrome would have caught it immediately.

**Race conditions are documented but unfixed.** The Crisis Comms / new-incident race (send first message → operator clicks "Send Another" before create round-trip completes → second message persist skipped) is a known issue queued for ~30 min of work. It's the right kind of bug to fix now while it's small, before someone hits it in a real incident.

**4 of 14 adapters are inert.** MeteoAlarm + FlashAlert disabled on URL 404s, GDELT disabled by design (article-noise), ACLED disabled awaiting license. The first two are flagged "low marginal value" — fair, but they're still on the source-health roster as 0-poll endpoints which dilutes the "X/15 sources healthy" signal. Either remove them from the roster or annotate them as "intentionally disabled" so the metric reads honestly.

---

## Product / strategy concerns

**Zero real-operator UAT.** The dashboard is built to a clear spec, but no actual New Relic CMT operator has used it under conditions resembling a real incident. The Q1/Q2/Q3 framing is sharp; whether the *workflow* serves a panicked operator at 3 AM is an open question. **Strong recommendation:** before any further feature work, walk the dashboard end-to-end with one CMT colleague and watch where they hesitate. UAT will surface issues no review can predict.

**"Declare BCI" needs an incident drill.** This is the manual mechanism for Q3 (business-continuity events). It's the most operator-action-driven flow in the system. It's never been exercised end-to-end with someone in the operator seat. The synthetic test scenarios (🧪 Tests pill in mock mode) cover Q1 and Q2 detection well; Q3 declaration needs the same kind of validated rehearsal.

**ACLED is context, not trigger — and there's no Plan B for real-time civil unrest.** The current architecture treats ACLED as historical context (acceptable given the 5-14 day publication lag) and leaves real-time civil-unrest detection as an unsolved gap. If ACLED's commercial license comes back as "not viable for New Relic's use case," the gap doesn't get filled — it gets wider. Worth thinking now about Plan B: Factal, Crisis24, or eventual Slack-inbound from on-the-ground employees.

**OSAC could come back as "no."** The compliance question to `OSACPrograms@state.gov` has three plausible outcomes (permissive / restrictive but workable / hard restriction). The hard-restriction outcome means OSAC content cannot be surfaced through the dashboard at all. There's no documented Plan B for "trusted vetted travel-security intelligence" if OSAC is unavailable. Worth a brief contingency note in `docs/osac-integration-plan.md`.

**The "long-term integration vision" is a ~4-quarter roadmap.** Workday + Okta + Slack outbound + Slack inbound + Navan + Gmail is the planned phasing. Each integration is its own multi-week project with its own ToS, security review, and design questions. The risk is that the *prototype* dashboard ages out before the integrations land — by the time Workday is wired, the frontend has been touched in 30 more sessions and modularization is a 30-hour job, not 8.

**No incident postmortem template.** When a real incident happens, the dashboard captures the comms log, response tally, and notes — but doesn't structure a postmortem (what was the lead time, did we miss any earlier signals, did the right people respond, where did the workflow stall). The data is in Postgres; the analysis surface isn't. Worth queuing as a Sprint 6 item.

---

## Risk register (priority order)

1. **No automated tests** + active development = silent regression risk. Highest leverage to fix.
2. **ACLED commercial license** could come back unfavorably. No Plan B for real-time civil unrest.
3. **OSAC compliance** could come back hard-restrictive. Plan B undocumented.
4. **Auth model is dev-only.** Okta integration is gating any non-prototype deployment.
5. **5500-line single file** + 8-10 hour modularization debt. Compounds with every session.
6. **State coherence** between localStorage and Postgres needs explicit documentation.
7. **No real-operator UAT.** Workflow confidence is theoretical.
8. **No backend-down indicator.** The 4-day silent failure could repeat.

---

## UI recommendations

**Constraint:** Memory is clear that you like the current UI and don't want it restructured. Q1/Q2/Q3 stays an internal classification model, not a UI restructure. The recommendations below are *polish and signal clarity* — not redesign. They're ordered by impact-per-hour.

### Tier 1 — Monday-morning wins (each <1 hour)

1. **Extreme-severity card tint.** Right now an `s-ext` alert card has a 3px left border in red. On a dense feed, that's easy to skim past. Add a subtle background wash:
   ```css
   .alert-card.s-ext { background: rgba(248,113,113,.08); }
   ```
   Don't pulse it (annoying during a long incident). The status strip already pulses; the feed can be calmer.

2. **Visible focus outlines.** Buttons have `:hover` styles but no `:focus`. Keyboard users can't see focus position. Single CSS rule:
   ```css
   .htn:focus-visible, .btn-ghost:focus-visible, .tab:focus-visible {
     outline: 2px solid var(--green); outline-offset: 2px;
   }
   ```

3. **"Last fetch" indicator in the status strip.** Add a small chip showing seconds-since-last-event-poll. Goes red if >5 min. This is your early warning for the 4-day-backend-down scenario. Cheap; high value.

4. **Microcopy passes.**
   - "? Manual" → "? Guide" (more operator-friendly).
   - "Declare BCI" → keep, but add tooltip "Business Continuity Incident — declares a major event affecting populations of employees."
   - "Travelers — pending Navan integration" → "Travelers data unavailable. Awaiting Navan connection."
   - "By Office / Timeline" tabs → "By Office / Recent" reads better.
   - Geo-fence "Highlight / Filter" → tooltip on each ("Highlight: tint affected offices on map." "Filter: hide alerts outside the fence.").

5. **Header button density.** Six buttons (Map Tools / Travelers / Risk Profile / Declare BCI / Theme / Manual) compete for first-time-operator attention. Consider grouping into two clusters with a 12-16px gap — operational tools left (Map Tools, Risk Profile, Travelers, Declare BCI) and meta tools right (Theme, Manual). Costs nothing in pixels; helps mental model.

### Tier 2 — Half-day items

6. **Quiet-state mode.** When `STATE.alerts` has no `ext`/`high` AND `STATE.incidents.filter(i => !i.closedAt).length === 0`, calm the chrome:
   - Stop the `.badge.live { animation: pulse 1.5s infinite; }` on a 0-count incidents badge.
   - Stop the `.sev-dot.s-ext { animation: blink 1s infinite; }` when no extreme alert is active near that office.
   - Add a small status-strip cue: "Monitoring · no active alerts." The dashboard *should feel* quiet during peace; right now it pulses regardless.

7. **Three-tier relevance chips on alerts.** Already in the queue (per memory). Direct (red, top of feed) / Indirect (amber, secondary) / Watch (info chip, not in feed by default). This is the single highest-leverage UX change to align the alert feed with the Q1/Q2/Q3 model the rest of the system already uses internally. Roughly half a day.

8. **Geo-fence discoverability.** First-time operators have no reason to click the Geo-fence tab inside Map Tools. Two cheap fixes:
   - Add a tiny dashed-border or subtle "✏ Draw a fence" hint under the tab name when no fence has been drawn this session.
   - Add an `aria-live="polite"` region that announces "Circle draw mode active. Click on the map to begin." when a shape mode is selected. Fixes screen-reader story too.

9. **Map-tools dropdown reposition.** When both right panels are open, the map shrinks to ~600px and the 360px tools dropdown overlays the right side of the map — sometimes covering the very office markers the operator is trying to interact with. Anchor the dropdown to the *map's* right edge rather than the viewport, or auto-flip to the left when map width is constrained.

### Tier 3 — Larger but worth queuing

10. **Pre-incident drill mode.** A subtle banner or watermark when an incident or comm is sent in `#api=mock`. Right now mock mode is identified by a purple "DEMO MODE" pill, but a Crisis Comms message sent in mock mode looks visually identical to one sent in live mode in screenshots. Worth an explicit watermark on logs / exports / printable reports so a screenshot can never be mistaken for a real incident artifact.

11. **Backend-disconnected error boundary.** Right now a stale state means alerts look old; there's no operator-facing "the dashboard cannot reach the backend" message. A persistent banner ("⚠ Cannot reach backend — last fetch 12 min ago. Data may be stale.") with a manual retry button is lower lift than a full reconnect-loop, and gives operators agency.

12. **Tablet-friendly fallback.** No mobile is fine — this is a dashboard, not a phone app. But an iPad on the table during an incident is a real scenario. A 768-1100px breakpoint that defaults the left rail to collapsed, stacks the two right panels vertically, and gives the map ~70% of viewport width would cover this without redesigning anything.

13. **Print/export polish.** The Export Report HTML is comprehensive but reads as a developer document — section headers, monospace tables, dense facts grid. For a postmortem document or stakeholder summary, an executive-summary block at the top (single paragraph, plain language: "On X date, Y event affected Z employees in N offices. Comms sent in M minutes. P% safe-checked within first hour.") would significantly increase the report's reusability.

### What I would *not* recommend

- **Not** restructuring the right rail (Crisis Comms drawer + Incidents pinned) — the audit suggested it; you've explicitly indicated you like the current layout.
- **Not** introducing a Q1/Q2/Q3 tab structure — you've settled this and the internal classification model is the right call.
- **Not** rebuilding the alert-card grid into a denser/sparser layout — the current density is fine for the use case.
- **Not** redesigning the severity color system — it's consistent and works.

---

## Suggested next-session sequence

If I had to pick what to do next, in priority order:

1. Add the Tier 1 items (a single short session — all five fit in a few hours).
2. Add a minimal Playwright smoke harness covering boot + login + alert click + Crisis Comms send + incident create. ~half day. Pays for itself the first time it catches a regression.
3. Three-tier relevance chips (already queued; ~half day).
4. Sprint 5 race-condition fix (~30 min).
5. Then either (a) Sprint 5 phase 5/6 to finish the persistence migration, or (b) modularize the frontend with the test harness now in place to catch regressions.

Steps 1-4 give you a noticeably better dashboard within one focused session. Step 5 unblocks the next 6 months of feature work.

---

## Bottom line

The architecture, the use-case framing, and the data discipline are good. The frontend is approaching the size where further work without modularization gets risky. There are no automated tests, which is the most uncomfortable single gap. UI doesn't need redesign — it needs polish and one specific signal-clarity intervention (the three-tier relevance chips). The two hard ToS blockers (ACLED, OSAC) and the auth-model gap are the production-readiness work; everything else is feature work on a solid foundation.
