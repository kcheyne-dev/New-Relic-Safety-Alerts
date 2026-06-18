/**
 * NRSA / S.T.A.R. View — module bootstrap + legacy-compat bridge.
 *
 * Loaded as `<script type="module">` BEFORE the legacy inline `<script defer>`.
 * Modules and deferred scripts both execute after DOM parsing in document
 * order, so this module wins the race and has window globals set up by the
 * time the inline script begins executing.
 *
 * The bridge has two flavors of binding:
 *
 *   1) DIRECT ASSIGN — for object refs that are mutated via `.property` but
 *      never reassigned (STATE, BCP_FORM, TRAV_VIEW, RISK_VIEW). Inline code
 *      like `STATE.feedTab = 'time'` goes through window.STATE which IS the
 *      same object reference as state.UI_STATE — mutations propagate.
 *
 *   2) GETTER/SETTER — for identifiers the inline script REASSIGNS
 *      (ALERTS, TRAVELERS, EMPLOYEES, REMOTE_EMPLOYEES, WHO_OUTBREAKS,
 *      ACLED_RISK, OPERATOR, lastSavedAt, lastRefreshAt). A direct assign
 *      wouldn't be enough because the inline script does `ALERTS = newArr`
 *      which would shadow window.ALERTS without updating state.ALERTS.
 *      Instead we define a property descriptor with get/set so reads return
 *      the current state.X and writes update state.X transparently.
 *
 * SESSION-2 STATUS (2026-06-18 evening): this is the wire-up of the session-1
 * shadow modules. The legacy inline script in index.html no longer declares
 * STATE / ALERTS / TRAVELERS / etc.; those declarations have moved here via
 * state.js. Everything else in the inline script continues to work unchanged
 * because the bridge keeps reads + writes in sync.
 *
 * Sessions 3+ will progressively swap inline references for direct module
 * imports and shrink the bridge — but the bridge stays load-bearing for as
 * long as ANY inline code reads/writes one of these identifiers.
 */

import { state } from './state.js';

/* Step 1: expose `state` to inline JS so any code that needs the unified
   object can reach it directly via `state.X` or `window.state.X`. */
window.state = state;

/* Step 2: direct-assign for object refs (mutated via .property, never
   reassigned). Inline `STATE.feedTab = X` works because window.STATE and
   state.UI_STATE point at the same object. */
window.STATE     = state.UI_STATE;
window.BCP_FORM  = state.BCP_FORM;
window.TRAV_VIEW = state.TRAV_VIEW;
window.RISK_VIEW = state.RISK_VIEW;

/* Step 3: getter/setter for reassignable identifiers. The setter is what
   makes inline `ALERTS = newArray` actually update state.ALERTS — without
   it, the assignment would silently drop on the floor (or shadow in
   non-strict mode). */
function bridgeReassignable(name) {
  Object.defineProperty(window, name, {
    get()   { return state[name]; },
    set(v)  { state[name] = v; },
    configurable: true,    // allow re-bridging during dev hot-reloads
    enumerable:   true,
  });
}

[
  'ALERTS',           // active alerts (live + mock + demo cycler injects)
  'TRAVELERS',        // populated by demo bootstrap
  'EMPLOYEES',        // populated by buildEmployees() — runs after offices gain headcounts
  'REMOTE_EMPLOYEES', // populated by demo bootstrap
  'WHO_OUTBREAKS',    // backfill from /api/who-outbreaks (live) or demo (mock)
  'ACLED_RISK',       // demo-only (no live source — ACLED license required)
  'OPERATOR',         // overwritten by /api/auth/me on login
  'lastSavedAt',      // debounced localStorage save timestamp
  'lastRefreshAt',    // last successful /api/events fetch
].forEach(bridgeReassignable);

/* Step 4: bridge pure-helper functions extracted in session 2 / step C1.
   legacy-app.js calls these as bare globals (`esc(text)`, `fmtSize(n)`, etc.);
   Object.assign'ing them onto window makes the calls resolve unchanged. The
   functions don't reference any state, so order-of-load doesn't matter — but
   they are read-only, never reassigned, so direct property assignment is fine
   (no getter/setter needed). */
import * as helpers from './helpers.js';
Object.assign(window, helpers);

/* Step 5: bridge constants for module-side reads. legacy-app.js still has its
   own inline `const SEVERITY = ...` etc. declarations; those create script-
   scope bindings (NOT window properties for `let`/`const`) so modules can't
   see them. Bridging the constants module to window gives helpers.js (and
   future render.js/modals.js) bare-reference access to OFFICES, OFFICE_BY_ID,
   COUNTRY_PRESENCE, SEV_RANK, etc. without needing per-helper imports.
   The values are drift-checked equal to the inline copies; legacy-app.js's
   references continue to resolve through its own script-scope bindings,
   shadowing the window copies harmlessly until session-3 inline removal. */
import * as constants from './constants.js';
Object.assign(window, constants);

/* Step 6: bridge api functions extracted in session 2 / step 7. Includes
   API_BASE, token storage, apiFetch, the four backfills, SSE subscription,
   login modal, mappers, incidentsApi/commsApi objects, and bootLiveMode
   itself. legacy-app.js's tail boot trigger (`if (API_BASE) { bootLiveMode() }`)
   relies on these being on window — modules execute first so by the time
   the trigger fires from legacy-app.js, the api bridge is in place. */
import * as api from './api.js';
Object.assign(window, api);

/* Step 7: bridge persistence + report-export functions extracted in session 3
   step 8. saveState is called from every state mutation in legacy-app.js
   (debounced to 500ms via the module-private _saveTimer); loadState runs
   once during boot to restore from localStorage; exportData / resetData
   are wired to the manual modal's buttons; showAlertDetails and
   exportIncidentReport open new tabs from the incident detail UI. */
import * as persistence from './persistence.js';
Object.assign(window, persistence);

/* Step 8: bridge render pipeline + view-state utilities extracted in session 3
   step 9. ~45 functions covering every render surface: map markers, alert feed,
   Crisis Comms compose, Incidents panel, Map Tools dropdown, status strip,
   theme, panel resize, etc. The master `renderAll` is on window so legacy-app.js
   call sites (every state mutation triggers renderAll() then saveState()) keep
   working. The status-strip ticker fires via legacy-app.js's tail trigger. */
import * as render from './render.js';
Object.assign(window, render);

/* Step 9: bridge modal logic extracted in session 3 step 10 — the final
   extraction. ~33 functions across modal infrastructure (showModal/closeModal/
   toast), Crisis Comms send flow (confirmSend/dispatchSend), Travelers list
   modal, BCI declaration flow (showBCPModal + declareBCP + 12 supporting fns),
   Risk Profile modal. legacy-app.js's remaining ~2,500 lines are pure boot
   wiring + DOM event listeners + demo simulator + a few incident-state
   helpers that didn't fit any other module cleanly. */
import * as modals from './modals.js';
Object.assign(window, modals);
