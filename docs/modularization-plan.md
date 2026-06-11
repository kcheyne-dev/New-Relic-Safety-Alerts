# Frontend Modularization Plan

> Status: **deferred** — captured 2026-06-11 for a future session.
> Decision: ES modules (no build step), full pass across multiple sessions.

## Why this plan exists

`index.html` is a single ~5500-line file with CSS, JS, and HTML coexisting.
That worked great early on but is now the biggest dev-experience pain point:

- Hard to navigate; impossible to tell at a glance what's where
- Implicit globals everywhere — every `function` and `const` lives in one
  giant scope
- Order-of-definition fragility: code in section 9 can break if you reorder
  section 3
- Syntax errors anywhere break the whole app
- `git diff` on edits is noisy because everything's in one file
- Working in this file with an LLM consumes huge context per turn

## Strategy

**ES modules (no build step).** Reasons:

- Real architectural improvement — explicit `import`/`export` makes
  dependencies visible and forces honest module boundaries
- No globals leakage — module internals stay private unless explicitly
  exported
- Zero new tooling. `<script type="module">` loads modules directly.
  GitHub Pages serves `.js` correctly. Local `localhost:8000` works fine.
- Modern & standard

The one trade-off: ES modules require CORS, so `file://index.html` won't
work for dev. But we already use `localhost:8000` for live mode, so this
isn't a real constraint.

## Module layout

```
css/
  styles.css                    [~745 lines, lift CSS as-is]

js/
  constants.js                  [~250 lines]   immutable data:
                                                SEVERITY, SEV_RANK, SEV_NAME, SEV_COLOR,
                                                ALERT_TYPES, SOURCES, OFFICES,
                                                COUNTRY_PRESENCE, TEMPLATES,
                                                TEMPLATE_CATEGORIES, BCP_EVENT_TYPES,
                                                HAZARD_ZONES, TILE_OVERLAYS,
                                                WHO_COUNTRY_ALIASES,
                                                IMPACT_RADIUS_DEFAULT_KM,
                                                BACKEND_TYPE_TO_CATEGORY,
                                                ROLE_TAG_STYLE, TILES, TOKEN_KEY,
                                                PERSIST_KEY, PERSIST_DEBOUNCE_MS,
                                                ATT_EMBED_LIMIT, PANEL_MIN_W,
                                                PANEL_MAX_W

  mock-data.js                  [~200 lines]   only loaded in #api=mock:
                                                OFFICE_HEADCOUNTS_MOCK,
                                                TRAVELERS_MOCK, REMOTE_EMPLOYEES_MOCK,
                                                ACLED_RISK_MOCK, WHO_OUTBREAKS_MOCK

  state.js                      [~100 lines]   mutable runtime state in one
                                                exported object so writes work
                                                across modules:
                                                state.ALERTS, state.TRAVELERS,
                                                state.EMPLOYEES, state.WHO_OUTBREAKS,
                                                state.ACLED_RISK, state.OPERATOR,
                                                state.UI_STATE (was STATE — renamed
                                                to avoid name collision),
                                                state.BCP_FORM, state.INCIDENTS,
                                                state.COMMS_LOG, state.RISK_VIEW,
                                                state.TRAV_VIEW

  helpers.js                    [~600 lines]   pure utilities:
                                                severity helpers (sevColor, sevPill),
                                                geo (haversineKm, distanceKm),
                                                formatters (fmtHeadcount, fmtTime,
                                                relTime, fmtClock, fmtSize),
                                                country normalization
                                                (normalizeWhoCountry, alertCountryFor),
                                                ACLED helpers
                                                (hasAcledRisk, aggregateAcledRisk),
                                                WHO helpers (hasWhoOutbreaks,
                                                outbreaksForCountry, outbreaksAggregated),
                                                live hazards
                                                (liveHazardsForCountry, liveHazardsAggregated),
                                                escapers (esc, linkify),
                                                attachment helpers
                                                (fileToAttachment, attachmentChipHTML,
                                                fileIcon)

  api.js                        [~250 lines]   backend client:
                                                API_BASE detection,
                                                getStoredToken/storeToken/clearStoredToken,
                                                apiFetch, bootLiveMode,
                                                backfillAlerts, backfillWhoOutbreaks,
                                                subscribeLiveStream,
                                                login modal (showLoginModal),
                                                mapBackendType, isPrescribedFire

  render.js                     [~1200 lines]  render pipeline:
                                                renderAll, renderHeader,
                                                renderStatusStrip, renderRailAlerts,
                                                renderFeed, alertCardHTML, selectAlert,
                                                renderOffices/officePopup,
                                                renderAlertDots/alertPopupHTML,
                                                renderEmployees/renderTravelers,
                                                renderHazardZones/updateHazardLegend/
                                                renderHazards, renderCC/setCcTab/
                                                renderComposeForm/renderCCLog/renderRoom,
                                                renderIncidents/renderIncidentList/
                                                renderIncidentDetail/renderIncidentTab,
                                                buildLayerControls, applyTheme,
                                                showFreshness

  modals.js                     [~1500 lines]  modal logic:
                                                showModal, closeModal, toast,
                                                Risk Profile modal (showRiskProfileModal,
                                                riskCountryList, riskLiveHazardsHTML,
                                                riskModalHTML, bindRiskModalHandlers),
                                                BCI declaration (showBCPModal,
                                                showBCIWaitingChip, clearBCIWaitingChip,
                                                bcpModalHTML, bcpAvailableCountries,
                                                bcpExposureInScope, bcpAcledRiskHTML,
                                                bcpExposureSummaryHTML, bcpFormBodyHTML,
                                                refreshBCPExposure, updateBCPDeclareButton,
                                                bindBCPHandlers, bindBCPFormHandlers,
                                                declareBCP),
                                                Travelers list modal (showTravelersList,
                                                travListBodyHTML, travListRowsHTML,
                                                travRowHTML, refreshTravList,
                                                bindTravListHandlers, bindTravListRowHandlers,
                                                exportTravelersCSV, travSortValue),
                                                Crisis Comms compose
                                                (suggestTemplate, renderTemplatePickerOptions,
                                                hasDraftContent, allTargets, allTemplates,
                                                recipientsForChannel,
                                                wireAttZone, bindCCHandlers, confirmSend,
                                                dispatchSend)

  persistence.js                [~600 lines]   localStorage save/load:
                                                stripAtt, stripMessageAtts, stripIncident,
                                                buildPersistPayload, saveState, loadState,
                                                exportData, resetData,
                                                showAlertDetails (huge HTML template),
                                                exportIncidentReport (huge HTML template)

  demo.js                       [~600 lines]   #api=mock IIFE:
                                                cycling alert simulator,
                                                synthetic test scenarios

  main.js                       [~150 lines]   entry point:
                                                Leaflet/markercluster init,
                                                map setup, boot mode detection
                                                (live vs bare vs mock),
                                                URL hash routing (handleHashRoute),
                                                event listener wiring,
                                                tick interval,
                                                initial renderAll

index.html                      [~150 lines]   shell only:
                                                <head> tags + leaflet CSS,
                                                <link rel="stylesheet" href="css/styles.css">,
                                                body skeleton (header, rails, map div),
                                                modal mount point,
                                                <script type="module" src="js/main.js">
```

## Mutable state pattern

All `let` variables that get reassigned must move into a single exported
state object so writes propagate across modules. Imports are read-only
references in ES modules — `import { ALERTS } from './state.js'; ALERTS = []`
fails, but `state.ALERTS = []` works because we're mutating a property
of an imported object reference.

```js
// state.js
export const state = {
  ALERTS: [],
  TRAVELERS: [],
  EMPLOYEES: [],
  REMOTE_EMPLOYEES: [],
  WHO_OUTBREAKS: [],
  ACLED_RISK: {},
  OPERATOR: { name: 'Kevin Cheyne', role: 'cmt', roleLabel: 'CMT' },
  UI_STATE: { /* the old STATE object */ },
  BCP_FORM: { /* ... */ },
  // ...
};
```

Every reference like `WHO_OUTBREAKS.filter(...)` becomes
`state.WHO_OUTBREAKS.filter(...)` — mechanical rename, hundreds of sites.

## Circular-import risk

Most likely circular: `render.js` ↔ `modals.js` (modals call renderAll;
render code emits buttons that open modals).

**Fix:** put the orchestrator `renderAll` plus `showModal`/`closeModal`/
`toast` in a small shared module that everyone imports from
(`ui-core.js`). Or: have render.js export per-section renderers; modals.js
imports just those it needs. Sort it out at extraction time.

## Recommended phasing

Eight to ten hours of focused work total — better to split across sessions:

### Session 1 (~2-3 hours, lowest risk)
1. Extract CSS → `css/styles.css`. Add `<link>` to index.html. Verify dashboard renders identically.
2. Extract `constants.js`. Replace inline definitions with import.
3. Extract `mock-data.js`. Replace inline definitions with import in the demo IIFE.
4. Extract `demo.js` (the `#api=mock` IIFE itself).
5. Verify all three modes still work. Commit.

### Session 2 (~3-4 hours, medium risk)
6. Extract `state.js`. Mass rename to `state.X`. Run a verify pass.
7. Extract `helpers.js`.
8. Extract `api.js`.
9. Verify all three modes. Commit.

### Session 3 (~3 hours, highest risk)
10. Extract `render.js`.
11. Extract `modals.js`.
12. Extract `persistence.js`.
13. Build `main.js` and trim `index.html` to a shell.
14. Heavy verification: live mode, bare Pages, demo mode, all modals, all flows.
15. Commit + push.

## Verification checklist (run after each session)

For each operating mode:

**Live mode** (`localhost:8000`):
- [ ] Login modal appears for unauthenticated users
- [ ] Boot fetches alerts + WHO outbreaks
- [ ] SSE stream pushes new events
- [ ] Map renders offices + alert dots
- [ ] Risk Profile modal shows live WHO + ACLED data
- [ ] Crisis Comms compose works (template dropdown, send)
- [ ] BCI declaration flow works
- [ ] Incidents persist across reload (localStorage)

**Bare GitHub Pages** (no `#api=mock`, no backend):
- [ ] No login modal (no API to authenticate against)
- [ ] Empty alert feed (no backend, no mock)
- [ ] Pending-integration placeholders in panels that need real data
- [ ] Risk Profile shows "pending integration" states for ACLED/WHO

**Demo mode** (`#api=mock`):
- [ ] Mock data populates everything
- [ ] Cycling alert simulator runs
- [ ] Synthetic test scenarios trigger correctly
- [ ] All modals render with mock data

## Notes from the survey (2026-06-11)

Section boundaries already in the file (good signal posts for extraction):

```
CSS sections (lines  21–746):
  THEME / LAYOUT / HEADER / STATUS STRIP / RAILS & PANELS /
  ALERT FEED / MAP / MAP TOOL OVERLAYS / CRISIS COMMS /
  INCIDENTS / MODALS / TOAST / UTILITY CLASSES / SCROLLBAR

JS sections (lines 747–end):
  747:  Section 0  intro
  751:  Section 1  Static reference data
  1085: Section 2  Mock data generators
  1192: Section 3  App state
  1371: Section 4  Map setup
  1390: Section 5  Helpers
  1560: Section 6  Office markers + popups
  1610: Section 7  Alert dots
  1657: Section 8  Employees & travelers
  1694: Section 9  Hazard overlays (mock)
  1944: Section 10 Alert feed render
  2076: Section 11 Crisis Comms render
  2661: Section 12 Incidents render
  2994: Section 13 Layers panel + filters
  3121: Section 14 Geo-fence
  3255: Section 15 Panels & dropdown management
  3406: Section 16 Modals + toast
  3428: Section 17 Public hooks for popup buttons
  3490: Section 17b Alert Details (new tab)
  3574: Section 17c Incident Report (new tab)
  3908: Section 17d Persistence (localStorage)
  4049: Section 17e Status Strip
  4175: Section 18 Master render
  4183: Section 18b Panel resize
  4238: Section 19 Boot
  4267: Section 20 URL hash routing
  4299: Section 21  LIVE BACKEND MODE
  4495: Section 21b TRAVELERS LIST MODAL
  4710: Section 21c BCP DECLARATION
  5303: Section 21d COUNTRY RISK PROFILE
  5587: Section 22  DEMO MODE — cycling simulator
  5923: Section 23  SYNTHETIC TEST SCENARIOS
```
