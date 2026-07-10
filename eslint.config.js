/**
 * ESLint flat config for the frontend ES modules (js/*.js).
 *
 * PURPOSE — this is a SAFETY-NET lint, not a style enforcer. The rule we
 * really care about is `no-undef` catching typos like `STATT` instead of
 * `STATE`. Everything else is off.
 *
 * BRIDGED GLOBALS — the dashboard uses a window-bridge pattern (see main.js)
 * where legacy-app.js reads STATE / OFFICES / ALERTS / etc. as bare
 * identifiers that resolve through window. Those bare refs are legitimate
 * (they're how the legacy inline script accesses the modular code); the
 * globals list below declares them so no-undef doesn't complain. As
 * modules migrate to explicit `import { OFFICES } from './constants.js'`
 * per the 2026-06-19 action plan (task #5), the corresponding entries here
 * can be trimmed — each removal proves that no module still reaches for
 * that identifier via the bridge.
 *
 * TOOLING SCOPE — this config lints js/*.js only. backend/ has its own
 * TypeScript strict setup; tests/ has Playwright's own tooling. Root-level
 * config is intentional (see the 2026-07-03 setup discussion).
 */

export default [
  {
    // Non-recursive on purpose: lint only top-level frontend modules. If we
    // ever add js/vendor/ or similar third-party subtree, we don't want the
    // safety-net rules firing against code we don't control.
    files: ['js/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Standard browser globals ESLint doesn't ship by default in flat config
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        FileReader: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        EventSource: 'readonly',
        Image: 'readonly',
        HTMLElement: 'readonly',
        location: 'readonly',
        history: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        globalThis: 'readonly',

        // Third-party globals loaded via <script> tags in index.html
        L: 'readonly',              // Leaflet

        // Bridged identifiers from js/constants.js (Object.assign onto window
        // in main.js step 5). Trim entries as modules switch to explicit
        // imports. See the docblock above.
        SEVERITY: 'readonly',
        SEV_RANK: 'readonly',
        SEV_NAME: 'readonly',
        SEV_COLOR: 'readonly',
        ALERT_TYPES: 'readonly',
        SOURCES: 'readonly',
        OFFICES: 'readonly',
        OFFICE_BY_ID: 'readonly',
        COUNTRY_PRESENCE: 'readonly',
        // WHO_COUNTRY_ALIASES trimmed 2026-07-03 (batch B): only used in
        // helpers.js which now imports it explicitly. Grep confirms no
        // other bare reference anywhere in js/. First trim of the bridge
        // cleanup — enforceable evidence that helpers.js no longer needs
        // the bridge for this identifier.
        ROLE_TAG_STYLE: 'readonly',
        TEMPLATE_CATEGORIES: 'readonly',
        TEMPLATES: 'readonly',
        BCP_EVENT_TYPES: 'readonly',
        HAZARD_ZONES: 'readonly',
        TILE_OVERLAYS: 'readonly',
        IMPACT_RADIUS_DEFAULT_KM: 'readonly',
        BACKEND_TYPE_TO_CATEGORY: 'readonly',
        BACKEND_CATEGORY_TO_LABEL: 'readonly',
        SOURCE_ID_TO_CATEGORY: 'readonly',
        TOKEN_KEY: 'readonly',
        PERSIST_KEY: 'readonly',
        PERSIST_DEBOUNCE_MS: 'readonly',
        ATT_EMBED_LIMIT: 'readonly',
        PANEL_MIN_W: 'readonly',
        PANEL_MAX_W: 'readonly',
        TEST_ROUTING: 'readonly',
        TEST_PREFIX_SUBJECT: 'readonly',
        TEST_PREFIX_BODY: 'readonly',

        // Bridged identifiers from js/state.js. Object-refs are readonly
        // from the module perspective (properties mutated, ref never
        // reassigned by modules — only by legacy-app.js via the bridge).
        state: 'readonly',
        STATE: 'readonly',
        BCP_FORM: 'readonly',
        TRAV_VIEW: 'readonly',
        RISK_VIEW: 'readonly',
        // Reassignable identifiers from state.js (bridged via getter/setter).
        // Modules read them; legacy-app.js reassigns via `X = newVal` which
        // routes through the setter. From module perspective: readonly.
        ALERTS: 'readonly',
        TRAVELERS: 'readonly',
        EMPLOYEES: 'readonly',
        REMOTE_EMPLOYEES: 'readonly',
        WHO_OUTBREAKS: 'readonly',
        ACLED_RISK: 'readonly',
        OPERATOR: 'readonly',
        lastSavedAt: 'readonly',
        lastRefreshAt: 'readonly',

        // Bridged functions from helpers/api/persistence/render/modals/
        // incidents/demo — each module does Object.assign(window, exports)
        // in main.js. Any module can call any other's exports via bare
        // identifier. Enumerated verbatim from the exports of each module.
        // Regen via:
        //   for f in helpers.js api.js persistence.js render.js modals.js \
        //             incidents.js demo.js; do
        //     grep -oE '^export (async )?function [a-zA-Z_][a-zA-Z0-9_]*|^export const [a-zA-Z_][a-zA-Z0-9_]*' js/$f \
        //       | sed -E 's/^export (async )?(function|const) //'
        //   done | sort -u
        // Trim entries from the corresponding module as it migrates to
        // explicit imports and no longer needs the bridge for that name.
        ...Object.fromEntries([
          // helpers.js
          '_emptyHazardRollup', 'activeAlertsForOffice', 'aggregateAcledRisk',
          'alertCountryFor', 'alertPriorityScore', 'allTargets', 'allTemplates',
          'attachmentChipHTML', 'distanceKm', 'enrichEventWithImpact', 'esc',
          'fileIcon', 'fileToAttachment', 'fmtClock', 'fmtHeadcount', 'fmtSize',
          'hasAcledRisk', 'hasOfficeHeadcounts', 'hasWhoOutbreaks', 'linkify',
          'liveHazardsAggregated', 'liveHazardsForCountry', 'maxSevForOffice',
          'normalizeWhoCountry', 'nowMinus', 'outbreaksAggregated',
          'outbreaksForCountry', 'passesFilter', 'rand', 'randomName',
          'recipientsForChannel', 'relTime', 'relevanceTierOf', 'stripAtt',
          'stripIncident', 'stripMessageAtts', 'suggestTemplate', 'sumHeadcount',
          'targetById', 'topScore', 'travelersAtOffice', 'uid', 'visibleAlerts',
          // api.js
          'API_BASE', 'apiFetch', 'backfillAlerts', 'backfillIncidents',
          'backfillWhoOutbreaks', 'bootLiveMode', 'clearStoredToken', 'commsApi',
          'getStoredToken', 'incidentsApi', 'isLocalIncidentId', 'isPrescribedFire',
          'mapBackendCategory', 'mapBackendType', 'mapIncidentRowToState',
          'mapLogRow', 'mapMessageRow', 'mapNoteRow', 'migrateLocalIncidents',
          'showLoginModal', 'storeToken', 'subscribeLiveStream',
          // persistence.js
          'buildPersistPayload', 'exportData', 'exportIncidentReport', 'loadState',
          'resetData', 'saveState', 'showAlertDetails',
          // render.js
          'alertCardHTML', 'alertPopupHTML', 'applyPanelWidths', 'applyTheme',
          'bindCCHandlers', 'bindIncidentDetailHandlers', 'bindIncidentListHandlers',
          'buildLayerControls', 'closePanel', 'hasDraftContent', 'isModalOpen',
          'msgRowHTML', 'officePopup', 'openPanel', 'positionToolsDropdown',
          'renderAlertDots', 'renderAll', 'renderCC', 'renderCCLog',
          'renderComposeForm', 'renderEmployees', 'renderFeed', 'renderHazardZones',
          'renderHazards', 'renderIncidentDetail', 'renderIncidentDetailHTML',
          'renderIncidentFilter', 'renderIncidentList', 'renderIncidentTab',
          'renderIncidents', 'renderOffices', 'renderRailAlerts', 'renderRoom',
          'renderStatusStrip', 'renderTemplatePickerOptions', 'renderTravelers',
          'selectAlert', 'setCcTab', 'setIncidentTab', 'setupPanelResize',
          'showFreshness', 'startStatusStripTicker', 'togglePanel',
          'updateHazardLegend', 'wireAttZone',
          // modals.js
          'bcpAcledRiskHTML', 'bcpAvailableCountries', 'bcpExposureInScope',
          'bcpExposureSummaryHTML', 'bcpFormBodyHTML', 'bcpModalHTML',
          'bindBCPFormHandlers', 'bindBCPHandlers', 'bindRiskModalHandlers',
          'bindTravListHandlers', 'bindTravListRowHandlers', 'clearBCIWaitingChip',
          'closeModal', 'confirmSend', 'declareBCP', 'dispatchSend',
          'exportTravelersCSV', 'refreshBCPExposure', 'refreshTravList',
          'riskCountryList', 'riskLiveHazardsHTML', 'riskModalHTML',
          'showBCIWaitingChip', 'showBCPModal', 'showModal',
          'showRiskProfileModal', 'showTravelersList', 'toast',
          'travListBodyHTML', 'travListRowsHTML', 'travRowHTML', 'travSortValue',
          'updateBCPDeclareButton',
          // incidents.js
          'addIncidentLog', 'buildResponseShells', 'createIncident', 'reopenIncident',
          // demo.js
          'bootDemoMode', 'bootTestScenarios',

          // Bridged identifiers that live in legacy-app.js (still an inline
          // script). Modules reach them as bare globals because legacy-app.js
          // declares them at top-level or attaches them to window. These are
          // the last-mile bridges — as legacy-app.js content moves into
          // proper modules, entries here should be trimmed to match.
          'App',                    // window.App = {...} — top-level namespace
          'map', 'layers',          // Leaflet map instance + layer refs
          'TILES', 'OFFICE_MARKERS',// Tile config + office marker cache
          'buildEmployees',
          'selectIncident',
          'setMapToolsTab',
          'clearFence', 'pointInFence',
          'hazardPopupHTML',
          'applyTileOverlays',
          'visibleIncidents',
          'loadEmpCSV', 'loadTravCSV',
          '_fmtTravDate', '_fmtTravTime',
          '_riskSearchDebounce',
        ].map(name => [name, 'readonly'])),
      },
    },
    rules: {
      // The main safety net — catches typos of bridged identifiers.
      'no-undef': 'error',

      // Style rules are OFF — this is not a style linter, it's a typo
      // catcher. Add specific rules as they become worth the friction.
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
      'no-async-promise-executor': 'off',
      'no-cond-assign': 'off',
    },
  },
];
