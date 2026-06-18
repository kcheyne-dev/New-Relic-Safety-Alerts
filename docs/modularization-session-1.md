# Modularization — Session 1 plan

> Status: **ready to execute** — written 2026-06-18 for the next focused session.
> Scope: lowest-risk extractions (CSS + read-only data + demo IIFE).
> Estimated time: 2-3 hours.
> Parent plan: `docs/modularization-plan.md`.

## Preconditions

- Backend running at `localhost:8080`, frontend served at `localhost:8000` (per `[[nrsa_local_ops]]`).
- Smoke harness green from the previous session (`cd tests && npm test`).
- Latest `main` checked out — last commit should be `6605b6d` (Sprint 5 phase 5+6) or later.
- A fresh head, not the tail end of a productive day.

## Scope

Four extractions in this order. Each is mostly cut/paste — no logic changes. After each, run the smoke + a visual sanity pass before moving on.

### 1. CSS → `css/styles.css` (~30 min)

Lift everything between `<style>` and `</style>` in `index.html` to a new `css/styles.css` file. Replace the inline block with:

```html
<link rel="stylesheet" href="css/styles.css" />
```

Verify CSS classes still render correctly across:
- Status strip (Last fetch chip, identity chip, all severity tints)
- Alert cards (severity tint + tier chips + impact badges)
- Compose form (test-mode-row, send button cyan-when-test)
- Incident list (test-badge "incl. test" chip)
- Modals (modal-back / modal / modal-actions)
- Map overlays (geo-fence, hazard layers, RainViewer + GIBS toggles)
- Toast container

Smoke: `cd tests && npm test`. Expect green.

Commit: `Modularization session 1 / 4: extract CSS to css/styles.css`.

### 2. `js/constants.js` (~45 min)

Extract immutable data into a new module. Targets:

- Severity: `SEVERITY`, `SEV_RANK`, `SEV_NAME`, `SEV_COLOR`
- Reference data: `ALERT_TYPES`, `SOURCES`, `OFFICES`, `OFFICE_BY_ID`, `COUNTRY_PRESENCE`, `WHO_COUNTRY_ALIASES`
- Templates: `TEMPLATES`, `TEMPLATE_CATEGORIES`, `BCP_EVENT_TYPES`
- Map: `HAZARD_ZONES`, `TILE_OVERLAYS`, `TILES`
- Behavior tunables: `IMPACT_RADIUS_DEFAULT_KM`, `BACKEND_TYPE_TO_CATEGORY`, `BACKEND_CATEGORY_TO_LABEL`, `SOURCE_ID_TO_CATEGORY`, `ROLE_TAG_STYLE`
- Storage keys + intervals: `TOKEN_KEY`, `PERSIST_KEY`, `PERSIST_DEBOUNCE_MS`, `ATT_EMBED_LIMIT`, `PANEL_MIN_W`, `PANEL_MAX_W`
- **2026-06-18 additions:** `TEST_ROUTING`, `TEST_PREFIX_SUBJECT`, `TEST_PREFIX_BODY` (test-message routing), `TIER_RANK` (relevance sort)

Strategy:
- Create `js/constants.js`, paste the values verbatim, prefix each with `export`.
- In `index.html`, add `<script type="module" src="js/main.js"></script>` (placeholder for now — actual `main.js` lands in session 3).
- For session 1, the simplest path: inline the import in `index.html` itself via a single `<script type="module">` block at the top of the existing script section that does `import { ... } from './js/constants.js';` and re-exposes them via a destructure.
- Or: keep the inline definitions in `index.html` AS WELL for session 1 (the duplicate is temporary; session 2 removes the inline copies). Cleaner cut/paste, easier rollback.

Verify smoke + visual.

Commit: `Modularization session 1 / 4: extract constants.js`.

### 3. `js/mock-data.js` (~30 min)

Extract `#api=mock`-only fixture data:

- `OFFICE_HEADCOUNTS_MOCK`
- `TRAVELERS_MOCK`
- `REMOTE_EMPLOYEES_MOCK`
- `ACLED_RISK_MOCK`
- `WHO_OUTBREAKS_MOCK`

These are currently inside the demo IIFE. Pull them out so `demo.js` can import them in step 4.

Verify mock mode (`localhost:8000/#api=mock`) still loads all the fake data — travelers, ACLED risk panel, WHO outbreaks. Quick spot-check: open Risk Profile modal → India → live hazards + WHO outbreaks should render.

Commit: `Modularization session 1 / 4: extract mock-data.js`.

### 4. `js/demo.js` (~45 min)

Extract the demo simulator IIFE + synthetic test scenarios block:

- Cycling alert simulator
- 🧪 Tests pill + scenario buttons (Office threat / Traveler threat / BCI declaration)
- 🧹 Clear pill
- Demo cycler hooks

Imports: from `mock-data.js` and `constants.js`. Exports: nothing (it's a side-effect module — runs an IIFE on load).

In `index.html`, the demo IIFE block becomes a single `<script type="module" src="js/demo.js"></script>` — but only loaded when `#api=mock` is detected. Two ways:

- **Static load + internal gate** (simpler): always load the script; the IIFE inside checks `location.hash` and bails if no `#api=mock`. Mirrors current behavior.
- **Dynamic import** (cleaner but more involved): main.js detects `#api=mock` and `await import('./demo.js')` only then. Defer to session 3.

Go with the static-load-internal-gate approach for session 1.

Verify all three modes:
- Live mode (`localhost:8000`): demo IIFE detects no hash, exits early. No 🧪 Tests pill. Smoke green.
- Bare Pages (`https://kcheyne-dev.github.io/...`): same — IIFE exits early. No mock data.
- Mock mode (`localhost:8000/#api=mock`): IIFE runs, all mock data populates, 🧪 Tests pill renders, scenario buttons trigger correctly.

Commit: `Modularization session 1 / 4: extract demo.js`.

## Verification checklist for session 1

After the four extractions, walk through these manually:

**Live mode (`localhost:8000`):**
- [ ] Page loads, no console errors
- [ ] Login modal appears for unauthenticated users
- [ ] After login: alerts populate, Last-fetch chip turns green
- [ ] Click an alert card → tier chip renders (Direct/Indirect/Watch)
- [ ] Open Crisis Comms → Compose form renders with test-mode toggle
- [ ] Send a real message via the smoke flow (or manually)
- [ ] Status strip Open Incidents badge updates
- [ ] `cd tests && npm test` → green

**Bare Pages (`localhost:8000` with no token / clear localStorage):**
- [ ] Login modal appears
- [ ] No 🧪 Tests pill
- [ ] No demo cycler running

**Mock mode (`localhost:8000/#api=mock`):**
- [ ] Demo cycler runs (alerts move every ~10s)
- [ ] 🧪 Tests pill in the top-center cluster
- [ ] All three test scenarios fire (Office threat, Traveler threat, BCI declaration)
- [ ] 🧹 Clear pill shows synthetic event count
- [ ] Travelers, REMOTE_EMPLOYEES, ACLED_RISK, WHO_OUTBREAKS all populated

If any of these fail, do NOT push. Roll back the affected commit and triage.

## Push command

```bash
cd "/Users/kcheyne/Documents/Claude/Projects/New Relic Safety Alerts"
git push
```

Four commits land together. Origin should fast-forward.

## What NOT to do in session 1

- **Don't extract `state.js` yet.** That's session 2. The STATE → state.UI_STATE rename is hundreds of sites and benefits from being the focus of its own session.
- **Don't touch `render.js`, `modals.js`, or `persistence.js`.** Those are session 3 and need extra-careful verification because the smoke harness has coverage gaps in BCI flow and Risk Profile modal.
- **Don't trim `index.html`.** Keep the inline `<script>` block intact aside from the four imports added. Trimming to the shell happens at the end of session 3.
- **Don't bundle this with feature work.** Modularization should be a clean diff: just code moves, no semantic changes.

## Rollback strategy

Each step commits separately. If something breaks at step 3, `git revert <hash>` of step 3 leaves steps 1 and 2 intact. Don't squash session 1 into a single commit until you've verified all three modes.

## Time estimate

Realistic: 2.5-3 hours for someone fresh, with 30-45 min of verification + smoke between steps. If it takes more, that's a signal that session 1 found a non-mechanical issue (e.g., circular import precedent that needs unwinding) — pause and document rather than power through.
