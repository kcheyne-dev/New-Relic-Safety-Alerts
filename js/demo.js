/**
 * NRSA / S.T.A.R. View — demo mode + synthetic test scenarios.
 *
 * Two side-effect functions, both gated on `#api=mock` in the URL hash:
 *   - bootDemoMode()       — cycling alert + traveler simulator (~25-70s injects,
 *                            45s traveler hops, occasional Extreme injection)
 *   - bootTestScenarios()  — operator-triggered fixtures with a 🧪 Tests pill,
 *                            three preset scenarios (Office / Traveler / BCI),
 *                            and a 🧹 Clear pill
 *
 * STATUS (2026-06-19, cleanup #4): LIVE source. The two inline IIFEs in
 * legacy-app.js were replaced with bridged calls — see main.js step 11 and
 * legacy-app.js's "22-23. DEMO MODE + SYNTHETIC TEST SCENARIOS" block.
 *
 * Both functions touch a wide bare-reference surface that resolves at call
 * time via window-fallthrough (main.js sets up the bridges before
 * legacy-app.js runs):
 *
 *   - State (state.js bridge):     state.ALERTS, state.TRAVELERS, state.EMPLOYEES,
 *                                  state.REMOTE_EMPLOYEES, state.ACLED_RISK,
 *                                  state.WHO_OUTBREAKS, state.BCP_FORM, STATE
 *   - Pipeline (render.js bridge): renderAll, enrichEventWithImpact,
 *                                  buildEmployees, addAlert, removeAlert
 *   - Modals (modals.js bridge):   showModal, App.closeModal,
 *                                  showBCPModal, toast
 *   - Helpers (helpers.js bridge): esc, uid, isoTime, etc.
 *   - API_BASE (api.js bridge)     used only for the live-mode short-circuit
 *
 * The bare references are inside function bodies, not at module top level,
 * so the module imports cleanly even though none of the bridged identifiers
 * exist at import time.
 */

import { OFFICE_BY_ID } from './constants.js';
import {
  OFFICE_HEADCOUNTS_MOCK,
  TRAVELERS_MOCK,
  REMOTE_EMPLOYEES_MOCK,
  ACLED_RISK_MOCK,
  WHO_OUTBREAKS_MOCK,
} from './mock-data.js';
// Bridge-cleanup demo.js full migration (2026-07-13, no ESLint trim):
// last non-legacy-app module. Zero STATE.X refs (checked); reassignable
// state migration is the meat of this batch. No circular imports
// introduced (no other module imports from demo.js).
//
// Substring-hazard note: demo.js is the ONLY module with _MOCK variant
// identifiers (TRAVELERS_MOCK, REMOTE_EMPLOYEES_MOCK, WHO_OUTBREAKS_MOCK,
// ACLED_RISK_MOCK) plus state.REMOTE_EMPLOYEES itself. Migration required
// 5-phase protection: protect _MOCK variants, protect state.REMOTE_EMPLOYEES,
// substitute the bare identifiers, restore state.REMOTE_EMPLOYEES with state
// prefix, restore _MOCK variants unchanged.
import { state } from './state.js';
import { esc, uid } from './helpers.js';
import { closeModal, showModal, toast } from './modals.js';
import { renderAll } from './render.js';
import { API_BASE } from './api.js';

/* =========================================================================
   DEMO MODE — cycling alert + traveler simulator
   -------------------------------------------------------------------------
   Activates ONLY when the URL explicitly carries `#api=mock`.
   • The bare GitHub Pages URL (auto-detected mock mode) does NOT run the
     demo — Pages stays clean for stakeholder viewing.
   • Use file://...index.html#api=mock or any URL with that hash to opt in.
   • Enriches initial seed state.ALERTS so they pass the officeRelevantOnly filter.
   • Adds new alerts on a 25–70s cycle, with 4–9 min lifetime each.
   • Shifts a random traveler to their next leg every 45s, with toast.
   • Occasional Extreme injection so the status-strip wash + Crisis Comm
     fast-path get exercised on the demo URL.
   • Subtle DEMO MODE badge pinned top-right with click-to-pause.
   Localhost / file:// without hash (live mode) is unaffected.
   ========================================================================= */
export function bootDemoMode() {
  if (!API_BASE && /[#&]api=mock/.test(location.hash)) {
    (function bootDemoModeInner() {
      const DEMO = {
        paused: false,
        newAlertEverySec: { min: 25, max: 70 },
        alertLifetimeSec: { min: 240, max: 540 },   // 4–9 minutes
        maxActiveDemo: 18,
        travelerMoveEverySec: 45,                   // every 45s — demo-speed so movement is visible
        extremeChance: 0.08,                        // 8% of injections are Extreme
        timers: {},
        demoIds: new Set(),
      };

      /* Pool of alert templates. Mix of severities, types, geos.
         Weighted toward office-proximity events so 🎯 view feels populated. */
      const POOL = [
        // ── San Francisco ──
        { sev:'high', type:'Public Safety', source:'Socrata',  officeId:'SFO',
          title:'Suspicious package — Embarcadero Plaza, cordon active',
          location:'San Francisco', lat:37.795, lng:-122.394, radiusKm:1,
          summary:'SFPD investigating; perimeter cordon active. Office on lockdown advisory.' },
        { sev:'mod',  type:'Civil Unrest', source:'ACLED',     officeId:'SFO',
          title:'Demonstration forming — Market & 5th',
          location:'San Francisco', lat:37.783, lng:-122.408, radiusKm:2,
          summary:'~300 participants. Estimated peak 16:00 local. Avoid Market between 4th–7th.' },
        { sev:'mod',  type:'Natural Disaster', source:'NASA EONET', officeId:'SFO',
          title:'Wildfire smoke advisory — AQI 168',
          location:'Bay Area', lat:38.0, lng:-122.4, radiusKm:120,
          summary:'PurpleAir reading 168 (Unhealthy). N95s recommended outdoors.' },
        { sev:'ext',  type:'Natural Disaster', source:'USGS',   officeId:'SFO',
          title:'M5.4 earthquake — 14km W of San Francisco',
          location:'San Francisco', lat:37.78, lng:-122.55, radiusKm:80,
          summary:'Strong shaking near Hayward fault. Initial reports of facade damage downtown.' },

        // ── Portland ──
        { sev:'mod',  type:'Public Safety', source:'PDX FlashAlert', officeId:'PDX',
          title:'Multi-vehicle accident — I-5 SB at Burnside',
          location:'Portland', lat:45.523, lng:-122.677, radiusKm:3,
          summary:'Two right lanes blocked. Expect 30+ min commute delay.' },
        { sev:'low',  type:'Travel Advisory', source:'NWS',     officeId:'PDX',
          title:'Winter weather advisory — freezing rain overnight',
          location:'Portland', lat:45.519, lng:-122.679, radiusKm:50,
          summary:'Light freezing rain 02:00–08:00. Surfaces may be slick.' },

        // ── Atlanta ──
        { sev:'high', type:'Natural Disaster', source:'NWS',    officeId:'ATL',
          title:'Tornado warning — Fulton & DeKalb counties',
          location:'Atlanta', lat:33.749, lng:-84.388, radiusKm:35,
          summary:'NWS Doppler-confirmed rotation. Take shelter in interior room. Active until 18:45 local.' },
        { sev:'mod',  type:'Natural Disaster', source:'NWS',    officeId:'ATL',
          title:'Severe thunderstorm — line of cells moving E at 35kt',
          location:'Atlanta metro', lat:33.78, lng:-84.39, radiusKm:80,
          summary:'Hail to 1.5", winds to 60 mph. Shelter recommended.' },

        // ── Barcelona ──
        { sev:'mod',  type:'Natural Disaster', source:'MeteoAlarm', officeId:'BCN',
          title:'Heavy rain & flood watch — Catalonia',
          location:'Barcelona', lat:41.385, lng:2.17, radiusKm:80,
          summary:'Orange-level alert for heavy precipitation through 22:00 local.' },
        { sev:'high', type:'Civil Unrest', source:'ACLED',     officeId:'BCN',
          title:'General strike call — Plaça de Catalunya gathering',
          location:'Barcelona', lat:41.387, lng:2.170, radiusKm:2,
          summary:'Estimated 8k participants. Metro lines L1/L3 partial closures.' },

        // ── Dublin ──
        { sev:'high', type:'Public Safety', source:'GDELT',    officeId:'DUB',
          title:'Suspicious package — Liffey Quay (cordon active)',
          location:'Dublin', lat:53.347, lng:-6.247, radiusKm:1,
          summary:'AGS bomb squad on scene. Roads closed Eden Quay to O\'Connell Bridge.' },
        { sev:'low',  type:'Public Safety', source:'GDELT',    officeId:'DUB',
          title:'Dublin Bus & Luas service reductions — industrial action',
          location:'Dublin', lat:53.349, lng:-6.260, radiusKm:8,
          summary:'Reduced service Tue–Thu. Recommend remote-first.' },

        // ── London ──
        { sev:'mod',  type:'Civil Unrest', source:'ACLED',     officeId:'LON',
          title:'Planned protest — Westminster, possible road closures',
          location:'London', lat:51.501, lng:-0.124, radiusKm:3,
          summary:'Multiple groups gathering at Parliament Square 14:00 local. MPS advising avoidance of Whitehall.' },
        { sev:'mod',  type:'Natural Disaster', source:'MeteoAlarm', officeId:'LON',
          title:'Severe winds — gusts to 95 km/h forecast',
          location:'Greater London', lat:51.510, lng:-0.130, radiusKm:50,
          summary:'Yellow wind warning. Possible transit disruption on overground.' },
        { sev:'high', type:'Public Safety', source:'TfL',      officeId:'LON',
          title:'Major Tube disruption — Jubilee & Bakerloo suspended',
          location:'London', lat:51.513, lng:-0.116, radiusKm:5,
          summary:'Power-supply incident at Baker Street. No service expected before 19:00.' },

        // ── Tokyo ──
        { sev:'ext',  type:'Natural Disaster', source:'USGS',  officeId:'TYO',
          title:'M6.1 earthquake — 18km E of Tokyo, depth 32km',
          location:'Tokyo', lat:35.69, lng:140.0, radiusKm:200,
          summary:'Strong shaking reported across Kanto region. Tsunami advisory NOT issued. Structural integrity check recommended.' },
        { sev:'high', type:'Natural Disaster', source:'EMSC',  officeId:'TYO',
          title:'Aftershock M4.8 near Tokyo Bay',
          location:'Tokyo Bay', lat:35.6, lng:140.05, radiusKm:80,
          summary:'Aftershock following earlier M6.1. No new damage reported.' },
        { sev:'mod',  type:'Natural Disaster', source:'GDACS', officeId:'TYO',
          title:'Tropical storm watch — distant approach to Honshu',
          location:'Tokyo', lat:35.68, lng:139.65, radiusKm:300,
          summary:'72h monitoring. Possible service disruption Sun–Mon.' },

        // ── Bengaluru ──
        { sev:'high', type:'Natural Disaster', source:'MeteoAlarm', officeId:'BLR',
          title:'Heavy monsoon flooding — multiple zones',
          location:'Bengaluru', lat:12.97, lng:77.59, radiusKm:30,
          summary:'IMD red alert. Outer Ring Road impassable in stretches. Avoid travel.' },
        { sev:'ext',  type:'Civil Unrest', source:'ACLED',    officeId:'BLR',
          title:'Civil unrest — Whitefield, escalation reported',
          location:'Bengaluru', lat:12.972, lng:77.595, radiusKm:5,
          summary:'Demonstrations turned confrontational. Multiple injuries reported. Avoid Whitefield corridor.' },
        { sev:'mod',  type:'Public Safety', source:'GDELT',   officeId:'BLR',
          title:'Power grid advisory — rolling outages 14:00–18:00',
          location:'Bengaluru', lat:12.95, lng:77.60, radiusKm:25,
          summary:'BESCOM scheduled load-shedding. UPS/generator verification recommended.' },

        // ── Hyderabad ──
        { sev:'mod',  type:'Natural Disaster', source:'NWS',  officeId:'HYD',
          title:'Heat advisory — humidity index 47°C',
          location:'Hyderabad', lat:17.385, lng:78.486, radiusKm:50,
          summary:'Heat index above 47°C through Thursday. Hydration breaks recommended.' },
        { sev:'high', type:'Public Safety', source:'GDELT',   officeId:'HYD',
          title:'Power grid failure — Madhapur sector affected',
          location:'Hyderabad', lat:17.441, lng:78.382, radiusKm:8,
          summary:'Substation fault. Estimated restoration 4–6 hours. UPS verification urgent.' },
        { sev:'low',  type:'Civil Unrest', source:'ACLED',    officeId:'HYD',
          title:'Permitted demonstration — IT Corridor, low activity',
          location:'Hyderabad', lat:17.45, lng:78.38, radiusKm:3,
          summary:'~150 participants, peaceful assembly. No traffic impact expected.' },

        // ── Travel advisories (traveler-targeted) ──
        { sev:'mod',  type:'Travel Advisory', source:'State Dept', officeId:null,
          title:'L3 Reconsider Travel — political volatility',
          location:'Mexico City region', lat:19.4326, lng:-99.1332, radiusKm:0,
          summary:'Crime and kidnapping risk elevated. Affects travelers in Mexico City.' },
        { sev:'high', type:'Civil Unrest', source:'ACLED',    officeId:null,
          title:'Flash protest — central Singapore transit zone',
          location:'Singapore', lat:1.3521, lng:103.8198, radiusKm:3,
          summary:'Crowd aggregation near Raffles Place MRT. Traveler proximity flagged.' },
        { sev:'mod',  type:'Travel Advisory', source:'State Dept', officeId:null,
          title:'L2 Exercise increased caution — UAE',
          location:'Dubai', lat:25.2048, lng:55.2708, radiusKm:0,
          summary:'Routine advisory updated. Affects 1 employee currently in Dubai.' },
        { sev:'high', type:'Natural Disaster', source:'GDACS', officeId:null,
          title:'Typhoon track update — Cat 3 approaching Seoul',
          location:'Seoul', lat:37.5665, lng:126.978, radiusKm:200,
          summary:'Landfall projected 36h. Traveler in region — advise evac or shelter.' },
        { sev:'low',  type:'Travel Advisory', source:'State Dept', officeId:null,
          title:'L1 Exercise normal precautions — Berlin',
          location:'Berlin', lat:52.52, lng:13.405, radiusKm:0,
          summary:'Standard advisory. 1 traveler currently lodged.' },
      ];

      /* Slight per-injection variation: randomize magnitude, AQI, headcount
         in the title/summary so back-to-back identical templates feel distinct. */
      function variantize(t) {
        const c = { ...t };
        if (c.source === 'USGS' && /M\d/.test(c.title)) {
          const m = (4.6 + Math.random() * 1.8).toFixed(1);
          c.title = c.title.replace(/M\d\.\d/, 'M' + m);
          c.sev = parseFloat(m) >= 6.0 ? 'ext' : parseFloat(m) >= 5.2 ? 'high' : 'mod';
        }
        if (/AQI \d/.test(c.title)) {
          const aqi = 130 + Math.floor(Math.random() * 90);
          c.title = c.title.replace(/AQI \d+/, 'AQI ' + aqi);
          c.summary = c.summary.replace(/\d+ \(Unhealthy\)/, aqi + ' (Unhealthy)');
        }
        return c;
      }

      function pickAlert() {
        const wantExtreme = Math.random() < DEMO.extremeChance;
        const filtered = POOL.filter(p => wantExtreme ? p.sev === 'ext' : p.sev !== 'ext');
        const pool = filtered.length ? filtered : POOL;
        const tmpl = pool[Math.floor(Math.random() * pool.length)];
        const v = variantize(tmpl);
        return enrichEventWithImpact({
          ...v,
          id: 'demo-' + Math.random().toString(36).slice(2, 9),
          issued: new Date().toISOString(),
        });
      }

      function injectAlert() {
        if (DEMO.paused) { scheduleNext(); return; }
        const a = pickAlert();
        state.ALERTS = [a, ...state.ALERTS];
        DEMO.demoIds.add(a.id);
        // Schedule its removal
        const lifeMs = (DEMO.alertLifetimeSec.min + Math.random() *
          (DEMO.alertLifetimeSec.max - DEMO.alertLifetimeSec.min)) * 1000;
        setTimeout(() => removeAlert(a.id), lifeMs);
        // Trim if we've exceeded the demo cap
        const demoActive = state.ALERTS.filter(x => DEMO.demoIds.has(x.id));
        while (demoActive.length > DEMO.maxActiveDemo) {
          const oldest = demoActive[demoActive.length - 1];
          removeAlert(oldest.id);
          demoActive.pop();
        }
        renderAll();
        // If Extreme, briefly pulse the status strip (renderAll already handles styling)
        scheduleNext();
      }

      function removeAlert(id) {
        if (!DEMO.demoIds.has(id)) return;
        state.ALERTS = state.ALERTS.filter(a => a.id !== id);
        DEMO.demoIds.delete(id);
        renderAll();
      }

      function scheduleNext() {
        const r = DEMO.newAlertEverySec;
        const next = (r.min + Math.random() * (r.max - r.min)) * 1000;
        DEMO.timers.nextAlert = setTimeout(injectAlert, next);
      }

      /* Traveler movement — multi-leg itineraries.
         Every travelerMoveEverySec, a random traveler advances one leg. */
      const TRAVELER_LEGS = {
        t1:  [ {city:'Singapore',     lat:1.3521,  lng:103.8198, type:'hotel',  atOffice:null},
               {city:'Bengaluru',     lat:OFFICE_BY_ID.BLR.lat, lng:OFFICE_BY_ID.BLR.lng, type:'office', atOffice:'BLR'},
               {city:'Hong Kong',     lat:22.3193, lng:114.1694, type:'hotel',  atOffice:null} ],
        t2:  [ {city:'Mexico City',   lat:19.4326, lng:-99.1332, type:'hotel',  atOffice:null},
               {city:'San Francisco', lat:OFFICE_BY_ID.SFO.lat, lng:OFFICE_BY_ID.SFO.lng, type:'office', atOffice:'SFO'},
               {city:'Austin',        lat:30.2672, lng:-97.7431, type:'hotel',  atOffice:null} ],
        t3:  [ {city:'Dubai',         lat:25.2048, lng:55.2708,  type:'hotel',  atOffice:null},
               {city:'London',        lat:OFFICE_BY_ID.LON.lat, lng:OFFICE_BY_ID.LON.lng, type:'office', atOffice:'LON'},
               {city:'Istanbul',      lat:41.0082, lng:28.9784,  type:'hotel',  atOffice:null} ],
        t4:  [ {city:'Paris',         lat:48.8566, lng:2.3522,   type:'hotel',  atOffice:null},
               {city:'Dublin',        lat:OFFICE_BY_ID.DUB.lat, lng:OFFICE_BY_ID.DUB.lng, type:'office', atOffice:'DUB'},
               {city:'Amsterdam',     lat:52.3676, lng:4.9041,   type:'hotel',  atOffice:null} ],
        t5:  [ {city:'Seoul',         lat:37.5665, lng:126.978,  type:'hotel',  atOffice:null},
               {city:'Tokyo',         lat:OFFICE_BY_ID.TYO.lat, lng:OFFICE_BY_ID.TYO.lng, type:'office', atOffice:'TYO'},
               {city:'Taipei',        lat:25.0330, lng:121.5654, type:'hotel',  atOffice:null} ],
        t8:  [ {city:'Berlin',        lat:52.52,   lng:13.405,   type:'hotel',  atOffice:null},
               {city:'Bengaluru',     lat:OFFICE_BY_ID.BLR.lat, lng:OFFICE_BY_ID.BLR.lng, type:'office', atOffice:'BLR'},
               {city:'Munich',        lat:48.1351, lng:11.5820,  type:'hotel',  atOffice:null} ],
        t9:  [ {city:'JFK→LHR',       lat:30.0,    lng:-40.0,    type:'flight', atOffice:null},
               {city:'London',        lat:OFFICE_BY_ID.LON.lat, lng:OFFICE_BY_ID.LON.lng, type:'office', atOffice:'LON'},
               {city:'LHR→PDX',       lat:55.0,    lng:-50.0,    type:'flight', atOffice:null} ],
        t12: [ {city:'Reykjavik',     lat:64.1466, lng:-21.9426, type:'hotel',  atOffice:null},
               {city:'Dublin',        lat:OFFICE_BY_ID.DUB.lat, lng:OFFICE_BY_ID.DUB.lng, type:'office', atOffice:'DUB'},
               {city:'Edinburgh',     lat:55.9533, lng:-3.1883,  type:'hotel',  atOffice:null} ],
      };
      const legCounters = {};

      function moveTraveler() {
        if (DEMO.paused) return;
        const tids = Object.keys(TRAVELER_LEGS);
        const tid = tids[Math.floor(Math.random() * tids.length)];
        const legs = TRAVELER_LEGS[tid];
        legCounters[tid] = ((legCounters[tid] || 0) + 1) % legs.length;
        const leg = legs[legCounters[tid]];
        const idx = state.TRAVELERS.findIndex(t => t.id === tid);
        if (idx >= 0) {
          const before = state.TRAVELERS[idx];
          state.TRAVELERS[idx] = { ...before,
            destCity: leg.city, lat: leg.lat, lng: leg.lng, type: leg.type, atOffice: leg.atOffice };
          // Re-enrich active alerts so traveler-proximity badges refresh
          state.ALERTS = state.ALERTS.map(a => enrichEventWithImpact(a));
          renderAll();
          // Toast so the movement is visible to a watching operator
          try { toast(`✈ ${before.name} → ${leg.city}`); } catch (_) {}
        }
      }

      /* DEMO MODE badge — top-right, click to pause/resume */
      function injectBadge() {
        const b = document.createElement('div');
        b.id = 'demo-badge';
        b.style.cssText = [
          'position:fixed', 'top:10px', 'right:14px', 'z-index:9999',
          'background:#7a3aff', 'color:#fff', 'padding:5px 11px',
          'border-radius:14px', 'font:11px/1.4 system-ui,-apple-system,sans-serif',
          'cursor:pointer', 'opacity:0.92', 'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
          'user-select:none', 'letter-spacing:0.3px'
        ].join(';');
        b.textContent = '▶ DEMO MODE';
        b.title = 'Cycling alerts and traveler movement. Click to pause/resume.';
        b.addEventListener('click', () => {
          DEMO.paused = !DEMO.paused;
          b.textContent = DEMO.paused ? '⏸ DEMO PAUSED' : '▶ DEMO MODE';
          b.style.background = DEMO.paused ? '#666' : '#7a3aff';
        });
        document.body.appendChild(b);
      }

      /* Boot */
      // 0. Load mock people-data: office headcounts, travelers, remote employees,
      //    plus ACLED risk rollups for the BCI Country Risk Profile panel.
      //    All four surfaces (Travelers modal, ✈ proximity badges, BCI exposure
      //    readout, office bubbles, alert cards, BCI risk profile) need this to
      //    render with numbers. All four stay empty / undefined in live + bare
      //    Pages mode and the UI shows "pending Workday/Navan/ACLED integration"
      //    placeholders instead.
      OFFICES.forEach(o => { o.headcount = OFFICE_HEADCOUNTS_MOCK[o.id]; });
      // buildEmployees() ran on initial parse with no headcounts (returned []).
      // Now that OFFICES.headcount is populated, rebuild the synthetic employee
      // scatter so map dots / By-Office plotting / Office Manager view all populate.
      state.EMPLOYEES = buildEmployees();
      state.TRAVELERS = TRAVELERS_MOCK.slice();
      state.ACLED_RISK = { ...ACLED_RISK_MOCK };
      state.WHO_OUTBREAKS = WHO_OUTBREAKS_MOCK.slice();
      state.REMOTE_EMPLOYEES = REMOTE_EMPLOYEES_MOCK.slice();
      // 1. Enrich existing seed state.ALERTS so they pass the officeRelevantOnly filter
      state.ALERTS = state.ALERTS.map(a => enrichEventWithImpact(a));
      renderAll();
      // 2. Inject the badge
      injectBadge();
      // 3. Seed a few demo alerts in the first ~10s so the cycle is visible immediately
      setTimeout(injectAlert, 1500);
      setTimeout(injectAlert, 5000);
      setTimeout(injectAlert, 9000);
      // 4. Continuous cycling
      scheduleNext();
      setTimeout(moveTraveler, 8000);  // first traveler hop ~8s in so it's visible quickly
      DEMO.timers.travMove = setInterval(moveTraveler, DEMO.travelerMoveEverySec * 1000);
    })();
  }
}

/* =========================================================================
   SYNTHETIC TEST SCENARIOS — operator-triggered fixtures
   -------------------------------------------------------------------------
   Activates when the URL carries `#api=mock` (same gate as the demo cycler).
   Adds a small launcher button that opens a modal with three preset
   scenarios. Useful for validating the alert / Crisis Comm / Incident /
   BCI flows end-to-end without waiting for real events.

   Synthetic alerts are tagged with id prefix `test-` so the Clear button
   can remove them in one shot without touching real or demo events
   (which use `demo-` prefix). They flow through the same
   enrichEventWithImpact + state.ALERTS + renderAll pipeline as everything else,
   so the dashboard treats them identically.
   ========================================================================= */
export function bootTestScenarios() {
  if (!API_BASE && /[#&]api=mock/.test(location.hash)) {
    (function bootTestScenariosInner() {
      function syntheticCount() {
        return state.ALERTS.filter(a => String(a.id).startsWith('test-')).length;
      }

      /* Single top-center container that holds all three mock-mode pills:
         Tests · Clear · DEMO MODE. Built lazily; we move the existing
         demo-badge into it once both IIFEs have run. */
      function ensurePillContainer() {
        let c = document.getElementById('mock-pill-container');
        if (c) return c;
        c = document.createElement('div');
        c.id = 'mock-pill-container';
        c.style.cssText = [
          'position:fixed', 'top:10px', 'left:50%', 'transform:translateX(-50%)',
          'z-index:9999', 'display:flex', 'gap:8px', 'align-items:center',
          'pointer-events:none',  // child elements override; lets clicks pass through gaps
        ].join(';');
        document.body.appendChild(c);
        return c;
      }

      /* Common pill styling — only color/text varies per pill. */
      function pillStyleBase(bg, fg) {
        return [
          `background:${bg}`, `color:${fg}`, 'padding:5px 11px',
          'border-radius:14px', 'font:11px/1.4 system-ui,-apple-system,sans-serif',
          'cursor:pointer', 'opacity:0.92', 'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
          'user-select:none', 'letter-spacing:0.3px', 'font-weight:700',
          'pointer-events:auto',  // re-enable click handling on the pill itself
        ].join(';');
      }

      function refreshClearPill() {
        const existing = document.getElementById('test-clear-pill');
        const n = syntheticCount();
        if (n === 0) {
          if (existing) existing.remove();
          return;
        }
        if (existing) {
          existing.textContent = `🧹 Clear ${n}`;
          return;
        }
        const container = ensurePillContainer();
        const p = document.createElement('div');
        p.id = 'test-clear-pill';
        p.style.cssText = pillStyleBase('#f87171', '#1a0808');
        p.textContent = `🧹 Clear ${n}`;
        p.title = 'Clear all synthetic test events';
        p.addEventListener('click', clearSynthetic);
        // Insert after Tests, before DEMO MODE (if both exist)
        const launcher = document.getElementById('test-launcher');
        if (launcher && launcher.parentNode === container) {
          container.insertBefore(p, launcher.nextSibling);
        } else {
          container.appendChild(p);
        }
      }

      function injectAndRender(alert) {
        const enriched = enrichEventWithImpact(alert);
        state.ALERTS = [enriched, ...state.ALERTS.filter(a => a.id !== alert.id)];
        renderAll();
        refreshClearPill();
        try { toast(`🧪 Injected: ${alert.title}`); } catch (_) {}
      }

      // Scenario 1 — Office threat: M6.5 quake 28 km E of SFO
      function fireOfficeThreat() {
        const sfo = OFFICE_BY_ID.SFO;
        injectAndRender({
          id: 'test-office-' + Date.now(),
          sev: 'ext',
          type: 'Natural Disaster',
          source: 'USGS',
          officeId: 'SFO',
          lat: sfo.lat + 0.05,           // ~5 km N
          lng: sfo.lng + 0.30,           // ~25 km E (combined ~28 km)
          radiusKm: 200,
          title: 'M6.5 earthquake — 28 km E of San Francisco, depth 12 km',
          summary: 'Strong shaking reported near Hayward fault. Initial reports of facade damage downtown. No tsunami advisory issued.',
          issued: new Date().toISOString(),
        });
        App.closeModal();
      }

      // Scenario 2 — Traveler threat: civil unrest at a current non-office traveler's city
      function fireTravelerThreat() {
        const t = state.TRAVELERS.find(tr => !tr.atOffice && tr.type !== 'flight') || state.TRAVELERS[0];
        if (!t) {
          try { toast('No traveler available for synthetic threat.'); } catch (_) {}
          App.closeModal();
          return;
        }
        injectAndRender({
          id: 'test-traveler-' + Date.now(),
          sev: 'high',
          type: 'Civil Unrest',
          source: 'ACLED',
          officeId: null,
          lat: t.lat,
          lng: t.lng,
          radiusKm: 5,
          title: `Mass demonstration with confrontations — ${t.destCity}`,
          summary: `Multiple injuries reported. Curfew possible in affected districts. Traveler ${t.name} flagged within proximity radius.`,
          issued: new Date().toISOString(),
        });
        App.closeModal();
      }

      // Scenario 3 — BCI declaration: pre-fill the existing BCI modal for a Japan quake
      function fireBciScenario() {
        App.closeModal();
        Object.assign(state.BCP_FORM, {
          eventTypeId: 'quake',
          title: 'M7.4 earthquake — Tohoku coast, Japan',
          countries: ['Japan'],
          useFence: false,
          templateId: 'bc_announce',
          customMessage: '',
          acknowledged: false,
        });
        showBCPModal(true);   // preserve=true so our pre-fill isn't wiped
        try { toast('🚨 BCI pre-filled — review and Declare'); } catch (_) {}
      }

      // Clear all synthetic events (does not touch demo or real events).
      // Callable from either the in-modal Clear button or the floating pill.
      function clearSynthetic() {
        const before = state.ALERTS.length;
        state.ALERTS = state.ALERTS.filter(a => !String(a.id).startsWith('test-'));
        const removed = before - state.ALERTS.length;
        renderAll();
        refreshClearPill();
        App.closeModal();   // idempotent — fine when called from the floating pill
        try { toast(`🧹 Cleared ${removed} synthetic event${removed === 1 ? '' : 's'}`); } catch (_) {}
      }

      function openTestModal() {
        const t = state.TRAVELERS.find(tr => !tr.atOffice && tr.type !== 'flight') || state.TRAVELERS[0];
        const travelerLabel = t ? `${t.destCity} (${t.name})` : 'no traveler available';
        const html = `<div style="width:min(560px,92vw);">
          <div style="padding:14px 18px;border-bottom:1px solid var(--border);">
            <div style="font-size:15px;font-weight:700;">🧪 Synthetic Test Scenarios</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Mock-mode only. Each scenario injects a tagged event you can clear in one click.</div>
          </div>
          <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px;">
            <button class="btn-ghost" id="test-office-btn" style="text-align:left;padding:10px 12px;">
              <div style="font-weight:600;">🏢 Office threat — M6.5 near SFO</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">Validates Extreme alert card, status-strip wash, impact badges, Crisis Comm pre-fill.</div>
            </button>
            <button class="btn-ghost" id="test-traveler-btn" style="text-align:left;padding:10px 12px;">
              <div style="font-weight:600;">✈ Traveler threat — civil unrest at ${esc(travelerLabel)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">Validates traveler-proximity badge and Crisis Comm traveler context. Picks the first non-office traveler at injection time.</div>
            </button>
            <button class="btn-ghost" id="test-bci-btn" style="text-align:left;padding:10px 12px;">
              <div style="font-weight:600;">🚨 BCI declaration — Tohoku M7.4 earthquake (Japan)</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">Pre-fills the BCI modal. Validates exposure readout (TYO + travelers + remote employees in Japan).</div>
            </button>
          </div>
          <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;">
            <button class="btn-ghost" id="test-clear-btn" style="font-size:11px;">🧹 Clear synthetic events</button>
            <button class="btn-ghost" onclick="App.closeModal()">Close</button>
          </div>
        </div>`;
        showModal(html);
        document.getElementById('test-office-btn').onclick   = fireOfficeThreat;
        document.getElementById('test-traveler-btn').onclick = fireTravelerThreat;
        document.getElementById('test-bci-btn').onclick      = fireBciScenario;
        document.getElementById('test-clear-btn').onclick    = clearSynthetic;
      }

      /* Launcher pill — first slot in the shared top-center container. We also
         move the demo simulator's badge into the container here (it was
         absolute-positioned by its own IIFE; we strip those styles and
         re-flow it as a flex child so the three pills line up cleanly). */
      function injectLauncher() {
        const container = ensurePillContainer();

        // Tests pill
        const b = document.createElement('div');
        b.id = 'test-launcher';
        b.style.cssText = pillStyleBase('#06b6d4', '#062c34');
        b.textContent = '🧪 Tests';
        b.title = 'Synthetic test scenarios — Office / Traveler / BCI';
        b.addEventListener('click', openTestModal);
        container.appendChild(b);

        // Adopt the DEMO MODE badge: strip its position:fixed/top/right and
        // make it a flex child so it sits next to the Tests pill.
        const demoBadge = document.getElementById('demo-badge');
        if (demoBadge) {
          demoBadge.style.position = 'static';
          demoBadge.style.top = '';
          demoBadge.style.right = '';
          demoBadge.style.pointerEvents = 'auto';
          container.appendChild(demoBadge);  // re-append moves it to end
        }
      }

      injectLauncher();
    })();
  }
}
