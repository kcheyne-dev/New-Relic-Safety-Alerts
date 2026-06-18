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
