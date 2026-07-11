/**
 * NRSA / S.T.A.R. View — runtime state module.
 *
 * Consolidates every mutable runtime value the dashboard touches into one
 * exported `state` object. Other modules import `state` and read/write its
 * properties; the legacy inline `<script>` reaches it via `window.state`
 * (set up in main.js) and via getter/setter window aliases for the
 * reassignable identifiers (ALERTS, TRAVELERS, etc.).
 *
 * Why a single object: ES module imports are read-only bindings —
 * `import { ALERTS } from './state.js'; ALERTS = []` fails. But mutating a
 * property of an imported object reference works because we're not
 * rebinding the import — we're updating a shared object. So all writes
 * go through `state.ALERTS = newValue` and propagate.
 *
 * Naming: the legacy inline script's `STATE` object becomes `state.UI_STATE`
 * to avoid the case-only collision (`state.STATE` would be confusing).
 *
 * Shape:
 *   - UI_STATE            — was inline `const STATE = {...}` (panel state,
 *                           filters, draft compose, theme, etc.)
 *   - BCP_FORM            — BCI declaration form state
 *   - TRAV_VIEW           — Travelers list modal view state
 *   - RISK_VIEW           — Risk Profile modal view state
 *   - OPERATOR            — logged-in operator (will be Okta-driven)
 *   - ALERTS              — active alerts (seed in live-mode boot, demo
 *                           cycler injects in mock-mode, backfill replaces
 *                           in live-mode)
 *   - TRAVELERS           — populated by demo bootstrap in #api=mock
 *   - EMPLOYEES           — populated by buildEmployees() after offices
 *                           gain headcounts (only in #api=mock)
 *   - REMOTE_EMPLOYEES    — populated by demo bootstrap
 *   - WHO_OUTBREAKS       — backfill from /api/who-outbreaks (live) or
 *                           demo bootstrap (mock)
 *   - ACLED_RISK          — populated by demo bootstrap (no live source —
 *                           ACLED license required, see data-sources.md)
 *   - lastSavedAt         — debounced localStorage save timestamp
 *   - lastRefreshAt       — last successful /api/events fetch (powers the
 *                           status-strip "Last fetch" chip)
 */

export const state = {
  /* ============ UI state ============================================ */
  /* Was: inline `const STATE = {...}` at index.html lines 833-884.
     Properties mutated throughout the app (STATE.feedTab = 'time', etc.).
     The reference is never reassigned, only its properties — that's why
     a direct `window.STATE = state.UI_STATE` bridge works without a
     getter/setter. */
  UI_STATE: {
    feedTab: 'office',
    expandedOffices: new Set(),  // office groups showing all alerts vs top 5
    search: '',
    selectedAlertId: null,
    selectedOffices: [],
    filterMinSev: 'low',
    officeRelevantOnly: true,           // hide global noise — only show events affecting an office, traveler, or employee population
    // visibleOffices and visibleAlertTypes get populated by the inline boot
    // script once OFFICES + ALERT_TYPES are confirmed available. Initialize
    // empty here; the inline script overwrites at boot. (Was previously
    //   visibleOffices: OFFICES.map(o => o.id),
    //   visibleAlertTypes: ALERT_TYPES.slice(),
    // — those import-at-init-time references move to the inline boot path.)
    visibleOffices: [],
    visibleAlertTypes: [],
    showEmployees: true,
    empMode: 'office',
    showTravelers: true,
    ccTab: 'compose',
    composeAdvanced: false,            // Advanced disclosure in Compose tab
    channels: { slack:true, email:false, sms:false },
    template: '',
    customMessage: '',
    subject: '',
    responseRequired: true,
    reminderInterval: '15m',
    // 2026-06-18: drill-mode toggle. When true and there is no linked incident,
    // a Send routes to TEST_ROUTING (test Slack channel + test email distro)
    // with a [TEST] subject prefix and a drill-warning preamble in the body.
    // The persisted message carries isTest=true everywhere it appears: incident
    // Comms tab, standalone Crisis log, incident Log entry, and Export Report.
    // Reset to false after a successful send. Force false whenever the operator
    // links to an existing incident (test mode unavailable inside real incidents).
    isTest: false,
    customLocations: [],
    userTemplates: [],
    attachments: [],          // current Compose draft attachments
    noteAttachments: [],      // current note-input attachments
    crisisLog: [],
    // Failed-outbox — persistent list of sends that failed backend persist.
    // Each entry has enough info to retry the API call end-to-end. Populated
    // by the .catch handlers in dispatchSend (modals.js) + createIncident
    // (incidents.js) via enqueueFailure() from outbox.js. Displayed via the
    // header badge + a full-list modal + inline chips in the Crisis Comms
    // Log tab.
    //
    // Entry shape:
    //   {
    //     id:          'ob_xxx',         // unique outbox id
    //     kind:        'comms' | 'incident-message' | 'incident-create',
    //     when:        ISO,               // when the send was originally attempted
    //     attempts:    number,            // total retry attempts (0 initially, ++ on each retry)
    //     lastError:   string,            // most recent error message
    //     status:      'pending' | 'retrying' | 'failed',
    //     msgId:       string | null,     // original msg.id for matching against crisisLog rows
    //     // Union by `kind`:
    //     apiPayload:               { ... }  // comms + incident-message
    //     incidentId:               string   // incident-message only
    //     incidentCreatePayload:    { ... }  // incident-create only (title/description/severity/offices/alertId)
    //     localIncidentId:          string   // incident-create only — local id to swap after successful retry
    //     queuedMessages:           [...]    // incident-create only — messages that were stranded by the failed create
    //     // Display info (denormalized for the outbox UI):
    //     display: { subject, offices, channels, reach, isTest }
    //   }
    //
    // Retention: entries stay until operator dismisses. No auto-purge.
    // On successful retry (auto or manual): entry is hard-deleted.
    outbox: [],
    // roomMessages seed values previously used `nowMinus(N)` (a helper
    // defined in the inline script). Inlining the math here so state.js
    // is self-contained — equivalent semantics, no helpers.js dependency.
    roomMessages: [
      { from:'CMT',         when: new Date(Date.now() - 20 * 60 * 1000).toISOString(), body:'Monitoring multiple regions. SF/TYO/BLR active.' },
      { from:'cowork-3p',   when: new Date(Date.now() -  2 * 60 * 1000).toISOString(), body:'On shift. Reviewing TYO seismic.' },
    ],
    incidents: [],
    selectedIncidentId: null,
    linkedIncidentId: null,           // when set, new comms append to this incident
    incidentTab: 'details',
    incidentListFilter: 'open',       // open | closed | all
    msgFilter: 'all',
    responses: {},  // { incidentId: { employeeId: { status: 'ok'|'help'|'no', when, by } } }
    panels: { alerts:false, crisis:false, incident:false },
    panelWidths: { alerts: 340, crisis: 360, incident: 360 },
    fence: null,             // {layer, shape, mode, results: {offices, employees, travelers}}
    fenceMode: 'highlight',
    hazards: { fire:false, flood:false, quake:false, unrest:false, heat:false, aqi:false, precip:false, temp:false },
    theme: 'dark',
  },

  /* ============ BCI declaration form =================================
     Was: inline `const BCP_FORM = {...}` at index.html line 5250.
     Reset by showBCPModal() between declarations; properties mutated by
     the form bindings. Object reference never reassigned. */
  BCP_FORM: {
    eventTypeId: 'quake', title: '', countries: [],
    useFence: false, templateId: 'bc_announce', customMessage: '', acknowledged: false,
  },

  /* ============ Travelers list modal view state =====================
     Was: inline `const TRAV_VIEW = {...}` at index.html line 4842. */
  TRAV_VIEW: { sortKey: 'name', sortDir: 'asc', search: '', typeFilter: 'all' },

  /* ============ Risk Profile modal view state =======================
     Was: inline `const RISK_VIEW = {...}` at index.html line 5660. */
  RISK_VIEW: { selected: [], search: '', regionFilter: 'all' },

  /* ============ Reassignable identifiers =============================
     These were `let X = ...` declarations in the inline script. They get
     reassigned (`ALERTS = newArray`, `OPERATOR = newOperator`, etc.) so
     the bridge in main.js wraps each in a getter/setter to keep window.X
     in sync with state.X.
     Initial values are empty/null here; the inline boot script populates
     them with seed data, mock data (in #api=mock), or backend fetches. */
  ALERTS: [],
  TRAVELERS: [],
  EMPLOYEES: [],
  REMOTE_EMPLOYEES: [],
  WHO_OUTBREAKS: [],
  ACLED_RISK: {},
  OPERATOR: { name: 'Kevin Cheyne', role: 'cmt', roleLabel: 'CMT' },
  lastSavedAt: null,
  lastRefreshAt: null,
};
