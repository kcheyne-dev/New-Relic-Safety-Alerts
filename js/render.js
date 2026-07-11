/**
 * NRSA / S.T.A.R. View — render pipeline + view-state utilities.
 *
 * SESSION 3 / step 9 (2026-06-19): the largest extraction. ~45 functions
 * covering every render path in the dashboard:
 *   - Map: renderOffices/officePopup/renderAlertDots/alertPopupHTML/
 *          renderEmployees/renderTravelers/renderHazardZones/renderHazards
 *   - Alert feed: renderRailAlerts/renderFeed/alertCardHTML/selectAlert
 *   - Crisis Comms panel: renderCC/setCcTab/renderComposeForm/renderCCLog/
 *                          renderRoom/wireAttZone/bindCCHandlers/
 *                          renderTemplatePickerOptions/hasDraftContent
 *   - Incidents panel: renderIncidents and the full detail/comms/responses/
 *                      notes/log tab pipeline + bindIncident*Handlers
 *   - Map Tools dropdown: buildLayerControls/positionToolsDropdown
 *   - Panels: openPanel/closePanel/togglePanel + applyPanelWidths/setupPanelResize
 *   - Status strip: renderStatusStrip + startStatusStripTicker (with module-
 *                    private _statusStripTicker timer ref)
 *   - Theme + freshness: applyTheme + showFreshness
 *   - Master orchestrator: renderAll
 *
 * BRIDGE RELIANCE (function bodies stay verbatim — bare-identifier reads
 * fall through to window via the main.js bridge):
 *   - State: STATE, state.ALERTS, state.TRAVELERS, state.EMPLOYEES, state.REMOTE_EMPLOYEES,
 *            state.WHO_OUTBREAKS, state.ACLED_RISK, state.OPERATOR (via state.js bridge)
 *   - Constants: SEV_NAME/RANK/COLOR, OFFICES, OFFICE_BY_ID, ALERT_TYPES,
 *                COUNTRY_PRESENCE, TEMPLATES, etc. (via constants.js bridge)
 *   - Helpers: esc, linkify, fmtSize, fmtHeadcount, sumHeadcount, relTime,
 *              passesFilter, visibleAlerts, alertCountryFor, alertPriorityScore,
 *              topScore, _emptyHazardRollup, etc. (via helpers.js bridge)
 *   - Modal-side fns: showModal, closeModal, toast, showRiskProfileModal,
 *                     showBCPModal, showTravelersList, suggestTemplate,
 *                     confirmSend, dispatchSend (still in legacy-app.js
 *                     pending step-10 extraction; on window via classic-script
 *                     function-decl global hoisting)
 *   - Persistence: saveState (called by every state mutation), exportData,
 *                  showAlertDetails, exportIncidentReport (via persistence.js bridge)
 *   - API: bootLiveMode, incidentsApi, commsApi (via api.js bridge)
 *   - Leaflet/map: layers, map, OFFICE_MARKERS — these are CLOSURE-captured
 *                  globals from legacy-app.js's Leaflet init (line ~399).
 *                  Render functions reference them via window-fallthrough but
 *                  they're var-decl'd so they ARE on window for classic scripts.
 *
 * The status-strip ticker boot trigger (`setTimeout(startStatusStripTicker, 0)`)
 * lives in legacy-app.js's tail — it kicks off the once-per-minute re-render
 * loop after the bridge is ready. Same rationale as bootLiveMode.
 */

// Bridge-cleanup render.js constants hygiene (2026-07-13, Phase 2 of
// legacy-app modularization). Extended imports from {OFFICES, HAZARD_ZONES,
// ...} to cover every constants.js identifier render.js references in code.
// Grep-audit found 10 previously-bare constants: SEVERITY (5 refs), SEV_NAME
// (11), SEV_COLOR (4), SEV_RANK (2), ALERT_TYPES (1), SOURCES (7), TEMPLATES
// (1), TEMPLATE_CATEGORIES (1), TEST_ROUTING (2), OFFICE_BY_ID (6). Adding
// them here unlocks ESLint globals trims — legacy-app.js now imports these
// too (Phase 2 atomic commit), so render.js was the last bare-reader.
import {
  ALERT_TYPES,
  ATT_EMBED_LIMIT,
  HAZARD_ZONES,
  OFFICES,
  OFFICE_BY_ID,
  PANEL_MIN_W,
  PANEL_MAX_W,
  ROLE_TAG_STYLE,
  SEVERITY,
  SEV_COLOR,
  SEV_NAME,
  SEV_RANK,
  SOURCES,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEST_ROUTING,
  TILE_OVERLAYS,
} from './constants.js';
import { state } from './state.js';
// Bridge-cleanup render.js hygiene (2026-07-13): every helper from
// helpers.js that render.js actually calls. No globals trim earned —
// each helper is also called by legacy-app.js (bridge stays) — but
// static analysis + IDE navigation both improve inside render.js.
// Verified via grep for each name; only these 15 are in real use.
import {
  activeAlertsForOffice,
  alertPriorityScore,
  allTemplates,
  attachmentChipHTML,
  esc,
  fileToAttachment,
  fmtHeadcount,
  fmtSize,
  linkify,
  maxSevForOffice,
  recipientsForChannel,
  relTime,
  targetById,
  topScore,
  travelersAtOffice,
  visibleAlerts,
} from './helpers.js';
// Bridge-cleanup render.js cross-module hygiene (2026-07-13, no ESLint trim):
// full explicit-imports posture. Same pattern as modals.js + persistence.js
// hygiene batches. Grep-audit found 18 bridged fns across 4 modules.
//
// Circular imports introduced (safe — all cross-refs are inside function
// bodies, verified by the identical modals.js↔persistence.js circular in
// commit e2c011a):
//   - render.js → modals.js (already: modals.js → render.js for renderAll)
//   - render.js → persistence.js (already: persistence.js → render.js for renderStatusStrip)
// render.js's module top-level is just imports and a private variable
// (_statusStripTicker) — no top-level function calls into these modules,
// so ES module circular resolution is safe.
import {
  closeModal,
  confirmSend,
  dispatchSend,
  showBCPModal,
  showModal,
  showRiskProfileModal,
  showTravelersList,
  toast,
} from './modals.js';
import {
  exportData,
  exportIncidentReport,
  saveState,
  showAlertDetails,
} from './persistence.js';
import {
  API_BASE,
  bootLiveMode,
  commsApi,
  incidentsApi,
} from './api.js';
import {
  addIncidentLog,
  reopenIncident,
} from './incidents.js';
import { outboxChipHTML, outboxEntryForMsg, retryEntry, showOutboxModal } from './outbox.js';

export function isModalOpen() { return !!document.getElementById('modal-back'); }

export function renderOffices() {
  layers.offices.clearLayers();
  for (const k in OFFICE_MARKERS) delete OFFICE_MARKERS[k];
  OFFICES.forEach(o => {
    if (!state.UI_STATE.visibleOffices.includes(o.id)) return;
    const sev = maxSevForOffice(o.id);
    const sevClass = sev ? 's-'+sev : 's-none';
    const visitors = travelersAtOffice(o.id).length;
    // Show headcount only in mock mode; in live mode the bubble is just IATA + visitor badge.
    const hcLabel = o.headcount != null ? ` ${o.headcount}` : '';
    const html = `<div class="office-mk"><span class="sev-dot ${sevClass}"></span>${o.id}${hcLabel}${visitors?`<span class="v-badge">${visitors}✈</span>`:''}</div>`;
    const icon = L.divIcon({ html, className:'', iconSize:[100,22], iconAnchor:[50,11] });
    const m = L.marker([o.lat, o.lng], { icon }).addTo(layers.offices);
    m.bindPopup(officePopup(o));
    OFFICE_MARKERS[o.id] = m;
  });
}

export function officePopup(o) {
  const a = activeAlertsForOffice(o.id);
  const visitors = travelersAtOffice(o.id);
  const sevCounts = SEVERITY.map(s => a.filter(x => x.sev===s).length);
  return `
    <h4>${o.name}, ${o.country}</h4>
    <div class="addr">${o.address}</div>
    <div class="pop-row"><span>Employees</span>${o.headcount != null ? `<b>${fmtHeadcount(o.headcount)}</b>` : `<span style="font-size:11px;color:var(--muted);font-style:italic;">pending Workday integration</span>`}</div>
    <div class="pop-row"><span>Active alerts</span><b>${a.length}</b></div>
    <div class="pop-row" style="gap:4px;flex-wrap:wrap">
      ${SEVERITY.map((s,i)=>sevCounts[i]?`<span class="sev-pill ${s}">${SEV_NAME[s]}: ${sevCounts[i]}</span>`:'').join('')}
    </div>
    ${visitors.length?`<div class="pop-row" style="margin-top:6px"><span>Visiting</span><b>${visitors.length} ✈</b></div>`:''}
    <div style="margin-top:6px">
      ${a.slice(0,3).map(al=>`<div style="font-size:11px;border-top:1px solid var(--border);padding-top:4px;margin-top:4px">
        <span class="sev-pill ${al.sev}">${SEV_NAME[al.sev]}</span>
        <span class="src-pill">${esc(al.source)}</span>
        <div style="margin-top:2px">${esc(al.title)}</div>
        <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          <button class="btn-ghost" style="font-size:10px;padding:2px 6px" onclick="App.showAlertDetails('${esc(al.id)}')">Details</button>
          <button class="btn-ghost" style="font-size:10px;padding:2px 6px;background:rgba(28,231,131,.15);border-color:rgba(28,231,131,.4);color:var(--green)" onclick="App.crisisFromAlert('${esc(al.id)}')">📣 Crisis</button>
        </div>
      </div>`).join('')}
      ${a.length > 3 ? `<div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:center">+${a.length-3} more — open the Alert Feed for full list</div>` : ''}
    </div>
    <div class="pop-actions">
      <button class="btn-ghost" onclick="App.targetOffice('${esc(o.id)}')">📣 Crisis (office-wide)</button>
      <button class="btn-ghost" onclick="App.zoomOffice('${esc(o.id)}')">Zoom</button>
    </div>`;
}

export function alertPopupHTML(a) {
  const src = SOURCES.find(s => s.id === a.source) || { name: a.source };
  const officeBadges = (a.affectedOfficeIds || []).map(id =>
    `<span class="impact-badge impact-office" title="${esc(OFFICE_BY_ID[id]?.name || id)}">🏢 ${esc(id)}</span>`
  ).join(' ');
  const travCount = (a.affectedTravelers || []).length;
  const empCount  = a.totalEmployeesAffected || 0;
  const travBadge = travCount ? `<span class="impact-badge impact-trav">✈ ${travCount}</span>` : '';
  const empBadge  = empCount  ? `<span class="impact-badge impact-emp">👥 ${empCount}</span>`   : '';
  const impactRow = (officeBadges || travBadge || empBadge)
    ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${officeBadges} ${travBadge} ${empBadge}</div>`
    : '';
  return `
    <div style="min-width:240px;max-width:320px">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span class="sev-pill ${a.sev}">${SEV_NAME[a.sev]}</span>
        <span class="src-pill">${esc(src.name || a.source)}</span>
      </div>
      <h4 style="margin:0 0 4px;line-height:1.25">${esc(a.title)}</h4>
      <div class="addr" style="font-size:11px;color:var(--muted)">${esc(a.location || '')} · ${esc(relTime(a.issued))} · ${esc(a.type)}</div>
      ${impactRow}
      <div class="btn-row" style="margin-top:8px;display:flex;gap:6px">
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px" onclick="App.showAlertDetails('${esc(a.id)}')">Details</button>
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;background:rgba(28,231,131,.15);border-color:rgba(28,231,131,.4);color:var(--green)" onclick="App.crisisFromAlert('${esc(a.id)}')">📣 Crisis</button>
      </div>
    </div>`;
}

export function renderAlertDots() {
  layers.alerts.clearLayers();
  visibleAlerts().forEach(a => {
    const popupOpts = { maxWidth: 340, autoPan: true };
    if (a.radiusKm > 0) {
      L.circle([a.lat, a.lng], { radius: a.radiusKm*1000, color: SEV_COLOR[a.sev], weight: 1, fillOpacity: 0.08 })
        .addTo(layers.alerts)
        .bindPopup(alertPopupHTML(a), popupOpts)
        .on('click', () => selectAlert(a.id));
    }
    L.circleMarker([a.lat, a.lng], { radius:5, color: SEV_COLOR[a.sev], fillColor: SEV_COLOR[a.sev], fillOpacity:.9, weight:2 })
      .addTo(layers.alerts)
      .bindTooltip(`<b>${SEV_NAME[a.sev]}</b> · ${a.title}`,{direction:'top'})
      .bindPopup(alertPopupHTML(a), popupOpts)
      .on('click', () => selectAlert(a.id));
  });
}

export function renderEmployees() {
  layers.emp.clearLayers();
  if (!state.UI_STATE.showEmployees) return;
  state.EMPLOYEES.forEach(e => {
    const lat = state.UI_STATE.empMode === 'zip' ? e.lat : e.officeLat;
    const lng = state.UI_STATE.empMode === 'zip' ? e.lng : e.officeLng;
    const icon = L.divIcon({ html:'<div class="emp-mk"></div>', className:'', iconSize:[10,10] });
    const m = L.marker([lat, lng], { icon });
    m.bindPopup(`<h4>${esc(e.name)}</h4><div class="addr">${esc(e.role)} · ${esc(OFFICE_BY_ID[e.office]?.name||'')}</div>`);
    layers.emp.addLayer(m);
  });
  document.getElementById('emp-count').textContent = `${state.EMPLOYEES.length.toLocaleString()} employees loaded`;
}

export function renderTravelers() {
  layers.trav.clearLayers();
  if (!state.UI_STATE.showTravelers) return;
  state.TRAVELERS.forEach(t => {
    if (t.atOffice) return; // shown as office badge
    const symbol = t.type === 'flight' ? '✈️' : '🏨';
    const icon = L.divIcon({ html:`<div class="trav-mk">${symbol}</div>`, className:'', iconSize:[20,20] });
    const m = L.marker([t.lat, t.lng], { icon });
    m.bindPopup(`<h4>${esc(t.name)}</h4><div class="addr">Home: ${esc(OFFICE_BY_ID[t.home]?.name || t.home)} · ${esc(t.destCity)}</div>
      <div class="pop-row"><span>Booking</span><b>${t.type==='flight'?'✈ air':'🏨 hotel'}</b></div>`);
    layers.trav.addLayer(m);
  });
  // When state.TRAVELERS is empty (live mode without Navan integration), show an em
  // dash rather than "0" so operators can tell "no integration yet" apart from
  // "the answer is zero". Mock-mode populates state.TRAVELERS via the demo IIFE.
  const empty = state.TRAVELERS.length === 0;
  document.getElementById('trav-count').textContent = empty
    ? 'Travelers data unavailable — awaiting Navan connection'
    : `${state.TRAVELERS.length} travelers loaded`;
  const badge = document.getElementById('trav-count-badge');
  if (badge) badge.textContent = empty ? '—' : state.TRAVELERS.length;
}

export function renderHazardZones() {
  layers.hazards.clearLayers();
  const active = [];
  Object.entries(HAZARD_ZONES).forEach(([key, def]) => {
    if (!state.UI_STATE.hazards[key]) return;
    active.push({ key, def });
    def.zones.forEach(z => {
      const halo = L.circle([z.lat, z.lng], {
        radius: z.radiusKm * 1000,
        color: def.color, weight: 2, opacity: 0.85,
        fillColor: def.color, fillOpacity: 0.18, dashArray: '6 4',
      }).addTo(layers.hazards);
      halo.bindTooltip(`<b>${esc(def.label)}</b> — ${esc(z.label)}`, { direction: 'top', sticky: true });
      halo.bindPopup(hazardPopupHTML(def, z), { maxWidth: 320 });
      // Solid center marker (also clickable)
      const dot = L.circleMarker([z.lat, z.lng], {
        radius: 5, color: def.color, fillColor: def.color, fillOpacity: 0.95, weight: 2,
      }).addTo(layers.hazards);
      dot.bindPopup(hazardPopupHTML(def, z), { maxWidth: 320 });
    });
  });
  return active;
}

export function updateHazardLegend(active) {
  // update Map Tools header badge with active-overlay count
  const overlayCount = Object.values(state.UI_STATE.hazards).filter(Boolean).length;
  const badge = document.getElementById('tools-badge');
  if (badge) {
    badge.innerHTML = overlayCount
      ? `<span style="display:inline-block;background:var(--green);color:#000;border-radius:8px;padding:0 5px;font-size:10px;font-weight:700;margin-left:4px">${overlayCount}</span>`
      : '';
  }
  const leg = document.getElementById('hazard-legend');
  if (!leg) return;
  const entries = [...active.map(({def}) => ({ label: def.label, color: def.color, count: def.zones.length, source: def.source, sourceUrl: def.sourceUrl }))];
  if (state.UI_STATE.hazards.precip) entries.push({ label: TILE_OVERLAYS.precip.label, color: '#3b82f6', count: 'live', source: TILE_OVERLAYS.precip.source, sourceUrl: TILE_OVERLAYS.precip.sourceUrl });
  if (state.UI_STATE.hazards.temp)   entries.push({ label: TILE_OVERLAYS.temp.label,   color: '#dc2626', count: 'live', source: TILE_OVERLAYS.temp.source,   sourceUrl: TILE_OVERLAYS.temp.sourceUrl });
  if (!entries.length) { leg.style.display = 'none'; leg.innerHTML = ''; return; }
  leg.style.display = '';
  leg.innerHTML = `<div class="leg-title">Map overlays active</div>` +
    entries.map(d => `<div class="leg-row">
      <span class="leg-dot" style="background:${d.color}"></span>
      <span style="flex:1">${esc(d.label)} <span style="color:var(--muted);font-size:10px">(${d.count})</span></span>
      <a href="${d.sourceUrl}" target="_blank" rel="noopener" title="${esc(d.source)} ↗" style="color:var(--blue);font-size:10px">↗</a>
    </div>`).join('');
}

export function renderHazards() {
  const active = renderHazardZones();
  applyTileOverlays();
  updateHazardLegend(active);
}

export function renderRailAlerts() {
  const list = document.getElementById('rail-office-list');
  if (!list) return;
  const data = OFFICES.map(o => {
    const a = activeAlertsForOffice(o.id);
    const counts = SEVERITY.reduce((m,s) => { m[s] = a.filter(x => x.sev===s).length; return m; }, {});
    return { o, counts, total: a.length, score: topScore(a) };
  }).filter(x => x.total > 0)
    // Hottest office first (severity-dominant priority score with recency penalty)
    .sort((a,b) => b.score - a.score || b.total - a.total);
  if (!data.length) { list.innerHTML = '<div style="font-size:9px;color:var(--muted);text-align:center;padding:6px 0">no alerts</div>'; return; }
  list.innerHTML = data.map(({o, counts}) => {
    const segs = ['ext','high','mod','low'].filter(s => counts[s] > 0)
      .map(s => `<span class="rail-sev-count s-${s}" title="${SEV_NAME[s]}">${counts[s]}</span>`).join('');
    return `<div class="rail-office" data-id="${o.id}" title="${o.name}: ${SEVERITY.map(s=>counts[s]?counts[s]+' '+SEV_NAME[s]:'').filter(Boolean).join(', ')}">
      <div class="rail-office-code">${o.id}</div>
      <div class="rail-office-counts">${segs}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.rail-office').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    App.zoomOffice(el.dataset.id);
    openPanel('alerts');
  }));
}

export function renderFeed() {
  const body = document.getElementById('feed-body');
  const alerts = visibleAlerts();
  renderRailAlerts();
  if (!alerts.length) { body.innerHTML = '<div class="empty">No alerts match the current filter.</div>'; return; }
  if (state.UI_STATE.feedTab === 'office') {
    const groups = {};
    alerts.forEach(a => {
      const key = a.officeId || '—';
      (groups[key] = groups[key] || []).push(a);
    });
    // Sort each group's alerts by priority (highest score first)
    Object.values(groups).forEach(list => list.sort((a,b) => alertPriorityScore(b) - alertPriorityScore(a)));
    // Sort groups by their hottest alert
    const sortedKeys = Object.keys(groups).sort((a,b) => topScore(groups[b]) - topScore(groups[a]));
    body.innerHTML = sortedKeys.map(oid => {
      const list = groups[oid];
      const o = OFFICE_BY_ID[oid];
      const sev = list.reduce((m,a)=>SEV_RANK[a.sev]>m?SEV_RANK[a.sev]:m,0);
      const sevName = SEVERITY[sev-1];
      const expanded = state.UI_STATE.expandedOffices.has(oid);
      const visible = expanded ? list : list.slice(0,5);
      const more = list.length - visible.length;
      return `<div class="office-group">
        <div class="office-group-head" onclick="App.zoomOffice('${esc(oid)}')">
          <span class="sev-dot" style="background:${SEV_COLOR[sevName]||'var(--muted)'}" aria-hidden="true"></span>
          <span class="name">${esc(o ? o.name : 'Travel / Region')}</span>
          <span class="pill">${list.length}</span>
        </div>
        <div class="alert-cards">
          ${visible.map(a=>alertCardHTML(a)).join('')}
          ${more>0?`<button class="more-btn" data-expand="${esc(oid)}">Show ${more} more ▾</button>`:''}
          ${expanded && list.length>5?`<button class="more-btn" data-collapse="${esc(oid)}">Show less ▴</button>`:''}
        </div>
      </div>`;
    }).join('');
  } else {
    // Recent tab: tier-then-time. Tier descending (Direct → Indirect → Watch
    // → null) so an operator scrolling the feed sees actionable items first;
    // within a tier, newest first. The 🎯 toggle in the status strip already
    // hides Watch + null tiers by default — toggling 🌐 All surfaces them at
    // the bottom of this list.
    //
    // FEED_CAP (raised from 20 → 200 on 2026-07-03): a bare `.slice(0, 20)`
    // was silently hiding data. Baseline alert volume in production is now
    // ~200-500 events during active weather (MeteoGate alone can surface
    // 130+ high/ext events during a Swiss thunderstorm peak; USGS + NWS +
    // EMSC + GDACS + EONET + london_tfl add more on top). The upstream
    // filters (officeRelevantOnly, sev-min, type, search) already gate real
    // volume; this cap is a DOM-safety belt for pathological cases (e.g.
    // 🌐 All toggled during a continent-wide event). If operators regularly
    // hit the cap during real severe weather, raise further — or add the
    // per-tier "Show N more" expand pattern used in the By-Office branch
    // above.
    const FEED_CAP = 200;
    const TIER_RANK = { direct: 3, indirect: 2, watch: 1 };
    const sorted = alerts.slice().sort((a, b) => {
      const ta = TIER_RANK[a.relevanceTier] || 0;
      const tb = TIER_RANK[b.relevanceTier] || 0;
      if (ta !== tb) return tb - ta;
      return +new Date(b.issued) - +new Date(a.issued);
    }).slice(0, FEED_CAP);
    body.innerHTML = `<div style="padding:8px 10px;display:flex;flex-direction:column;gap:5px">${sorted.map(alertCardHTML).join('')}</div>`;
  }
  body.querySelectorAll('.alert-card').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('.crisis-btn')) return;
    selectAlert(el.dataset.id);
  }));
  body.querySelectorAll('.crisis-btn').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    const a = state.ALERTS.find(x => x.id === el.dataset.id);
    if (a && a.officeId) {
      state.UI_STATE.selectedOffices = [a.officeId];
      openPanel('crisis'); setCcTab('compose'); renderCC();
      toast(`${a.officeId} pre-loaded in Crisis Comms.`);
    }
  }));
  body.querySelectorAll('.details-btn').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    showAlertDetails(el.dataset.details);
  }));
  body.querySelectorAll('[data-expand]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    state.UI_STATE.expandedOffices.add(el.dataset.expand); renderFeed();
  }));
  body.querySelectorAll('[data-collapse]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    state.UI_STATE.expandedOffices.delete(el.dataset.collapse); renderFeed();
  }));
}

export function alertCardHTML(a) {
  const sel = state.UI_STATE.selectedAlertId === a.id ? 'selected' : '';
  const officeBadges = (a.affectedOfficeIds || []).map(id =>
    `<span class="impact-badge impact-office" title="${esc(OFFICE_BY_ID[id]?.name || id)} office in impact radius">🏢 ${esc(id)}</span>`
  ).join('');
  const travCount = (a.affectedTravelers || []).length;
  const travBadge = travCount
    ? `<span class="impact-badge impact-trav" title="${travCount} traveler${travCount>1?'s':''} within radius">✈ ${travCount}</span>`
    : '';
  const empCount = a.totalEmployeesAffected || 0;
  const empBadge = empCount
    ? `<span class="impact-badge impact-emp" title="${empCount} employees in office headcounts within radius">👥 ${empCount}</span>`
    : '';
  // Three-tier relevance — see relevanceTierOf. The chip leads the impact
  // row (left of the existing 🏢/✈/👥 badges) so an operator scanning the
  // feed reads "is this me?" before "what's affected?".
  const tierChip = a.relevanceTier === 'direct'
    ? `<span class="tier-chip direct" title="Direct — an office or current traveler is within this event's impact radius">🎯 Direct</span>`
    : a.relevanceTier === 'indirect'
      ? `<span class="tier-chip indirect" title="Indirect — alert is in a country where NR has presence (office or active traveler)">📍 In-country</span>`
      : a.relevanceTier === 'watch'
        ? `<span class="tier-chip watch" title="Watch — extreme severity globally; informational, not response-trigger">👁 Watch</span>`
        : '';
  const impactRow = (tierChip || officeBadges || travBadge || empBadge)
    ? `<div class="a-impact">${tierChip}${officeBadges}${travBadge}${empBadge}</div>`
    : '';
  return `<div class="alert-card s-${a.sev} ${sel}" data-id="${a.id}">
    <div class="top-row">
      <span class="sev-pill ${a.sev}">${SEV_NAME[a.sev]}</span>
      <span class="src-pill">${a.source}</span>
      <span class="a-title">${a.title}</span>
    </div>
    <div class="a-sub">
      <span>${a.location}</span>·<span>${relTime(a.issued)}</span>·<span>${a.type}</span>
    </div>
    ${impactRow}
    <div style="display:flex;gap:4px;margin-top:6px">
      <button class="details-btn" data-details="${a.id}">Details</button>
      ${a.officeId?`<button class="crisis-btn" data-id="${a.id}">Crisis</button>`:''}
    </div>
  </div>`;
}

export function selectAlert(id) {
  state.UI_STATE.selectedAlertId = id;
  const a = state.ALERTS.find(x => x.id === id); if (!a) return;
  map.setView([a.lat, a.lng], Math.max(map.getZoom(), 5));
  renderFeed();
  toast(`${SEV_NAME[a.sev]} · ${a.title}`);
}

// Bridge-cleanup render.js pilot (2026-07-13): state.UI_STATE.ccTab bare → state.UI_STATE.
// renderCC is a sibling — module-local, unchanged.
export function setCcTab(t) { state.UI_STATE.ccTab = t;
  document.querySelectorAll('[data-cc-tab]').forEach(el => el.classList.toggle('active', el.dataset.ccTab===t));
  renderCC();
}

export function renderCC() {
  const body = document.getElementById('cc-body');
  document.getElementById('cc-log-count').textContent = state.UI_STATE.crisisLog.length;
  if (state.UI_STATE.ccTab === 'compose') body.innerHTML = renderComposeForm();
  else if (state.UI_STATE.ccTab === 'log') body.innerHTML = renderCCLog();
  else body.innerHTML = renderRoom();
  bindCCHandlers();
}

export function renderTemplatePickerOptions() {
  const tpls = allTemplates();
  const byCat = new Map();
  for (const t of tpls) {
    const list = byCat.get(t.category) || [];
    list.push(t);
    byCat.set(t.category, list);
  }
  for (const list of byCat.values()) list.sort((a,b) => a.priority - b.priority);
  const optgroups = [];
  for (const cat of TEMPLATE_CATEGORIES) {
    const list = byCat.get(cat.id) || [];
    if (list.length === 0) continue;
    optgroups.push(`<optgroup label="${esc(cat.label)}">${
      list.map(t => `<option value="${esc(t.id)}" ${state.UI_STATE.template===t.id?'selected':''}>${esc(t.name)}</option>`).join('')
    }</optgroup>`);
  }
  // Custom templates last
  const custom = byCat.get('custom') || [];
  if (custom.length > 0) {
    optgroups.push(`<optgroup label="Custom">${
      custom.map(t => `<option value="${esc(t.id)}" ${state.UI_STATE.template===t.id?'selected':''}>${esc(t.name)}</option>`).join('')
    }</optgroup>`);
  }
  return `<option value="">— select —</option>${optgroups.join('')}`;
}

export function hasDraftContent() {
  return state.UI_STATE.selectedOffices.length > 0 || state.UI_STATE.customMessage || state.UI_STATE.subject || state.UI_STATE.template;
}

export function renderComposeForm() {
  const reachOffices = state.UI_STATE.selectedOffices.length;
  const reachEmps = state.UI_STATE.selectedOffices.reduce((s,id)=>{
    const t = targetById(id); return s + (t?.headcount || 0);
  },0);
  const reachTrav = state.TRAVELERS.filter(t => state.UI_STATE.selectedOffices.includes(t.atOffice)).length;
  const activeChannels = Object.entries(state.UI_STATE.channels).filter(([k,v])=>v).map(([k])=>k);
  const message = state.UI_STATE.customMessage ||
    (state.UI_STATE.template ? (allTemplates().find(t=>t.id===state.UI_STATE.template)?.body || '') : '');

  // toggle "Clear ✕" button visibility
  const clearBtn = document.getElementById('btn-clear-draft');
  if (clearBtn) clearBtn.style.display = hasDraftContent() ? '' : 'none';

  const linked = state.UI_STATE.linkedIncidentId ? state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.linkedIncidentId) : null;
  // Defensive: test mode is unavailable inside an existing incident's compose
  // flow (operator clarification 2026-06-18, Q3). Force-clear here so the flag
  // can never leak through unnoticed if the operator linked an incident after
  // toggling test on. The toggle UI is also hidden when `linked`, but this is
  // belt-and-suspenders: dispatchSend reads state.UI_STATE.isTest, not the DOM.
  if (linked && state.UI_STATE.isTest) state.UI_STATE.isTest = false;
  const linkedBanner = linked ? `
    <div class="linked-banner">
      <span class="linked-icon" aria-hidden="true">🔗</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Linked to incident</div>
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(linked.title)}</div>
      </div>
      <a href="#" id="cc-unlink" class="field-action muted" title="Unlink — next message will create a new incident">Unlink</a>
    </div>` : '';

  return `<div class="compose-form">
    ${linkedBanner}
    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <label style="margin-bottom:0">Offices</label>
        <div style="font-size:10px">
          <a href="#" id="cc-add-all" style="color:var(--green);margin-right:8px">Add all</a>
          <a href="#" id="cc-clear-offices" style="color:var(--muted)">Clear</a>
        </div>
      </div>
      <select id="cc-office-pick" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:7px 8px;font-size:12px;margin-bottom:6px">
        <option value="">Select an office...</option>
        ${OFFICES.filter(o=>!state.UI_STATE.selectedOffices.includes(o.id)).map(o=>`<option value="${o.id}">${o.id} · ${o.name}${o.headcount!=null?` · ${o.headcount.toLocaleString()}`:''}</option>`).join('')}
        ${state.UI_STATE.customLocations.filter(c=>!state.UI_STATE.selectedOffices.includes(c.id)).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.name)} (custom)</option>`).join('')}
      </select>
      <div style="display:flex;gap:4px;margin-bottom:6px">
        <input type="text" id="cc-new-loc" placeholder="Add new location..." style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px"/>
        <button class="btn-ghost" id="cc-add-loc">Add</button>
      </div>
      <div class="chip-list" id="chip-list" style="border:0;background:transparent;padding:0">
        ${state.UI_STATE.selectedOffices.map(id=>{
          const t = targetById(id);
          return `<span class="chip" data-id="${esc(id)}">${esc(t?t.name:id)}<x onclick="App.removeOffice('${esc(id)}')">×</x></span>`;
        }).join('')}
      </div>
    </div>

    <div class="field">
      <label>Channels</label>
      <div class="channel-row">
        <div class="channel-pill ${state.UI_STATE.channels.slack?'on':''}" data-ch="slack">💬 slack</div>
        <div class="channel-pill ${state.UI_STATE.channels.email?'on':''}" data-ch="email">✉️ email</div>
        <div class="channel-pill disabled" data-ch="sms">📱 sms</div>
      </div>
    </div>

    ${activeChannels.length && reachOffices ? `<div class="field">
      <label>Recipients</label>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:6px 10px;font-size:11px;display:flex;flex-direction:column;gap:4px">
        ${activeChannels.map(ch => {
          const recs = recipientsForChannel(ch, state.UI_STATE.selectedOffices);
          const icon = ch==='slack'?'💬':ch==='email'?'✉️':'📱';
          return `<div style="display:flex;gap:6px;align-items:flex-start"><span>${icon}</span><span style="color:var(--text)">${recs.join(', ')}</span></div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="field">
      <label>Template</label>
      <div style="display:flex;gap:4px">
        <select id="cc-tpl-pick" style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:7px 8px;font-size:12px">
          ${renderTemplatePickerOptions()}
        </select>
        <button class="btn-ghost" id="cc-tpl-add" title="Add custom template">+</button>
      </div>
    </div>

    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <label style="margin-bottom:0">Message</label>
        <a href="#" id="cc-clear-msg" style="font-size:10px;color:var(--muted)">Clear</a>
      </div>
      <textarea id="msg-body" placeholder="Compose the safety message... URLs you paste will be clickable when received.">${esc(message)}</textarea>
    </div>

    ${(() => {
      // Advanced disclosure — keeps secondary fields out of the way for the 80% case
      const adv = [];
      if (state.UI_STATE.subject) adv.push('Subject set');
      if (state.UI_STATE.attachments.length) adv.push(`${state.UI_STATE.attachments.length} attachment${state.UI_STATE.attachments.length===1?'':'s'}`);
      if (!state.UI_STATE.responseRequired) adv.push('Response off');
      if (state.UI_STATE.reminderInterval !== '15m') adv.push('Reminder ' + state.UI_STATE.reminderInterval);
      const hint = adv.length ? `<span class="cc-advanced-hint"> · ${adv.join(' · ')}</span>` : '';
      const open = state.UI_STATE.composeAdvanced;
      return `<button class="cc-advanced-toggle" type="button" id="cc-advanced-toggle" aria-expanded="${open}">
        <span class="cc-advanced-caret">${open ? '▾' : '▸'}</span>
        Advanced${hint}
      </button>
      ${open ? `<div class="cc-advanced-body">
        <div class="field">
          <label>Subject</label>
          <input type="text" id="cc-subject" value="${esc(state.UI_STATE.subject)}" placeholder="[Severity] Safety Alert — ..."/>
        </div>
        <div class="field">
          <label>Attachments & Links</label>
          <div class="att-zone" id="att-zone-cc">
            Drop files here, paste, or
            <button type="button" class="att-pick-btn" id="att-pick-cc">Choose files</button>
            <input type="file" id="att-input-cc" multiple style="display:none"/>
            <div style="font-size:10px;margin-top:4px">URLs in your message auto-link. Files ≤ ${fmtSize(ATT_EMBED_LIMIT)} are embedded.</div>
          </div>
          ${state.UI_STATE.attachments.length ? `<div class="att-list">${state.UI_STATE.attachments.map(a => attachmentChipHTML(a, true)).join('')}</div>` : ''}
        </div>
        <div class="field" style="margin-bottom:6px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:12px;color:var(--text);font-weight:400">
            <input type="checkbox" id="resp-required" ${state.UI_STATE.responseRequired?'checked':''} style="width:auto"/>
            Response required (track per-employee status in incident)
          </label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <label style="margin-bottom:0;text-transform:none;letter-spacing:0;font-size:11px;color:var(--muted);font-weight:400">Remind after</label>
          <select id="reminder" style="flex:1">
            <option value="15m" ${state.UI_STATE.reminderInterval==='15m'?'selected':''}>15 minutes</option>
            <option value="30m" ${state.UI_STATE.reminderInterval==='30m'?'selected':''}>30 minutes</option>
            <option value="1h"  ${state.UI_STATE.reminderInterval==='1h' ?'selected':''}>1 hour</option>
            <option value="4h"  ${state.UI_STATE.reminderInterval==='4h' ?'selected':''}>4 hours</option>
            <option value="1d"  ${state.UI_STATE.reminderInterval==='1d' ?'selected':''}>1 day</option>
          </select>
        </div>
      </div>` : ''}`;
    })()}

    ${linked ? '' : `
    <div class="test-mode-row ${state.UI_STATE.isTest ? 'on' : ''}" title="Send a test (drill) message instead of a real one. The message lands in a real incident with an is_test flag so the audit trail stays clear.">
      <label>
        <input type="checkbox" id="cc-test-mode" ${state.UI_STATE.isTest?'checked':''} style="width:auto;margin:0;flex-shrink:0;"/>
        <span class="tm-title">🧪 Send as Test</span>
        <span class="tm-hint">Drill mode — message logs with TEST badge, routes to ${esc(TEST_ROUTING.slack)} only, [TEST] prefix prepended.</span>
      </label>
    </div>`}

    <button class="btn-primary cc-send" id="btn-send" ${reachOffices&&activeChannels.length?'':'disabled'}
      style="${state.UI_STATE.isTest && !linked ? 'background:#22d3ee;color:#053041;border-color:#0891b2;' : ''}">
      ${state.UI_STATE.isTest && !linked
        ? `🧪 Send as Test to ${esc(TEST_ROUTING.slack)} ▶`
        : linked
          ? `Send & log to incident ▶`
          : `Send to ${reachOffices} office${reachOffices===1?'':'s'} ▶`}
    </button>
  </div>`;
}

export function renderCCLog() {
  if (!state.UI_STATE.crisisLog.length) return '<div class="empty">No messages sent yet.</div>';
  return state.UI_STATE.crisisLog.slice().reverse().map(e => {
    // Outbox chip: if this message has a queued failure, surface it inline
    // so the operator sees "message locally logged" AND "backend never got
    // it" side by side. Retry button goes through outbox.retryEntry via
    // the click handler wired in bindCCHandlers.
    const outboxEntry = outboxEntryForMsg(e.id);
    const outboxChip = outboxEntry ? outboxChipHTML(outboxEntry.id) : '';
    return `
    <div class="crisis-log-entry${e.isTest?' is-test':''}${outboxEntry?' is-failed':''}">
      <div>
        <span class="when">${new Date(e.when).toLocaleString()}</span> · <span class="who">${esc(e.by)}</span>
        ${e.isTest?' <span class="test-badge" title="Drill — sent in test mode, routed to test channel only">🧪 Test</span>':''}
        ${outboxChip}
      </div>
      ${e.subject?`<div style="font-weight:600;font-size:12px;margin-top:2px">${esc(e.subject)}</div>`:''}
      <div class="body" style="white-space:pre-wrap">${linkify(esc(e.body))}</div>
      ${e.attachments?.length?`<div class="att-list">${e.attachments.map(a => attachmentChipHTML(a, false)).join('')}</div>`:''}
      <div class="meta">
        ${e.offices.map(o=>`<span class="src-pill">${esc(o)}</span>`).join('')}
        ${e.channels.map(c=>`<span class="src-pill">${esc(c)}</span>`).join('')}
        <span class="src-pill">${(e.recipients ?? e.recipientsCount ?? 0)} recipients</span>
        ${e.responseRequired?'<span class="src-pill" style="color:var(--green);border-color:var(--green)">tracked</span>':''}
        ${e.attachments?.length?`<span class="src-pill">📎 ${e.attachments.length}</span>`:''}
      </div>
    </div>`;
  }).join('');
}

export function renderRoom() {
  return `<div class="room-thread" id="room-thread">
    ${state.UI_STATE.roomMessages.map(m=>`<div class="room-msg"><span class="from">${esc(m.from)}</span><span class="when">${relTime(m.when)} ago</span><div style="white-space:pre-wrap">${linkify(esc(m.body))}</div></div>`).join('')}
  </div>
  <div class="room-input">
    <input id="room-input" placeholder="Post to CMT situation room..." />
    <button class="btn-ghost" id="room-send">Post</button>
  </div>`;
}

export function wireAttZone({ zoneId, inputId, pickId, getList, setList, onChange }) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const pick = document.getElementById(pickId);
  if (!zone || !input || !pick) return;
  pick.onclick = (e) => { e.preventDefault(); input.click(); };
  zone.onclick = (e) => { if (e.target === zone) input.click(); };
  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    const atts = await Promise.all(files.map(fileToAttachment));
    setList([...getList(), ...atts]);
    e.target.value = ''; onChange();
    atts.forEach(a => { if (a.oversized) toast(`"${a.name}" is over ${fmtSize(ATT_EMBED_LIMIT)} — kept as a reference but not embedded.`); });
  };
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('dragging');
  }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragging');
  }));
  zone.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const atts = await Promise.all(files.map(fileToAttachment));
    setList([...getList(), ...atts]);
    onChange();
    atts.forEach(a => { if (a.oversized) toast(`"${a.name}" is over ${fmtSize(ATT_EMBED_LIMIT)} — kept as a reference but not embedded.`); });
  });
  // Bind remove handlers on existing chips
  document.querySelectorAll(`#${zoneId} ~ .att-list [data-att-remove], #${zoneId.replace('-zone-','-list-')} [data-att-remove]`).forEach(b => {
    b.onclick = () => {
      const id = b.dataset.attRemove;
      setList(getList().filter(a => a.id !== id));
      onChange();
    };
  });
}

export function bindCCHandlers() {
  // Outbox retry chip clicks in the Log tab. Uses event delegation on the
  // whole CC panel so the binding survives Log-tab re-renders. Fire-and-
  // forget — retryEntry handles state mutations + re-render on completion.
  document.querySelectorAll('[data-outbox-retry]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const entryId = btn.dataset.outboxRetry;
      btn.disabled = true;
      btn.textContent = 'Retrying…';
      retryEntry(entryId);
    };
  });

  // Compose attachments zone
  wireAttZone({
    zoneId: 'att-zone-cc',
    inputId: 'att-input-cc',
    pickId: 'att-pick-cc',
    getList: () => state.UI_STATE.attachments,
    setList: (list) => { state.UI_STATE.attachments = list; },
    onChange: () => renderCC(),
  });
  // Bind remove buttons (att-list is sibling-ish; cover all in compose form)
  document.querySelectorAll('.compose-form [data-att-remove]').forEach(b => b.onclick = () => {
    state.UI_STATE.attachments = state.UI_STATE.attachments.filter(a => a.id !== b.dataset.attRemove);
    renderCC();
  });

  // Template dropdown
  document.getElementById('cc-tpl-pick')?.addEventListener('change', e => {
    state.UI_STATE.template = e.target.value;
    const t = allTemplates().find(x => x.id === state.UI_STATE.template);
    if (t) {
      state.UI_STATE.customMessage = t.body;
      // auto-fill subject if empty
      if (!state.UI_STATE.subject) state.UI_STATE.subject = `[Safety] ${t.name}${state.UI_STATE.selectedOffices.length===1?` — ${targetById(state.UI_STATE.selectedOffices[0])?.name||''} Office`:''}`;
    }
    renderCC();
  });
  document.getElementById('cc-tpl-add')?.addEventListener('click', () => {
    showModal(`<h3>New custom template</h3>
      <div class="field"><label>Name</label><input id="utpl-name" placeholder="e.g. Severe Weather Hold"/></div>
      <div class="field"><label>Body</label><textarea id="utpl-body" placeholder="Message body..."></textarea></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="App.closeModal()">Cancel</button>
        <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="utpl-save">Save Template</button>
      </div>`);
    document.getElementById('utpl-save').onclick = () => {
      const name = document.getElementById('utpl-name').value.trim();
      const body = document.getElementById('utpl-body').value.trim();
      if (!name || !body) { toast('Name and body required.'); return; }
      const id = 'u_'+Math.random().toString(36).slice(2,7);
      state.UI_STATE.userTemplates.push({ id, name, body });
      state.UI_STATE.template = id;
      state.UI_STATE.customMessage = body;
      closeModal();
      renderCC();
      toast('Template saved.');
    };
  });

  // Channels
  document.querySelectorAll('[data-ch]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.ch;
    if (k === 'sms') return;
    state.UI_STATE.channels[k] = !state.UI_STATE.channels[k];
    renderCC();
  }));

  // Office single-select dropdown
  document.getElementById('cc-office-pick')?.addEventListener('change', e => {
    const id = e.target.value;
    if (!id) return;
    if (!state.UI_STATE.selectedOffices.includes(id)) state.UI_STATE.selectedOffices.push(id);
    renderCC();
  });
  // Add custom location
  document.getElementById('cc-add-loc')?.addEventListener('click', () => {
    const inp = document.getElementById('cc-new-loc');
    const name = inp.value.trim();
    if (!name) return;
    const id = 'CL_'+Math.random().toString(36).slice(2,5).toUpperCase();
    state.UI_STATE.customLocations.push({ id, name });
    state.UI_STATE.selectedOffices.push(id);
    inp.value = '';
    renderCC();
    toast(`Custom location "${name}" added.`);
  });
  document.getElementById('cc-new-loc')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('cc-add-loc').click(); }
  });
  document.getElementById('cc-add-all')?.addEventListener('click', e => {
    e.preventDefault();
    state.UI_STATE.selectedOffices = OFFICES.map(o => o.id);
    renderCC();
  });
  document.getElementById('cc-clear-offices')?.addEventListener('click', e => {
    e.preventDefault();
    state.UI_STATE.selectedOffices = [];
    renderCC();
  });

  // Subject + message + response + reminder
  document.getElementById('cc-subject')?.addEventListener('input', e => { state.UI_STATE.subject = e.target.value; saveState(); });
  document.getElementById('msg-body')?.addEventListener('input', e => { state.UI_STATE.customMessage = e.target.value; saveState(); });
  document.getElementById('cc-clear-msg')?.addEventListener('click', e => {
    e.preventDefault();
    state.UI_STATE.customMessage = ''; state.UI_STATE.template = ''; state.UI_STATE.subject = '';
    renderCC();
  });
  document.getElementById('cc-advanced-toggle')?.addEventListener('click', () => {
    state.UI_STATE.composeAdvanced = !state.UI_STATE.composeAdvanced;
    renderCC();
  });
  document.getElementById('cc-unlink')?.addEventListener('click', e => {
    e.preventDefault();
    state.UI_STATE.linkedIncidentId = null;
    toast('Unlinked. Next message will create a new incident.');
    renderCC();
  });
  document.getElementById('resp-required')?.addEventListener('change', e => state.UI_STATE.responseRequired = e.target.checked);
  // Test-mode toggle: re-render the form so the Send button + recipient hint
  // pick up the new state. (Cheap — Compose re-render is sub-ms.)
  document.getElementById('cc-test-mode')?.addEventListener('change', e => {
    state.UI_STATE.isTest = !!e.target.checked;
    saveState();
    renderCC();
  });
  document.getElementById('reminder')?.addEventListener('change', e => state.UI_STATE.reminderInterval = e.target.value);

  // Send
  document.getElementById('btn-send')?.addEventListener('click', confirmSend);

  // Room
  document.getElementById('room-send')?.addEventListener('click', () => {
    const inp = document.getElementById('room-input');
    if (!inp.value.trim()) return;
    state.UI_STATE.roomMessages.push({ from:'cowork-3p', when:new Date().toISOString(), body:inp.value });
    inp.value=''; renderCC();
  });

  // Panel-level Clear ✕ (binds once but harmless to rebind)
  const clearBtn = document.getElementById('btn-clear-draft');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.onclick = () => {
      showModal(`<h3>Clear draft?</h3>
        <p style="font-size:12px;color:var(--muted);line-height:1.5">
          This will reset selected offices, subject, message, template, and channels back to defaults.
          The Crisis Log and any sent messages are not affected.
        </p>
        <div class="modal-actions">
          <button class="btn-ghost" id="modal-cancel">Cancel</button>
          <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px;background:var(--red);color:#fff" id="modal-confirm">Clear draft</button>
        </div>`);
      document.getElementById('modal-cancel').onclick = closeModal;
      document.getElementById('modal-confirm').onclick = () => {
        state.UI_STATE.selectedOffices = [];
        state.UI_STATE.template = ''; state.UI_STATE.customMessage = ''; state.UI_STATE.subject = '';
        state.UI_STATE.attachments = [];
        state.UI_STATE.channels = { slack:true, email:false, sms:false };
        closeModal();
        renderCC();
        toast('Draft cleared.');
      };
    };
  }
}

// Bridge-cleanup render.js pilot: state.UI_STATE.incidentTab bare → state.UI_STATE.
export function setIncidentTab(t) { state.UI_STATE.incidentTab = t; renderIncidentDetail(); }

export function renderIncidents() {
  const body = document.getElementById('incident-body');
  const open = state.UI_STATE.incidents.filter(i => i.status === 'open');
  // Quiet-state: when no incidents are open, drop the badge's pulse + red
  // tint so the rail doesn't shout for attention during a calm shift.
  // .quiet is an additive class — .live stays so the layout (sizing,
  // border-radius) is consistent across states.
  const incBadge = document.getElementById('incident-active-badge');
  incBadge.textContent = open.length;
  incBadge.classList.toggle('quiet', open.length === 0);
  if (!state.UI_STATE.incidents.length) { body.innerHTML = '<div class="empty">No incidents. Click <b>+ New</b> to create one, or send a Crisis message with Response Required.</div>'; return; }
  if (!state.UI_STATE.selectedIncidentId || !state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId)) {
    body.innerHTML = renderIncidentFilter() + renderIncidentList(); bindIncidentListHandlers(); return;
  }
  body.innerHTML = renderIncidentFilter() + renderIncidentList() + renderIncidentDetailHTML();
  bindIncidentListHandlers(); bindIncidentDetailHandlers();
}

export function renderIncidentFilter() {
  const open   = state.UI_STATE.incidents.filter(i => i.status === 'open').length;
  const closed = state.UI_STATE.incidents.filter(i => i.status === 'closed').length;
  const total  = state.UI_STATE.incidents.length;
  const f = state.UI_STATE.incidentListFilter;
  return `<div class="msg-filter" role="tablist" aria-label="Filter incidents">
    <button class="${f==='open'?'active':''}" data-i-filter="open"  role="tab" aria-selected="${f==='open'}">Open ${open}</button>
    <button class="${f==='closed'?'active':''}" data-i-filter="closed" role="tab" aria-selected="${f==='closed'}">Closed ${closed}</button>
    <button class="${f==='all'?'active':''}" data-i-filter="all" role="tab" aria-selected="${f==='all'}">All ${total}</button>
  </div>`;
}

export function renderIncidentList() {
  const list = visibleIncidents();
  if (!list.length) return '<div class="empty">No incidents in this filter.</div>';
  return `<div class="incident-list">${list.map(i => {
    const msgs = (i.messages||[]).length;
    // Surface drill messages on the card so an operator scanning the list
    // never mistakes a drill incident for a real one without opening it.
    // Computed from the message rows so it stays accurate as messages are
    // added or removed; no separate flag on the incident itself.
    const testCount = (i.messages||[]).filter(m => m.isTest).length;
    const allTest = testCount > 0 && testCount === msgs;
    const testBadge = testCount === 0 ? ''
      : allTest
        ? `<span class="test-badge" title="Every message in this incident was sent in test mode">🧪 Drill</span>`
        : `<span class="test-badge" title="${testCount} of ${msgs} messages were sent in test mode">🧪 incl. test</span>`;
    return `
    <div class="incident-row ${state.UI_STATE.selectedIncidentId===i.id?'selected':''} ${i.status==='closed'?'closed':''}" data-id="${esc(i.id)}">
      <div class="i-title">${esc(i.title)}</div>
      <div class="i-meta">
        <span class="sev-pill ${i.severity}">${SEV_NAME[i.severity]}</span>
        <span>${relTime(i.opened)} ago</span>
        <span>${esc(i.offices.join(', '))}</span>
        ${msgs?`<span title="messages sent">📨 ${msgs}</span>`:''}
        ${testBadge}
        <span style="margin-left:auto;color:${i.status==='open'?'var(--red)':'var(--muted)'}">${i.status}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

export function renderIncidentDetail() {
  document.getElementById('incident-body').innerHTML = renderIncidentList() + renderIncidentDetailHTML();
  bindIncidentListHandlers(); bindIncidentDetailHandlers();
}

export function renderIncidentDetailHTML() {
  const inc = state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId); if (!inc) return '';
  const resp = state.UI_STATE.responses[inc.id] || {};
  const rs = Object.values(resp);
  const ok = rs.filter(r=>r.status==='ok').length;
  const help = rs.filter(r=>r.status==='help').length;
  const no = rs.filter(r=>r.status==='no').length;
  const total = rs.length;
  const pct = total ? Math.round(((ok+help)/total)*100) : 0;
  return `<div class="incident-detail" style="border-top:2px solid var(--border)">
    <div class="incident-meta">
      <h3>${esc(inc.title)}</h3>
      <div class="meta-row">
        <span class="sev-pill ${inc.severity}">${SEV_NAME[inc.severity]}</span>
        <span>${esc(inc.offices.join(', '))}</span>
        <span>${new Date(inc.opened).toLocaleString()}</span>
        <span>${inc.status}</span>
      </div>
    </div>
    <div class="tabs">
      ${[
        ['details','Details'],
        ['comms','Comms', (inc.messages||[]).length],
        ['responses','Responses', total],
        ['notes','Notes', inc.notes.length],
        ['log','Log'],
      ].map(([t,label,count])=>`<div class="tab ${state.UI_STATE.incidentTab===t?'active':''}" data-i-tab="${t}">${label}${count!==undefined?` <span class="count">${count}</span>`:''}</div>`).join('')}
    </div>
    <div style="flex:1; overflow-y:auto">${renderIncidentTab(inc, ok, help, no, total, pct)}</div>
  </div>`;
}

export function renderIncidentTab(inc, ok, help, no, total, pct) {
  const isOpen = inc.status === 'open';
  if (state.UI_STATE.incidentTab === 'details') {
    return `<div style="padding:12px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${esc(inc.description)}</div>
      ${inc.closedNote?`<div style="font-size:11px;background:var(--bg3);border-left:3px solid var(--red);padding:6px 10px;margin-bottom:10px;border-radius:0 4px 4px 0"><b>Closure note:</b> ${esc(inc.closedNote)}<div style="color:var(--muted);font-size:10px;margin-top:2px">${inc.closedAt?new Date(inc.closedAt).toLocaleString():''}</div></div>`:''}
      ${inc.reopens?.length?`<div style="font-size:10px;color:var(--muted);margin-bottom:8px">Reopened ${inc.reopens.length}× · last ${relTime(inc.reopens[inc.reopens.length-1].when)} ago</div>`:''}
      <div class="tally">
        <div class="tally-cell ok"><div class="n">${ok}</div><div class="l">OK</div></div>
        <div class="tally-cell help"><div class="n">${help}</div><div class="l">Needs Help</div></div>
        <div class="tally-cell no"><div class="n">${no}</div><div class="l">No Response</div></div>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${pct}% responded · ${total} total recipients</div>
      <div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">
        ${isOpen?'<button class="btn-ghost" id="btn-send-msg">📣 Send Message</button>':''}
        ${isOpen?'<button class="btn-ghost" id="btn-simulate">Simulate Replies</button>':''}
        <button class="btn-ghost" id="btn-export-inc">📄 Export Report</button>
        ${isOpen
          ? '<button class="btn-ghost danger" id="btn-close-inc">End Incident</button>'
          : '<button class="btn-ghost" id="btn-reopen-inc" style="color:var(--green);border-color:var(--green)">↻ Reopen</button>'}
      </div>
    </div>`;
  }
  if (state.UI_STATE.incidentTab === 'comms') {
    const msgs = (inc.messages||[]).slice().sort((a,b) => new Date(a.when) - new Date(b.when));
    return `<div style="padding:8px 0">
      ${isOpen?`<div style="padding:8px 12px;border-bottom:1px solid var(--border)">
        <button class="btn-primary cc-send" id="btn-send-msg" style="margin:0;padding:9px;font-size:13px">📣 Send Another Message</button>
      </div>`:''}
      ${!msgs.length?'<div class="empty">No messages sent for this incident yet.</div>':''}
      ${msgs.map((m,i)=>{
        const tplName = m.templateName || allTemplates().find(t=>t.id===m.template)?.name || 'Custom';
        const sevColor = (m.template==='evac'||m.template==='shelter')?SEV_COLOR.high:m.template==='allclear'?SEV_COLOR.low:SEV_COLOR.mod;
        return `<div class="comm-card${m.isTest?' is-test':''}" style="border-left-color:${m.isTest?'#22d3ee':sevColor}">
          <div class="row-between">
            <div class="comm-step">${i+1}. ${esc(tplName)}${m.isTest?' <span class="test-badge" title="Drill — sent in test mode, routed to test channel only">🧪 Test</span>':''}</div>
            <div class="muted-xs">${new Date(m.when).toLocaleString()}</div>
          </div>
          ${m.subject?`<div style="font-size:12px;font-weight:600;margin-top:4px">${esc(m.subject)}</div>`:''}
          <div style="font-size:11px;line-height:1.4;color:var(--text);margin-top:4px;white-space:pre-wrap">${linkify(esc(m.body))}</div>
          ${m.attachments?.length?`<div class="att-list">${m.attachments.map(a => attachmentChipHTML(a, false)).join('')}</div>`:''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${m.channels.map(c=>`<span class="src-pill">${c.toUpperCase()}</span>`).join('')}
            <span class="src-pill">${(m.recipients ?? m.recipientsCount ?? 0).toLocaleString()} recipients</span>
            <span class="src-pill">${esc(m.offices.join(', '))}</span>
            ${m.responseRequired?'<span class="src-pill" style="color:var(--green);border-color:var(--green)">tracked</span>':''}
            ${m.attachments?.length?`<span class="src-pill">📎 ${m.attachments.length}</span>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }
  if (state.UI_STATE.incidentTab === 'responses') {
    const resp = state.UI_STATE.responses[inc.id] || {};
    const empRows = []; const travRows = []; const remoteRows = [];
    Object.entries(resp).forEach(([eid, r]) => {
      if (r.traveler) {
        const t = state.TRAVELERS.find(x => 'T-'+x.id === eid);
        if (t) travRows.push({ eid, name: t.name, who: `${OFFICE_BY_ID[t.home]?.name||t.home} · ${t.destCity}`, status: r.status });
      } else if (r.remote) {
        const re = state.REMOTE_EMPLOYEES.find(x => 'R-'+x.id === eid);
        if (re) remoteRows.push({ eid, name: re.name, who: `${re.city} · ${re.country} (remote)`, status: r.status });
      } else {
        const e = state.EMPLOYEES.find(x => x.id === eid);
        if (e) empRows.push({ eid, name: e.name, who: e.role, status: r.status });
      }
    });
    const filt = state.UI_STATE.msgFilter;
    const f = (rows) => filt==='all' ? rows : rows.filter(r => (filt==='no'?r.status==='no': r.status===filt));
    const allRows = [...empRows, ...travRows, ...remoteRows];
    return `<div class="msg-filter">
      ${['all','no','ok','help'].map(k=>{
        const n = k==='all' ? allRows.length : allRows.filter(r => k==='no'?r.status==='no':r.status===k).length;
        return `<button class="${filt===k?'active':''}" data-mfilter="${k}">${k==='no'?'No response':k.toUpperCase()} ${n}</button>`;
      }).join('')}
    </div>
    <div class="section-h">Employees (${empRows.length})</div>
    ${f(empRows).map(r => msgRowHTML(r,inc)).join('') || '<div class="empty">None</div>'}
    ${travRows.length ? `<div class="section-h">✈ Travelers (${travRows.length})</div>${f(travRows).map(r=>msgRowHTML(r,inc)).join('')}` : ''}
    ${remoteRows.length ? `<div class="section-h">🏠 Remote Employees (${remoteRows.length})</div>${f(remoteRows).map(r=>msgRowHTML(r,inc)).join('')}` : ''}`;
  }
  if (state.UI_STATE.incidentTab === 'notes') {
    return `<div style="padding:8px 12px;border-bottom:1px solid var(--border)">
      <textarea id="note-input" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px;min-height:48px;resize:vertical" placeholder="Add a note... (paste URLs to make them clickable)"></textarea>
      <div class="att-zone" id="att-zone-note" style="margin-top:6px">
        Drop files here or
        <button type="button" class="att-pick-btn" id="att-pick-note">Choose files</button>
        <input type="file" id="att-input-note" multiple style="display:none"/>
      </div>
      ${state.UI_STATE.noteAttachments.length ? `<div class="att-list">${state.UI_STATE.noteAttachments.map(a => attachmentChipHTML(a, true)).join('')}</div>` : ''}
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn-ghost" id="note-add">Add Note</button>
      </div>
    </div>
    ${inc.notes.length ? inc.notes.slice().reverse().map(n=>`<div class="note-entry">
      <div class="meta">${new Date(n.when).toLocaleString()} · ${esc(n.by)}</div>
      <div style="white-space:pre-wrap">${linkify(esc(n.body))}</div>
      ${n.attachments?.length?`<div class="att-list">${n.attachments.map(a => attachmentChipHTML(a, false)).join('')}</div>`:''}
    </div>`).join('') : '<div class="empty">No notes yet.</div>'}`;
  }
  if (state.UI_STATE.incidentTab === 'log') {
    return `${inc.log.length ? inc.log.slice().reverse().map(l=>`<div class="log-entry-i kind-${l.kind}"><span class="when">${new Date(l.when).toLocaleString()} · ${l.by}</span><div>${l.body}</div></div>`).join('') : '<div class="empty">No activity logged.</div>'}`;
  }
}

export function msgRowHTML(r, inc) {
  return `<div class="msg-row">
    <div><div class="name">${esc(r.name)}</div><div class="who">${esc(r.who)}</div></div>
    <button class="act ok" data-eid="${esc(r.eid)}" data-st="ok">✓ OK</button>
    <button class="act help" data-eid="${esc(r.eid)}" data-st="help">⚠ Help</button>
    <span class="status-pill ${r.status==='no'?'no':r.status}" style="grid-column:1/-1">${r.status==='no'?'no response':r.status==='ok'?'ok':'needs help'}</span>
  </div>`;
}

export function bindIncidentListHandlers() {
  document.querySelectorAll('.incident-row').forEach(el => el.addEventListener('click', () => selectIncident(el.dataset.id)));
  document.querySelectorAll('[data-i-filter]').forEach(el => el.addEventListener('click', () => {
    state.UI_STATE.incidentListFilter = el.dataset.iFilter; renderIncidents();
  }));
}

export function bindIncidentDetailHandlers() {
  document.querySelectorAll('[data-i-tab]').forEach(el => el.addEventListener('click', () => setIncidentTab(el.dataset.iTab)));
  document.querySelectorAll('[data-mfilter]').forEach(el => el.addEventListener('click', () => { state.UI_STATE.msgFilter = el.dataset.mfilter; renderIncidentDetail(); }));
  document.querySelectorAll('[data-eid]').forEach(b => b.addEventListener('click', () => {
    const inc = state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId); if (!inc) return;
    const eid = b.dataset.eid; const st = b.dataset.st;
    state.UI_STATE.responses[inc.id][eid] = { ...state.UI_STATE.responses[inc.id][eid], status: st, when: new Date().toISOString(), by: 'Admin' };
    addIncidentLog(inc.id, 'msg', `Status logged for <b>${esc(eid)}</b>: ${esc(st)}`);
    renderIncidentDetail();
    // Live mode: persist response to backend. Strip the "T-" traveler prefix
    // from the storage key when sending — backend stores plain employee_id
    // with a separate is_traveler bool.
    if (API_BASE && !inc._persistPending) {
      const isTraveler = eid.startsWith('T-');
      const subjectId  = isTraveler ? eid.slice(2) : eid;
      // Pull employee/traveler context for nicer audit trail server-side
      const emp        = isTraveler ? null : state.EMPLOYEES.find(e => e.id === subjectId);
      const trav       = isTraveler ? state.TRAVELERS.find(t => t.id === subjectId) : null;
      const subject    = emp || trav;
      incidentsApi.updateResponse(inc.id, subjectId, {
        status:       st,
        employeeName: subject?.name,
        officeId:     emp?.office ?? trav?.atOffice ?? null,
        isTraveler,
      }).catch(err => {
        console.warn('response update persist failed:', err);
        // Don't revert — stale-on-server is less disruptive than blinking UI.
      });
    }
  }));
  // Note attachments zone
  wireAttZone({
    zoneId: 'att-zone-note',
    inputId: 'att-input-note',
    pickId: 'att-pick-note',
    getList: () => state.UI_STATE.noteAttachments,
    setList: (list) => { state.UI_STATE.noteAttachments = list; },
    onChange: () => renderIncidentDetail(),
  });
  document.querySelectorAll('.note-entry [data-att-remove]').forEach(b => {
    // shouldn't be removable in saved notes; no-op
  });
  document.querySelectorAll('#att-zone-note ~ .att-list [data-att-remove]').forEach(b => b.onclick = () => {
    state.UI_STATE.noteAttachments = state.UI_STATE.noteAttachments.filter(a => a.id !== b.dataset.attRemove);
    renderIncidentDetail();
  });
  document.getElementById('note-add')?.addEventListener('click', () => {
    const inc = state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId); if (!inc) return;
    const inp = document.getElementById('note-input');
    if (!inp.value.trim() && !state.UI_STATE.noteAttachments.length) return;
    const noteBody = inp.value;
    const noteAtts = state.UI_STATE.noteAttachments.slice();
    const noteObj = {
      id: null,           // server-assigned on success; stays null if persist fails
      when: new Date().toISOString(), by:'cowork-3p',
      body: noteBody,
      attachments: noteAtts,
    };
    inc.notes.push(noteObj);
    const attCount = noteAtts.length;
    addIncidentLog(inc.id, 'note', `Note added: ${esc(noteBody.slice(0,80))}${noteBody.length>80?'…':''}${attCount?` <span class="src-pill">📎 ${attCount}</span>`:''}`);
    inp.value = '';
    state.UI_STATE.noteAttachments = [];
    renderIncidentDetail();
    // Live mode: persist note. Don't revert local on failure — note is too
    // valuable to vanish if the network blips. Toast the warning instead.
    if (API_BASE && !inc._persistPending) {
      incidentsApi.addNote(inc.id, { body: noteBody, attachments: noteAtts })
        .then(noteId => { if (noteId) noteObj.id = noteId; })
        .catch(err => {
          console.warn('note add persist failed:', err);
          toast('⚠ Note saved locally — backend persist failed.');
        });
    }
  });
  document.getElementById('btn-simulate')?.addEventListener('click', () => {
    const inc = state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId); if (!inc) return;
    let n=0;
    Object.entries(state.UI_STATE.responses[inc.id]).forEach(([k,r]) => {
      if (r.status==='no' && Math.random() < 0.55) {
        state.UI_STATE.responses[inc.id][k] = { ...r, status: Math.random()<.92?'ok':'help', when:new Date().toISOString(), by:'auto' };
        n++;
      }
    });
    addIncidentLog(inc.id, 'msg', `${n} replies received via Slack/Email.`);
    toast(`${n} replies received.`);
    renderIncidentDetail();
  });
  document.getElementById('btn-send-msg')?.addEventListener('click', () => {
    const inc = state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId); if (!inc) return;
    state.UI_STATE.linkedIncidentId = inc.id;
    state.UI_STATE.selectedOffices = inc.offices.slice();
    openPanel('crisis');
    setCcTab('compose');
    renderCC();
    toast(`Linked to "${inc.title}". Compose your next message.`);
  });
  document.getElementById('btn-reopen-inc')?.addEventListener('click', () => reopenIncident(state.UI_STATE.selectedIncidentId));
  document.getElementById('btn-export-inc')?.addEventListener('click', () => exportIncidentReport(state.UI_STATE.selectedIncidentId));
  document.getElementById('btn-close-inc')?.addEventListener('click', () => {
    const inc = state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.selectedIncidentId); if (!inc) return;
    showModal(`<h3>Close Incident</h3>
      <p style="font-size:12px;color:var(--muted)">Add a closure note for the permanent record.</p>
      <textarea id="close-note" style="width:100%;min-height:80px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:7px;font-size:12px;margin-top:6px"
        placeholder="e.g. All-clear confirmed by building security at 14:30. No injuries."></textarea>
      <div class="modal-actions"><button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="modal-confirm">Confirm</button></div>`);
    document.getElementById('modal-cancel').onclick = closeModal;
    document.getElementById('modal-confirm').onclick = () => {
      inc.status='closed';
      inc.closedNote = document.getElementById('close-note').value || 'No closure note.';
      inc.closedAt = new Date().toISOString();
      addIncidentLog(inc.id, 'close', `Incident closed. ${esc(inc.closedNote)}`);
      closeModal();
      toast('Incident closed and sealed.');
      renderIncidents();
      // Live mode: persist to backend (fire-and-forget). Local close already
      // applied; if API fails, re-open the incident locally so UI matches DB.
      if (API_BASE && !inc._persistPending) {
        const noteForRevert = inc.closedNote;
        incidentsApi.close(inc.id, inc.closedNote).catch(err => {
          console.warn('incident close persist failed:', err);
          inc.status = 'open';
          inc.closedAt = null;
          inc.closedNote = null;     // also clear closure note — UI keys "closed view" off it
          toast(`⚠ Close failed on backend — reverted locally. (Note "${(noteForRevert||'').slice(0,40)}" not persisted.)`);
          renderIncidents();
        });
      }
    };
  });
}

export function buildLayerControls() {
  document.getElementById('office-toggle-list').innerHTML = OFFICES.map(o => `
    <div class="toggle-row"><label><span style="color:var(--muted);font-size:11px">${o.id}</span> ${o.name}</label>
      <input type="checkbox" data-vis-office="${o.id}" checked /></div>`).join('');
  document.getElementById('alert-type-list').innerHTML = ALERT_TYPES.map(t => `
    <div class="toggle-row"><label>${t}</label><input type="checkbox" data-vis-type="${t}" checked/></div>`).join('');
  document.querySelectorAll('[data-vis-office]').forEach(c => c.addEventListener('change', e => {
    const id = e.target.dataset.visOffice;
    state.UI_STATE.visibleOffices = e.target.checked
      ? [...new Set([...state.UI_STATE.visibleOffices, id])]
      : state.UI_STATE.visibleOffices.filter(x => x !== id);
    renderAll();
  }));
  document.querySelectorAll('[data-vis-type]').forEach(c => c.addEventListener('change', e => {
    const t = e.target.dataset.visType;
    state.UI_STATE.visibleAlertTypes = e.target.checked
      ? [...new Set([...state.UI_STATE.visibleAlertTypes, t])]
      : state.UI_STATE.visibleAlertTypes.filter(x => x !== t);
    renderAll();
  }));
  document.querySelectorAll('[data-overlay]').forEach(c => c.addEventListener('change', e => {
    const key = e.target.dataset.overlay;
    state.UI_STATE.hazards[key] = e.target.checked;
    renderHazards();
    if (e.target.checked) {
      const def = HAZARD_ZONES[key] || TILE_OVERLAYS[key];
      if (def) {
        const detail = def.zones ? `${def.zones.length} zone${def.zones.length===1?'':'s'}` : 'live data';
        toast(`${def.label} enabled · ${detail}.`);
      }
    } else {
      const def = HAZARD_ZONES[key] || TILE_OVERLAYS[key];
      if (def) toast(`${def.label} disabled.`);
    }
  }));
  document.querySelectorAll('.sev-seg').forEach(s => s.addEventListener('click', () => {
    document.querySelectorAll('.sev-seg').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    state.UI_STATE.filterMinSev = s.dataset.sev;
    renderAll();
  }));
  document.getElementById('toggle-employees').addEventListener('change', e => { state.UI_STATE.showEmployees = e.target.checked; renderEmployees(); });
  document.getElementById('toggle-travelers').addEventListener('change', e => { state.UI_STATE.showTravelers = e.target.checked; renderTravelers(); });
  document.querySelectorAll('input[name="emp-mode"]').forEach(r => r.addEventListener('change', e => { state.UI_STATE.empMode = e.target.value; renderEmployees(); }));
  document.getElementById('btn-load-emp').addEventListener('click', () => document.getElementById('emp-file').click());
  document.getElementById('btn-clear-emp').addEventListener('click', () => { state.EMPLOYEES = []; renderEmployees(); toast('Employees cleared.'); });
  document.getElementById('emp-file').addEventListener('change', e => loadEmpCSV(e.target.files[0]));
  document.getElementById('btn-load-trav').addEventListener('click', () => document.getElementById('trav-file').click());
  document.getElementById('btn-clear-trav').addEventListener('click', () => { state.TRAVELERS = []; renderTravelers(); renderOffices(); toast('Travelers cleared.'); });
  document.getElementById('trav-file').addEventListener('change', e => loadTravCSV(e.target.files[0]));
}

export function openPanel(p) {
  state.UI_STATE.panels[p] = true;
  document.getElementById('panel-'+p).classList.remove('collapsed');
  document.getElementById('rail-'+p)?.setAttribute('aria-expanded', 'true');
}

export function closePanel(p) {
  state.UI_STATE.panels[p] = false;
  document.getElementById('panel-'+p).classList.add('collapsed');
  document.getElementById('rail-'+p)?.setAttribute('aria-expanded', 'false');
}

// Bridge-cleanup render.js pilot: state.UI_STATE.panels bare → state.UI_STATE.
// closePanel/openPanel are siblings — module-local, unchanged.
export function togglePanel(p) { state.UI_STATE.panels[p] ? closePanel(p) : openPanel(p); }

export function positionToolsDropdown() {
  const dd = document.getElementById('tools-dropdown');
  const btn = document.getElementById('btn-tools');
  if (!dd || !btn) return;
  const r = btn.getBoundingClientRect();
  // Right-anchor to the button's right edge — same visual alignment as the
  // CSS default, but recomputed live so window resizes / panel toggles
  // don't push the dropdown off-position.
  dd.style.top   = (r.bottom + 6) + 'px';
  dd.style.right = (Math.max(8, window.innerWidth - r.right)) + 'px';
  dd.style.left  = '';
  // When the map's effective width is too narrow for a 360px dropdown to
  // sit clear of marker clusters, slim the dropdown so it overlays less
  // of the map and the operator can still see what they're targeting.
  const map = document.getElementById('map');
  const mapWidth = map ? map.getBoundingClientRect().width : window.innerWidth;
  if (mapWidth < 720) {
    dd.style.width = Math.max(280, Math.min(320, mapWidth - 40)) + 'px';
  } else {
    dd.style.width = '';   // fall back to the 360px CSS default
  }
}

export function applyTheme(theme) {
  state.UI_STATE.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-style').textContent = theme === 'dark' ? '🌙' : '☀️';
  TILES.dark.remove(); TILES.light.remove();
  TILES[theme].addTo(map);
  try { localStorage.setItem('nrsa-theme', theme); } catch(_) {}
}

export function showFreshness() {
  showModal(`<h3>Data Sources Freshness</h3>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">${SOURCES.filter(s=>s.status==='ok').length}/${SOURCES.length} sources healthy. 15-min refresh cycle, 24-hour TTL.</p>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr><th align="left">Source</th><th align="left">Type</th><th>Status</th></tr></thead>
      <tbody>${SOURCES.map(s=>`<tr style="border-top:1px solid var(--border)"><td><b>${esc(s.id)}</b><div style="font-size:10px;color:var(--muted)">${esc(s.name)}</div></td><td>${esc(s.type)}</td><td align="center">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.status==='ok'?'var(--green)':s.status==='stale'?'var(--yellow)':'var(--red)'}"></span>
        <span style="font-size:10px;margin-left:4px">${s.status}</span>
      </td></tr>`).join('')}</tbody>
    </table>
    <div class="modal-actions"><button class="btn-ghost" onclick="App.closeModal()">Close</button></div>`);
}

export function renderStatusStrip() {
  const el = document.getElementById('status-strip');
  if (!el) return;

  // 1. Compute the at-a-glance state.
  const openIncidents = state.UI_STATE.incidents.filter(i => i.status === 'open');
  const visAlerts = visibleAlerts();
  const sevByRank = visAlerts.slice().sort((a,b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
  const highest = sevByRank[0] || null;
  const helpCount = openIncidents.reduce((sum, inc) => {
    const r = state.UI_STATE.responses[inc.id] || {};
    return sum + Object.values(r).filter(x => x.status === 'help').length;
  }, 0);
  const okSources    = SOURCES.filter(s => s.status === 'ok').length;
  const staleSources = SOURCES.filter(s => s.status === 'stale').length;
  const errSources   = SOURCES.filter(s => s.status === 'error').length;
  const sourcesState = errSources ? 'crit' : staleSources ? 'warn' : 'ok';

  // 2. Severity-based whole-strip styling.
  const isCritical = highest && highest.sev === 'ext';
  el.classList.toggle('crit', !!isCritical);

  // 3. Build chips.
  const role = ROLE_TAG_STYLE[state.OPERATOR.role] || ROLE_TAG_STYLE.employee;
  const incClass = openIncidents.some(i => i.severity === 'ext') ? 'crit'
                 : openIncidents.some(i => i.severity === 'high') ? 'high'
                 : openIncidents.length ? 'warn' : 'ok';
  const helpClass = helpCount === 0 ? '' : helpCount > 3 ? 'crit' : 'warn';
  const sevWord  = highest ? SEV_NAME[highest.sev] : 'All clear';
  const sevClass = !highest ? 'ok' : highest.sev === 'ext' ? 'crit' : highest.sev === 'high' ? 'high' : highest.sev === 'mod' ? 'warn' : 'ok';

  el.innerHTML = `
    <div class="ss-chip identity" title="Logged-in operator (will come from Okta when integrated)">
      <span class="ss-icon" aria-hidden="true">👤</span>
      <div>
        <div class="ss-label">Logged in as</div>
        <div><span class="ss-value">${esc(state.OPERATOR.name)}</span><span class="ss-role-tag" style="background:${role.bg};color:${role.fg}">${esc(role.label)}</span></div>
      </div>
    </div>
    <button class="ss-chip clickable ${incClass}" data-ss-action="incidents" title="Open incidents — click to view">
      <span class="ss-icon" aria-hidden="true">${openIncidents.length ? '🚨' : '✓'}</span>
      <div style="text-align:left">
        <div class="ss-label">Open Incidents</div>
        <div class="ss-value">${openIncidents.length}</div>
      </div>
    </button>
    <button class="ss-chip clickable ${sevClass}" data-ss-action="highest" ${highest?'':'disabled'} title="${highest ? 'Click to zoom to this alert' : 'No active alerts'}">
      <span class="ss-icon" aria-hidden="true">${!highest ? '🛡' : highest.sev==='ext' ? '⚠' : highest.sev==='high' ? '⚠' : '⚠'}</span>
      <div style="text-align:left">
        <div class="ss-label">Highest Active</div>
        <div class="ss-value">${esc(sevWord)}${highest ? `<span class="ss-sub">· ${esc(highest.title)}</span>` : ''}</div>
      </div>
    </button>
    <button class="ss-chip clickable ${helpClass}" data-ss-action="help" title="Employees marked Need Help">
      <span class="ss-icon" aria-hidden="true">${helpCount ? '🆘' : '🤝'}</span>
      <div style="text-align:left">
        <div class="ss-label">Need Help</div>
        <div class="ss-value">${helpCount}</div>
      </div>
    </button>
    <button class="ss-chip clickable ${sourcesState}" data-ss-action="sources" title="Data sources health — click for detail">
      <span class="ss-icon" aria-hidden="true">📡</span>
      <div style="text-align:left">
        <div class="ss-label">Sources</div>
        <div class="ss-value">${okSources}/${SOURCES.length}</div>
      </div>
    </button>
    ${state.UI_STATE.outbox.length ? `
    <button class="ss-chip clickable warn" data-ss-action="outbox" title="Sends that failed backend persist — click to view + retry">
      <span class="ss-icon" aria-hidden="true">📤</span>
      <div style="text-align:left">
        <div class="ss-label">Outbox</div>
        <div class="ss-value">${state.UI_STATE.outbox.length} failed</div>
      </div>
    </button>` : ''}
    ${(function lastFetchChip() {
      // Live-mode-only — bare Pages and #api=mock don't have a backend to
      // age out, and an empty chip would be more confusing than absent.
      if (!API_BASE) return '';
      if (!state.lastRefreshAt) {
        // First fetch hasn't completed yet (page just loaded, or login pending).
        return `
          <div class="ss-chip warn" title="No successful event fetch yet. If this persists, the backend may be unreachable — check the server is running and the JWT is valid.">
            <span class="ss-icon" aria-hidden="true">⏳</span>
            <div style="text-align:left">
              <div class="ss-label">Last fetch</div>
              <div class="ss-value">—</div>
            </div>
          </div>`;
      }
      const ageSec = Math.max(0, Math.floor((Date.now() - state.lastRefreshAt.getTime()) / 1000));
      const ageMin = Math.floor(ageSec / 60);
      // Threshold rationale: backend polls fastest (USGS) at 60s. Up to ~2min
      // is normal, 2-5min is worth flagging, >5min strongly suggests backend
      // is down or SSE has dropped without auto-recovery.
      const klass = ageMin >= 5 ? 'crit' : ageMin >= 2 ? 'warn' : 'ok';
      const label = ageSec < 60 ? `${ageSec}s ago`
                  : ageMin < 60 ? `${ageMin}m ago`
                  : `${Math.floor(ageMin/60)}h ago`;
      const tip = klass === 'crit'
        ? `Last successful fetch was ${label}. Backend may be down — check 'npm run dev' is running and try a hard refresh.`
        : klass === 'warn'
          ? `Last successful fetch was ${label}. Slightly older than expected — watch for further drift.`
          : `Live data is current. Last successful fetch ${label}.`;
      return `
        <div class="ss-chip ${klass}" title="${esc(tip)}">
          <span class="ss-icon" aria-hidden="true">${klass === 'crit' ? '⚠' : klass === 'warn' ? '⏱' : '✓'}</span>
          <div style="text-align:left">
            <div class="ss-label">Last fetch</div>
            <div class="ss-value">${label}</div>
          </div>
        </div>`;
    })()}
    <div class="ss-chip ss-spacer"></div>
    <button class="ss-chip clickable" data-ss-action="toggle-relevance" title="${state.UI_STATE.officeRelevantOnly ? 'Showing only events affecting an office or traveler. Click to show all global events.' : 'Showing all global events. Click to limit to office/traveler-relevant.'}">
      <span class="ss-icon" aria-hidden="true">${state.UI_STATE.officeRelevantOnly ? '🎯' : '🌐'}</span>
      <div style="text-align:left">
        <div class="ss-label">View</div>
        <div class="ss-value" style="font-size:0.78rem">${state.UI_STATE.officeRelevantOnly ? `Office-relevant (${visAlerts.length}/${state.ALERTS.length})` : `All global (${state.ALERTS.length})`}</div>
      </div>
    </button>
    <div class="ss-chip timestamp" title="Last save · last data refresh">
      <span class="ss-saved-dot" aria-hidden="true" style="${state.lastSavedAt ? '' : 'background:var(--muted);box-shadow:none'}"></span>
      <span>${state.lastSavedAt ? `💾 saved ${relTime(state.lastSavedAt.toISOString())} ago` : 'No saves yet'}</span>
    </div>
  `;

  // 4. Wire chip clicks.
  el.querySelectorAll('[data-ss-action]').forEach(b => b.addEventListener('click', () => {
    const action = b.dataset.ssAction;
    if (action === 'incidents') {
      state.UI_STATE.incidentListFilter = 'open';
      openPanel('incident');
      renderIncidents();
    } else if (action === 'highest' && highest) {
      selectAlert(highest.id);
      // Also open the office popup if there is one
      if (highest.officeId && OFFICE_MARKERS[highest.officeId]) {
        map.once('moveend', () => OFFICE_MARKERS[highest.officeId].openPopup());
      }
    } else if (action === 'help') {
      // Find the incident with the most help responses, open it in Responses tab.
      let target = null, max = -1;
      state.UI_STATE.incidents.filter(i => i.status === 'open').forEach(inc => {
        const cnt = Object.values(state.UI_STATE.responses[inc.id]||{}).filter(r => r.status === 'help').length;
        if (cnt > max) { max = cnt; target = inc; }
      });
      if (target) {
        state.UI_STATE.msgFilter = 'help';
        state.UI_STATE.incidentTab = 'responses';
        openPanel('incident');
        selectIncident(target.id);
      } else {
        toast('No employees flagged Need Help.');
      }
    } else if (action === 'sources') {
      document.getElementById('btn-help')?.blur();
      // Trigger the existing freshness modal directly
      App.showFreshness?.();
    } else if (action === 'outbox') {
      showOutboxModal();
    } else if (action === 'toggle-relevance') {
      state.UI_STATE.officeRelevantOnly = !state.UI_STATE.officeRelevantOnly;
      toast(state.UI_STATE.officeRelevantOnly
        ? '🎯 Showing office-relevant only.'
        : '🌐 Showing all global events.');
      renderAll();
    }
  }));
}

/**
 * Freshness banner — shouty top-of-viewport red bar when the backend
 * appears offline. Complements the small "Last fetch" chip in the status
 * strip (see renderStatusStrip). That chip was missed by operators twice
 * during 4-day silent outages (2026-06-10 and 2026-07-03) because it sits
 * in a busy row of chips and is easy to overlook.
 *
 * TRIGGER (live mode only — bare Pages and #api=mock have no backend):
 *   crit → 5+ minutes since last successful /api/events fetch, OR
 *          page has been loaded > 60s and no fetch has ever succeeded
 *   warn → 2-5 minutes since last successful fetch
 *   ok   → hidden
 *
 * Thresholds match the "Last fetch" chip's tier boundaries so the two
 * indicators stay in agreement. Renders on every renderStatusStrip call
 * and every status-strip ticker tick (~60s), so operators see the state
 * transition within a minute of it happening.
 *
 * Deliberately does NOT try to detect "backend up but not ingesting"
 * (e.g., all adapters silently broken). That's a legitimate follow-up
 * but harder to distinguish from a quiet news day. This banner catches
 * the far more common case: backend process died.
 */
export function renderFreshnessBanner() {
  const el = document.getElementById('freshness-banner');
  if (!el) return;

  // Non-live modes: no backend to worry about, hide the banner.
  if (!API_BASE) { el.hidden = true; el.className = 'freshness-banner'; return; }

  const now = Date.now();
  let tier = 'ok';           // 'ok' | 'warn' | 'crit'
  let ageLabel = '';
  let title = '';
  let detail = '';

  if (!state.lastRefreshAt) {
    // No fetch ever succeeded. Wait 60s after page load before flagging
    // — the first fetch typically completes within a few seconds of
    // login, and we don't want a banner flashing on every page load.
    const bootAgeMs = now - (renderFreshnessBanner._bootTs || (renderFreshnessBanner._bootTs = now));
    if (bootAgeMs > 60_000) {
      tier = 'crit';
      title = 'Backend not responding — no data fetched since page load.';
      detail = 'Start the backend with `npm run dev` in the backend/ directory, then hard-refresh this page.';
    }
  } else {
    const ageSec = Math.max(0, Math.floor((now - state.lastRefreshAt.getTime()) / 1000));
    const ageMin = Math.floor(ageSec / 60);
    ageLabel = ageSec < 60 ? `${ageSec}s`
             : ageMin < 60 ? `${ageMin}m`
             : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
    if (ageMin >= 5) {
      tier = 'crit';
      title = `Backend not responding — last data fetch was ${ageLabel} ago.`;
      detail = 'Check the backend terminal — the process may have died. Restart with `npm run dev`.';
    } else if (ageMin >= 2) {
      tier = 'warn';
      title = `Data slightly stale — last fetch was ${ageLabel} ago.`;
      detail = 'Watch for further drift. Fetches normally complete within a minute.';
    }
    // ok tier: banner stays hidden
  }

  if (tier === 'ok') {
    el.hidden = true;
    el.className = 'freshness-banner';
    return;
  }

  el.className = `freshness-banner ${tier}`;
  el.hidden = false;
  el.innerHTML = `
    <span class="fb-icon" aria-hidden="true">${tier === 'crit' ? '⚠' : '⏱'}</span>
    <div class="fb-body">
      <span class="fb-title">${esc(title)}</span>
      <span class="fb-detail">${detail.replace(/`([^`]+)`/g, '<code>$1</code>')}</span>
    </div>
  `;
}

export function renderAll() {
  renderOffices(); renderAlertDots(); renderEmployees(); renderTravelers(); renderHazards();
  renderFeed(); renderCC(); renderIncidents();
  renderStatusStrip();
  renderFreshnessBanner();
  saveState();   // debounced
}

/* private */ let _statusStripTicker = null;

export function startStatusStripTicker() {
  if (_statusStripTicker) return;
  _statusStripTicker = setInterval(() => {
    if (document.getElementById('status-strip')) renderStatusStrip();
    // Also re-check freshness — the banner needs its own tick because
    // it can transition from ok → warn → crit as the last-fetch age
    // advances without any other render triggering.
    renderFreshnessBanner();
  }, 60000);
}

export function applyPanelWidths() {
  ['alerts','crisis','incident'].forEach(p => {
    const el = document.getElementById('panel-'+p);
    if (el) el.style.width = (state.UI_STATE.panelWidths?.[p] || 340) + 'px';
  });
}

export function setupPanelResize() {
  document.querySelectorAll('[data-resize-panel]').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const panelId = handle.dataset.resizePanel;
      const panel = document.getElementById('panel-' + panelId);
      if (!panel) return;
      const startX = e.clientX;
      const startW = panel.offsetWidth;
      const isLeftZone = panel.closest('.left-zone') !== null;
      handle.classList.add('dragging');
      document.body.classList.add('resizing-panel');

      function onMove(ev) {
        const dx = ev.clientX - startX;
        // Left-zone handle on right edge: drag right grows. Right-zone handle on left edge: drag left grows.
        const newW = isLeftZone ? startW + dx : startW - dx;
        const clamped = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, newW));
        panel.style.width = clamped + 'px';
        if (typeof map !== 'undefined' && map) map.invalidateSize();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-panel');
        state.UI_STATE.panelWidths[panelId] = parseInt(panel.style.width, 10) || PANEL_MIN_W;
        saveState();
        if (typeof map !== 'undefined' && map) map.invalidateSize();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // Double-click handle resets to default
    handle.addEventListener('dblclick', () => {
      const panelId = handle.dataset.resizePanel;
      const defaults = { alerts: 340, crisis: 360, incident: 360 };
      state.UI_STATE.panelWidths[panelId] = defaults[panelId];
      applyPanelWidths();
      if (typeof map !== 'undefined' && map) map.invalidateSize();
      saveState();
      toast('Panel reset to default width.');
    });
  });
}

