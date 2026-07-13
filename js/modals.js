/**
 * NRSA / S.T.A.R. View — modal logic.
 *
 * SESSION 3 / step 10 (2026-06-19): the final extraction. Brings out every
 * modal builder and the send-flow confirm+dispatch logic into a dedicated
 * module. After this, legacy-app.js is just boot wiring + event handlers
 * + the demo IIFE + inline duplicates of constants (which can be removed
 * in a future cleanup pass).
 *
 * Categories:
 *
 *   1. Modal infrastructure
 *      - showModal(html): mounts a modal-back overlay with the given HTML
 *      - closeModal(): removes the overlay
 *      - toast(msg): bottom-right transient notification
 *
 *   2. Crisis Comms send flow (confirmSend → dispatchSend)
 *      - confirmSend opens the Confirm-Send modal showing recipient + channel
 *        summary; the operator clicks #modal-confirm to actually fire dispatchSend.
 *      - dispatchSend handles the full pipeline: build msg object, optionally
 *        auto-create incident, queue+flush message persist if create is in flight,
 *        update STATE, switch ccTab to log, render. Honors test-mode (drill route).
 *
 *   3. Travelers list modal (showTravelersList + 8 helpers)
 *      - showTravelersList opens a sortable+filterable table of in-flight
 *        travelers. Includes CSV export and per-row map zoom + Crisis prefill.
 *      - Live + bare-Pages mode shows "Pending Navan integration" placeholder.
 *
 *   4. BCI (Business Continuity Incident) declaration flow
 *      - showBCPModal opens the BCI declare form with event-type / title /
 *        country picker / live exposure readout / acknowledgment checkbox.
 *      - declareBCP creates the incident with severity=ext, attaches BCI
 *        metadata (bcp:true, bcpEventType, bcpScope, bcpExposureSnapshot),
 *        and pre-fills Crisis Comms compose with the BCI template.
 *      - showBCIWaitingChip / clearBCIWaitingChip handle the geo-fence-draw
 *        round trip when an operator picks "use fence" inside the BCI form.
 *
 *   5. Risk Profile modal (showRiskProfileModal + 4 helpers)
 *      - Per-country risk dashboard: live hazards (NWS/MeteoAlarm/GDACS/USGS
 *        active), ACLED civil-unrest history (mock-only — license required
 *        for live), WHO disease outbreaks. Always-rendering chip picker
 *        across the union of COUNTRY_PRESENCE + state.ACLED_RISK keys.
 *
 * BRIDGE RELIANCE (function bodies stay verbatim, references resolve via
 * window-fallthrough at call time):
 *   - State: state.UI_STATE.X mutations propagate via state.js bridge.
 *     state.BCP_FORM / state.TRAV_VIEW / state.RISK_VIEW are bridged direct-assign (object
 *     refs) so .property mutations work without renames.
 *   - Constants: COUNTRY_PRESENCE, OFFICES, OFFICE_BY_ID, BCP_EVENT_TYPES,
 *     TEMPLATES, etc. via constants.js bridge.
 *   - Helpers: esc, linkify, fmtSize, fmtHeadcount, sumHeadcount,
 *     hasOfficeHeadcounts, hasAcledRisk, aggregateAcledRisk, hasWhoOutbreaks,
 *     outbreaksAggregated, normalizeWhoCountry, liveHazardsForCountry,
 *     liveHazardsAggregated, allTemplates, suggestTemplate, recipientsForChannel,
 *     allTargets, targetById, alertCountryFor, relevanceTierOf,
 *     enrichEventWithImpact, etc. via helpers.js bridge.
 *   - Render functions: renderAll, renderCC, renderIncidents, renderStatusStrip,
 *     setCcTab, openPanel, closePanel, etc. via render.js bridge.
 *   - Persistence: saveState (every state mutation in modals triggers it).
 *   - API: incidentsApi, commsApi (used by dispatchSend), bootLiveMode (login
 *     modal triggers it). All via api.js bridge.
 *   - Legacy globals: createIncident (still in legacy-app.js — top-level
 *     function decl on classic script, on window). addIncidentLog, reopenIncident,
 *     buildResponseShells (also still in legacy-app.js, on window).
 *
 * After step 10 lands, legacy-app.js carries: app shell + boot trigger
 * + DOM event listeners + demo simulator IIFE + a handful of incident-state
 * helpers (createIncident, addIncidentLog, reopenIncident, buildResponseShells)
 * that didn't fit cleanly elsewhere. Future cleanup can move those too.
 */

// Bridge-cleanup imports for modals.js.
//
// Historical batches (kept for archaeology):
//   - First-imports batch (commit 9d4de14, 2026-07-13): introduced module-
//     scope imports to modals.js for the first time; 4 constants
//     (BCP_EVENT_TYPES, COUNTRY_PRESENCE, TEST_PREFIX_SUBJECT/BODY) that
//     were grep-confirmed as modals.js-only bare users, earning 4 ESLint
//     globals trims.
//   - STATE sweep (commit 96f588e): 52 bare STATE.X reads → state.UI_STATE.X.
//     Added `import { state } from './state.js'`.
//   - Reassignable-state migration (commit 7b44846): 100 bare reads of
//     ALERTS/TRAVELERS/BCP_FORM/RISK_VIEW/TRAV_VIEW/ACLED_RISK/REMOTE_EMPLOYEES
//     converted to state.X.
//
// This batch (2026-07-13, no ESLint trim): full hygiene sweep. Extends
// imports to cover every bridged fn/const modals.js actually calls. Same
// pattern as render.js hygiene batch (commit 1791c32). No function bodies
// changed. Value: typo protection + IDE navigation inside modals.js.
// A typo like `es(...)` for `esc(...)` now fires no-undef immediately.
//
// Grep-audit found 46 identifiers in use across 5 modules; all now imported.
import {
  BCP_EVENT_TYPES,
  COUNTRY_PRESENCE,
  OFFICES,
  OFFICE_BY_ID,
  SEV_RANK,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEST_PREFIX_BODY,
  TEST_PREFIX_SUBJECT,
  TEST_ROUTING,
} from './constants.js';
import { state } from './state.js';
import {
  aggregateAcledRisk,
  alertCountryFor,
  allTargets,
  allTemplates,
  enrichEventWithImpact,
  esc,
  fmtHeadcount,
  fmtSize,
  hasAcledRisk,
  hasOfficeHeadcounts,
  hasWhoOutbreaks,
  linkify,
  liveHazardsAggregated,
  liveHazardsForCountry,
  normalizeWhoCountry,
  outbreaksAggregated,
  passesFilter,
  recipientsForChannel,
  relevanceTierOf,
  relTime,
  suggestTemplate,
  sumHeadcount,
  targetById,
  uid,
} from './helpers.js';
import {
  closePanel,
  openPanel,
  renderAll,
  renderCC,
  renderIncidents,
  renderStatusStrip,
  setCcTab,
} from './render.js';
import { saveState } from './persistence.js';
import {
  API_BASE,
  bootLiveMode,
  commsApi,
  incidentsApi,
} from './api.js';
import {
  addIncidentLog,
  buildResponseShells,
  createIncident,
  reopenIncident,
} from './incidents.js';

export function confirmSend() {
  const channels = Object.entries(state.UI_STATE.channels).filter(([k,v])=>v && k!=='sms').map(([k])=>k);
  if (!channels.length || !state.UI_STATE.selectedOffices.length) return;
  const body = state.UI_STATE.customMessage || (allTemplates().find(t=>t.id===state.UI_STATE.template)?.body || '');
  if (!body.trim()) { toast('Pick a template or write a message.'); return; }
  const reach = state.UI_STATE.selectedOffices.reduce((s,id)=>s+(targetById(id)?.headcount||0),0);
  const tplName = allTemplates().find(t=>t.id===state.UI_STATE.template)?.name || 'Custom';
  showModal(`
    <h3>Confirm send</h3>
    <p style="font-size:12px;color:var(--muted)">Review before dispatching.</p>
    <div class="reach-preview" style="margin-top:8px">
      <div><b>Offices:</b> ${esc(state.UI_STATE.selectedOffices.map(id=>targetById(id)?.name||id).join(', '))}</div>
      <div><b>Channels:</b> ${channels.map(c=>c.toUpperCase()).join(' + ')}</div>
      <div><b>Recipients:</b> ~${reach.toLocaleString()}</div>
      <div><b>Template:</b> ${esc(tplName)}</div>
      ${state.UI_STATE.subject?`<div><b>Subject:</b> ${esc(state.UI_STATE.subject)}</div>`:''}
      ${state.UI_STATE.responseRequired?'<div><b>Response tracking:</b> on (creates new incident)</div>':''}
    </div>
    <div style="font-size:11px;background:var(--bg3);border-radius:5px;padding:6px;margin-top:8px;line-height:1.4">${esc(body)}</div>
    <div class="modal-actions">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="modal-confirm">Confirm Send</button>
    </div>`);
  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('modal-confirm').onclick = () => {
    closeModal();
    dispatchSend(body, channels, reach);
  };
}

export function dispatchSend(body, channels, reach) {
  const tpl = allTemplates().find(t => t.id === state.UI_STATE.template);
  const tplName = tpl?.name || 'Custom message';

  // 2026-06-18: drill-mode dispatch.
  //
  // When state.UI_STATE.isTest is on (and we are NOT linked to an existing incident,
  // because test mode is locked off in that flow), apply three transforms
  // ONLY to the artifact actually delivered to a recipient:
  //   1) Subject prepended with "[TEST] " so a recipient sees TEST first.
  //   2) Body prepended with the drill-warning preamble.
  //   3) Channels filtered to those that have a TEST_ROUTING entry (SMS
  //      drops out by design — no test SMS distro).
  //
  // EVERYTHING ELSE is left at the operator's actual selection so the drill
  // exercises the full normal workflow (per the 2026-06-18 spec: "all of the
  // normal features but recorded as test messages"):
  //   - msg.offices keeps state.UI_STATE.selectedOffices so the incident scope and
  //     response-tracking shells reflect the drill scenario.
  //   - msg.responseRequired keeps state.UI_STATE.responseRequired so the operator
  //     can rehearse the response-tracking UI inside the drill incident.
  //   - The auto-incident-create branch fires unchanged when the operator
  //     had Response Required on. The resulting incident is REAL (per Q1
  //     of the design Q&A) — its drill nature is signaled by the 🧪 TEST
  //     badge on the message inside + the "incl. test" hint on the card.
  //
  // The is_test flag persists everywhere downstream: msg.isTest in local
  // state, isTest in the API payload, is_test=true in Postgres, 🧪 TEST
  // badge in every render surface (Comms tab, standalone log, incident Log,
  // Export Report).
  const linkedAtSendTime = state.UI_STATE.linkedIncidentId
    ? state.UI_STATE.incidents.find(x => x.id === state.UI_STATE.linkedIncidentId)
    : null;
  const isTest = !!state.UI_STATE.isTest && !linkedAtSendTime;
  const testChannels = isTest
    ? channels.filter(c => TEST_ROUTING[c])           // drop SMS (no test routing)
    : channels;
  const sendChannels = isTest && testChannels.length ? testChannels : channels;
  const finalSubject = isTest
    ? TEST_PREFIX_SUBJECT + (state.UI_STATE.subject || `[${tplName}]`)
    : state.UI_STATE.subject;
  const finalBody = isTest ? TEST_PREFIX_BODY + body : body;

  const msg = {
    id: uid(), when: new Date().toISOString(), by:'cowork-3p',
    offices: state.UI_STATE.selectedOffices.slice(), channels: sendChannels.slice(),
    subject: finalSubject,
    body: finalBody, recipients: reach, responseRequired: state.UI_STATE.responseRequired,
    template: state.UI_STATE.template, templateName: tplName,
    reminder: state.UI_STATE.reminderInterval,
    attachments: state.UI_STATE.attachments.slice(),
    incidentId: null,    // filled below
    isTest,              // persisted client-side and propagated through API
  };

  let inc = linkedAtSendTime;

  if (inc) {
    // Append to existing incident
    msg.incidentId = inc.id;
    inc.messages.push(msg);
    // top up response shells in case offices were added since open
    buildResponseShells(inc.id, state.UI_STATE.selectedOffices);
    addIncidentLog(inc.id, 'comm', `Sent <b>${esc(tplName)}</b> via ${channels.join(', ')} to ${reach.toLocaleString()} recipients.`);
  } else if (state.UI_STATE.responseRequired) {
    // Create new incident on first response-required send.
    // Auto-link the highest-severity active alert in the affected offices, if any.
    const candidateAlerts = state.ALERTS
      .filter(a => a.officeId && state.UI_STATE.selectedOffices.includes(a.officeId) && passesFilter(a))
      .sort((a,b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || new Date(b.issued) - new Date(a.issued));
    const linkedAlert = candidateAlerts[0] || null;
    const officeNames = state.UI_STATE.selectedOffices.map(id => targetById(id)?.name || id).join(', ');
    inc = createIncident({
      title: `${tplName} — ${state.UI_STATE.selectedOffices.join(', ')}`,
      offices: state.UI_STATE.selectedOffices.slice(),
      severity: state.UI_STATE.template==='evac' || state.UI_STATE.template==='shelter' ? 'high' : 'mod',
      description: `Incident auto-created when "${tplName}" was dispatched with Response Required enabled. Initial reach: ~${reach.toLocaleString()} recipients across ${officeNames}. Channels: ${channels.map(c=>c.toUpperCase()).join(', ')}. Reminder interval: ${state.UI_STATE.reminderInterval}.${linkedAlert?` Linked to active alert ${linkedAlert.id}: ${linkedAlert.title}.`:''}`,
      messageId: msg.id,
      alertId: linkedAlert ? linkedAlert.id : null,
    });
    msg.incidentId = inc.id;
    inc.messages.push(msg);
    addIncidentLog(inc.id, 'comm', `Sent <b>${esc(tplName)}</b> via ${channels.join(', ')} to ${reach.toLocaleString()} recipients.`);
  }

  state.UI_STATE.crisisLog.push(msg);
  if (isTest) {
    // Drill-mode toast: clearly signal that nothing went to real recipients,
    // and that the message is logged with the test flag for audit.
    const routingHint = sendChannels.map(c => `${c.toUpperCase()} → ${TEST_ROUTING[c]}`).join(' · ');
    toast(`🧪 TEST logged · ${routingHint || 'logged only (no test routing for selected channels)'}`);
  } else {
    toast(`✓ Dispatched to ~${reach.toLocaleString()} via ${channels.map(c=>c.toUpperCase()).join('+')}${msg.attachments.length?` · ${msg.attachments.length} attachment${msg.attachments.length===1?'':'s'}`:''}`);
  }
  state.UI_STATE.customMessage = ''; state.UI_STATE.subject = ''; state.UI_STATE.template = '';
  state.UI_STATE.attachments = [];
  // Reset the test toggle after a send. Operators should opt-in deliberately
  // each time — leaving it sticky risks a real send accidentally going to
  // the test channel, which would be a worse failure mode than the reverse
  // (forgetting to toggle on a drill is recoverable; sending real comms to
  // #cmt-test-channel during an actual incident is not).
  state.UI_STATE.isTest = false;
  state.UI_STATE.linkedIncidentId = inc ? inc.id : null;   // keep linked for subsequent messages in the flow
  setCcTab('log');
  renderIncidents();
  if (inc) selectIncident(inc.id);

  // Live mode: persist the message. Three cases:
  //   - Linked to a server-persisted incident → POST /api/incidents/:id/messages
  //   - Linked to a still-being-created incident → skip server (would 404);
  //     log warning so we don't silently drop in production
  //   - Standalone (no incident at all) → POST /api/comms
  if (API_BASE) {
    const apiPayload = {
      template:         msg.template ?? undefined,
      templateName:     msg.templateName,
      subject:          msg.subject || undefined,
      body:             msg.body,
      channels:         msg.channels,
      offices:          msg.offices,
      recipientsCount:  msg.recipients,
      responseRequired: msg.responseRequired,
      reminderInterval: msg.reminder ?? undefined,
      attachments:      msg.attachments,
      isTest:           msg.isTest,
    };
    if (inc && !inc._persistPending) {
      incidentsApi.sendMessage(inc.id, apiPayload).then((serverMsgId) => {
        if (serverMsgId) msg.id = serverMsgId;
      }).catch(err => {
        console.warn('incident-linked message persist failed:', err);
        toast('⚠ Message logged locally — backend persist failed.');
      });
    } else if (inc && inc._persistPending) {
      // Race fix (2026-06-18): the incident's create() round-trip is still
      // in flight, so its server UUID isn't known yet. Park this message
      // on a queue; createIncident's .then() handler will flush it after
      // the UUID swap. Without this branch, the first Response-Required
      // send silently skipped backend persist — the smoke harness caught
      // this on its first run.
      inc._pendingMessages = inc._pendingMessages || [];
      inc._pendingMessages.push({ msg, apiPayload });
    } else {
      commsApi.send(apiPayload).then((serverMsgId) => {
        if (serverMsgId) msg.id = serverMsgId;
      }).catch(err => {
        console.warn('standalone comms persist failed:', err);
        toast('⚠ Message logged locally — backend persist failed.');
      });
    }
  }
}

export function showModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back'; back.id='modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('click', e => { if (e.target===back) closeModal(); });
  document.body.appendChild(back);
  // focus the first focusable element for keyboard users
  setTimeout(() => {
    const focusable = back.querySelector('input, textarea, button, select');
    focusable?.focus();
  }, 0);
}

export function closeModal() { document.getElementById('modal-back')?.remove(); }

export function toast(msg) {
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div'); t.className='toast'; t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>t.classList.add('fade'), 2400);
  setTimeout(()=>t.remove(), 3000);
}

export function showTravelersList() {
  showModal(travListBodyHTML());
  bindTravListHandlers();
}

export function travListBodyHTML() {
  const filt = (t, label) => `<button data-trav-filter="${t}" class="trav-filt" style="padding:6px 12px;background:${t===state.TRAV_VIEW.typeFilter?'var(--green)':'var(--bg3)'};color:${t===state.TRAV_VIEW.typeFilter?'#062c1f':'var(--text)'};border:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;font-weight:${t===state.TRAV_VIEW.typeFilter?'700':'400'};">${label}</button>`;
  // In live + bare Pages mode state.TRAVELERS is empty (no Navan integration yet).
  // Show a placeholder header subtitle and hide the search/filter/CSV toolbar
  // since there's nothing to search, filter, or export.
  const isMock   = state.TRAVELERS.length > 0;
  const subtitle = isMock
    ? 'Mock data — Navan integration pending. Displayed values are illustrative.'
    : 'Pending Navan integration. Traveler itineraries will populate once Navan is connected.';
  const headerLabel = isMock ? `✈ Travelers (${state.TRAVELERS.length})` : '✈ Travelers';
  return `<div style="width:min(960px,92vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:16px;font-weight:700;">${headerLabel}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${subtitle}</div>
      </div>
      <button class="btn-ghost" onclick="App.closeModal()" aria-label="Close">✕</button>
    </div>
    ${isMock ? `<div style="display:flex;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap;">
      <input id="trav-search" type="text" placeholder="Search name, city, country, hotel, airline..." value="${esc(state.TRAV_VIEW.search)}"
        style="flex:1;min-width:220px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);" />
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:4px;overflow:hidden;">
        ${filt('all','All')}${filt('flight','✈ Flight')}${filt('hotel','🏨 Hotel')}${filt('office','🏢 Office')}
      </div>
      <button class="btn-ghost" id="trav-export-csv">⬇ CSV</button>
    </div>` : ''}
    <div id="trav-list-body" style="flex:1;overflow-y:auto;"></div>
  </div>`;
}

export function travSortValue(t, key) {
  switch (key) {
    case 'name': return t.name.toLowerCase();
    case 'home': return t.home;
    case 'country': return (t.country||'').toLowerCase();
    case 'type': return t.type;
    case 'details': return (t.flight?.number || t.hotel?.name || t.office?.id || '').toLowerCase();
    case 'lastKnown': return t.lastKnownTs || '';
    default: return '';
  }
}

export function travListRowsHTML() {
  // Distinguish "no data at all" (Navan not integrated yet — live + bare Pages)
  // from "user filtered the list to nothing" (mock mode with no matches).
  if (state.TRAVELERS.length === 0) {
    return `<div style="padding:60px 40px;text-align:center;color:var(--muted);">
      <div style="font-size:36px;margin-bottom:12px;opacity:0.5;">✈</div>
      <div style="font-size:14px;margin-bottom:6px;color:var(--text);">Traveler data unavailable</div>
      <div style="font-size:12px;line-height:1.5;max-width:420px;margin:0 auto;">Awaiting Navan connection. Traveler itineraries (flights, hotels, office visits) will populate here once Navan is connected to the dashboard.</div>
    </div>`;
  }
  const { sortKey, sortDir, search, typeFilter } = state.TRAV_VIEW;
  let rows = state.TRAVELERS.slice();
  if (typeFilter !== 'all') rows = rows.filter(t => t.type === typeFilter);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(t =>
      (t.name+' '+t.destCity+' '+t.country+' '+(t.hotel?.name||'')+' '+(t.flight?.airline||'')+' '+(t.flight?.number||''))
        .toLowerCase().includes(s)
    );
  }
  rows.sort((a, b) => {
    const av = travSortValue(a, sortKey), bv = travSortValue(b, sortKey);
    if (av === bv) return 0;
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  if (!rows.length) return `<div style="padding:40px;text-align:center;color:var(--muted);">No travelers match the filter.</div>`;

  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const th = (key, label) => `<th data-trav-sort="${key}" style="cursor:pointer;padding:10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);user-select:none;background:var(--bg2);">${label}${arrow(key)}</th>`;

  return `<table style="width:100%;border-collapse:collapse;">
    <thead style="position:sticky;top:0;z-index:1;">
      <tr>${th('name','Name')}${th('home','Home')}${th('country','Country / City')}${th('type','Type')}${th('details','Itinerary')}${th('lastKnown','Last seen')}<th style="padding:10px;border-bottom:1px solid var(--border);background:var(--bg2);"></th></tr>
    </thead>
    <tbody>${rows.map(travRowHTML).join('')}</tbody>
  </table>`;
}

export function travRowHTML(t) {
  const homeOff = OFFICE_BY_ID[t.home];
  let detail = '<span style="color:var(--muted);">—</span>';
  if (t.type === 'flight' && t.flight) {
    detail = `<b>${esc(t.flight.airline)} ${esc(t.flight.number)}</b><br><span style="color:var(--muted);font-size:11px;">${esc(t.flight.origin)} → ${esc(t.flight.dest)} · arr ${_fmtTravTime(t.flight.arrival)}</span>`;
  } else if (t.type === 'hotel' && t.hotel) {
    detail = `<b>${esc(t.hotel.name)}</b><br><span style="color:var(--muted);font-size:11px;">${_fmtTravDate(t.hotel.checkIn)} – ${_fmtTravDate(t.hotel.checkOut)} · ${esc(t.hotel.confirm||'')}</span>`;
  } else if (t.type === 'office' && t.office) {
    const o = OFFICE_BY_ID[t.office.id];
    detail = `<b>${esc(o?.name||t.office.id)} office</b><br><span style="color:var(--muted);font-size:11px;">${_fmtTravDate(t.office.arriveDate)} – ${_fmtTravDate(t.office.departDate)}</span>`;
  }
  const typeIcon = t.type === 'flight' ? '✈' : t.type === 'hotel' ? '🏨' : '🏢';
  const typeColor = t.type === 'flight' ? 'var(--blue)' : t.type === 'hotel' ? 'var(--yellow)' : 'var(--green)';
  return `<tr style="border-bottom:1px solid var(--border);">
    <td style="padding:10px;"><b>${esc(t.name)}</b></td>
    <td style="padding:10px;color:var(--muted);">${esc(homeOff?.name || t.home)}</td>
    <td style="padding:10px;"><b>${esc(t.country)}</b><br><span style="color:var(--muted);font-size:11px;">${esc(t.destCity)}</span></td>
    <td style="padding:10px;"><span style="display:inline-flex;align-items:center;gap:4px;color:${typeColor};font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">${typeIcon} ${esc(t.type)}</span></td>
    <td style="padding:10px;font-size:12px;line-height:1.4;">${detail}</td>
    <td style="padding:10px;color:var(--muted);font-size:11px;white-space:nowrap;">${relTime(t.lastKnownTs)}</td>
    <td style="padding:10px;text-align:right;white-space:nowrap;">
      <button class="btn-ghost trav-zoom" data-trav-id="${esc(t.id)}" title="Zoom map" style="font-size:11px;padding:4px 8px;margin-right:4px;">📍</button>
      <button class="btn-ghost trav-msg" data-trav-id="${esc(t.id)}" title="Pre-fill Crisis Comms" style="font-size:11px;padding:4px 8px;">✉</button>
    </td>
  </tr>`;
}

export function refreshTravList() {
  const body = document.getElementById('trav-list-body');
  if (body) body.innerHTML = travListRowsHTML();
  bindTravListRowHandlers();
}

export function bindTravListHandlers() {
  // Toolbar controls only exist when state.TRAVELERS has data — guard the lookups
  // so an empty list (live mode without Navan) doesn't throw.
  const searchEl = document.getElementById('trav-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      state.TRAV_VIEW.search = e.target.value;
      refreshTravList();
    });
  }
  document.querySelectorAll('[data-trav-filter]').forEach(b => b.addEventListener('click', () => {
    state.TRAV_VIEW.typeFilter = b.dataset.travFilter;
    // Re-render the whole modal so chip styling refreshes
    const back = document.getElementById('modal-back');
    if (back) back.querySelector('.modal').innerHTML = travListBodyHTML();
    bindTravListHandlers();
  }));
  const csvBtn = document.getElementById('trav-export-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportTravelersCSV);
  refreshTravList();
}

export function bindTravListRowHandlers() {
  document.querySelectorAll('[data-trav-sort]').forEach(h => h.addEventListener('click', () => {
    const key = h.dataset.travSort;
    if (state.TRAV_VIEW.sortKey === key) state.TRAV_VIEW.sortDir = state.TRAV_VIEW.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.TRAV_VIEW.sortKey = key; state.TRAV_VIEW.sortDir = 'asc'; }
    refreshTravList();
  }));
  document.querySelectorAll('.trav-zoom').forEach(b => b.addEventListener('click', () => {
    const t = state.TRAVELERS.find(x => x.id === b.dataset.travId);
    if (!t) return;
    closeModal();
    map.flyTo([t.lat, t.lng], 7, { duration: 0.8 });
    toast(`Zoomed to ${t.name} · ${t.destCity}`);
  }));
  document.querySelectorAll('.trav-msg').forEach(b => b.addEventListener('click', () => {
    const t = state.TRAVELERS.find(x => x.id === b.dataset.travId);
    if (!t) return;
    closeModal();
    const locLabel = `${t.name} · ${t.destCity}`;
    if (!state.UI_STATE.customLocations.includes(locLabel)) state.UI_STATE.customLocations.push(locLabel);
    if (!state.UI_STATE.subject) state.UI_STATE.subject = `Safety check — ${t.name} (${t.destCity})`;
    state.UI_STATE.template = 'check';
    openPanel('crisis');
    setCcTab('compose');
    renderCC();
    toast(`Pre-loaded Crisis Comms for ${t.name}.`);
  }));
}

export function exportTravelersCSV() {
  const headers = ['id','name','home','destCity','country','type','airline','flightNumber','origin','dest','departure','arrival','hotelName','hotelAddress','checkIn','checkOut','confirmation','officeId','officeArrive','officeDepart','lastKnownTs','lat','lng'];
  const rows = state.TRAVELERS.map(t => [
    t.id, t.name, t.home, t.destCity, t.country||'', t.type,
    t.flight?.airline||'', t.flight?.number||'', t.flight?.origin||'', t.flight?.dest||'',
    t.flight?.departure||'', t.flight?.arrival||'',
    t.hotel?.name||'', t.hotel?.address||'', t.hotel?.checkIn||'', t.hotel?.checkOut||'', t.hotel?.confirm||'',
    t.office?.id||'', t.office?.arriveDate||'', t.office?.departDate||'',
    t.lastKnownTs||'', t.lat, t.lng,
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => {
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `travelers-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${state.TRAVELERS.length} travelers to CSV.`);
}

export function showBCPModal(preserve = false) {
  if (!preserve) {
    Object.assign(state.BCP_FORM, { title:'', countries:[], useFence:false, customMessage:'', acknowledged:false, _waitingForFence:false });
  } else {
    state.BCP_FORM._waitingForFence = false; // returning from fence-draw round trip
  }
  showModal(bcpModalHTML());
  bindBCPHandlers();
}

export function showBCIWaitingChip() {
  clearBCIWaitingChip(); // idempotent
  const chip = document.createElement('div');
  chip.id = 'bci-waiting-chip';
  chip.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9999;background:#fca5a5;color:#0a0a0a;padding:6px 14px;border-radius:14px;font:11px/1.4 system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.35);user-select:none;font-weight:700;';
  chip.textContent = '✕ Cancel — return to BCI';
  chip.title = 'Cancel fence draw and reopen the BCI form (state preserved)';
  chip.addEventListener('click', () => {
    clearBCIWaitingChip();
    state.BCP_FORM._waitingForFence = false;
    document.getElementById('tools-dropdown')?.classList.remove('open');
    showBCPModal(true);
  });
  document.body.appendChild(chip);
  state.BCP_FORM._waitingTimeoutId = setTimeout(() => {
    if (state.BCP_FORM._waitingForFence) {
      clearBCIWaitingChip();
      state.BCP_FORM._waitingForFence = false;
      toast('Fence draw timed out. Click Declare BCI again to retry.');
    }
  }, 30000);
}

export function clearBCIWaitingChip() {
  const c = document.getElementById('bci-waiting-chip');
  if (c) c.remove();
  if (state.BCP_FORM._waitingTimeoutId) {
    clearTimeout(state.BCP_FORM._waitingTimeoutId);
    state.BCP_FORM._waitingTimeoutId = null;
  }
}

export function bcpModalHTML() {
  return `<div style="width:min(900px,92vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:rgba(248,113,113,.08);">
      <div>
        <div style="font-size:16px;font-weight:700;color:#fca5a5;">🚨 Declare Business Continuity Incident</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Use this when a macro-level event has occurred and you need to coordinate response across an affected region.</div>
      </div>
      <button class="btn-ghost" onclick="App.closeModal()" aria-label="Close">✕</button>
    </div>
    <div id="bcp-form-body" style="flex:1;overflow-y:auto;padding:14px 18px;"></div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button id="bcp-declare-btn" class="btn-ghost" disabled style="background:rgba(248,113,113,.18);border-color:rgba(248,113,113,.5);color:#fca5a5;font-weight:700;">🚨 Declare</button>
    </div>
  </div>`;
}

export function bcpAvailableCountries() {
  // Union of:
  //   - COUNTRY_PRESENCE editorial seed (always-loaded; covers countries with
  //     no current data points — Brazil, Singapore, etc. — so operators can
  //     still declare BCI for them)
  //   - Live data sources (offices, travelers, remote employees) — these may
  //     surface countries the seed missed (e.g. a traveler in Iceland)
  // Filter out 'In transit' (a traveler value, not a real country).
  const set = new Set();
  COUNTRY_PRESENCE.forEach(c => set.add(c.name));
  OFFICES.forEach(o => set.add(o.country));
  state.TRAVELERS.forEach(t => t.country && set.add(t.country));
  state.REMOTE_EMPLOYEES.forEach(r => set.add(r.country));
  return Array.from(set).filter(c => c !== 'In transit').sort();
}

export function bcpExposureInScope() {
  const useFence = state.BCP_FORM.useFence && state.UI_STATE.fence;
  let offices, travelers, remote;
  if (useFence) {
    offices = OFFICES.filter(o => pointInFence(o.lat, o.lng));
    travelers = state.TRAVELERS.filter(t => pointInFence(t.lat, t.lng));
    // Remote employees have no lat/lng; geo-fence cannot include them.
    remote = [];
  } else {
    offices = OFFICES.filter(o => state.BCP_FORM.countries.includes(o.country));
    travelers = state.TRAVELERS.filter(t => state.BCP_FORM.countries.includes(t.country));
    remote = state.REMOTE_EMPLOYEES.filter(r => state.BCP_FORM.countries.includes(r.country));
  }
  const officeHeadcount = sumHeadcount(offices);   // safe with undefined headcounts
  return { offices, travelers, remote, officeHeadcount,
    travelerCount: travelers.length, remoteCount: remote.length,
    totalExposed: officeHeadcount + travelers.length + remote.length };
}

export function bcpAcledRiskHTML() {
  const header = `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Country Risk Profile <span style="text-transform:none;letter-spacing:0;">· ACLED · last 30 days</span></div>`;

  // Live + bare Pages: pending-integration placeholder
  if (!hasAcledRisk()) {
    return `${header}<div style="font-size:11px;color:var(--muted);font-style:italic;">Pending ACLED license &amp; integration. Vetted civil-unrest and conflict counts will populate here once ACLED is connected.</div>`;
  }

  // Mock mode + no country selected: empty-state hint with link to full modal
  if (state.BCP_FORM.countries.length === 0) {
    return `${header}<div style="font-size:11px;color:var(--muted);">Pick one or more countries above for a quick read, or <a href="#" id="bcp-open-risk" style="color:var(--green);">browse the full Risk Profile →</a></div>`;
  }

  const total = aggregateAcledRisk(state.BCP_FORM.countries);
  return `${header}
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;gap:14px;flex-wrap:wrap;">
      <span style="color:var(--text);">
        <b style="color:var(--text);font-size:16px;">${total.totalEvents.toLocaleString()}</b> violent events · <b style="color:#ef4444;font-size:16px;">${total.fatalities.toLocaleString()}</b> fatalities
        <span style="color:var(--muted);font-size:11px;">(across ${state.BCP_FORM.countries.length} ${state.BCP_FORM.countries.length===1?'country':'countries'})</span>
      </span>
      <a href="#" id="bcp-open-risk" style="color:var(--green);font-size:12px;white-space:nowrap;">View full Risk Profile →</a>
    </div>`;
}

export function bcpExposureSummaryHTML(exp) {
  const officeIds = exp.offices.length ? exp.offices.map(o => o.id).join(', ') : 'none';
  // Three independent integrations gate the people-impact math:
  //   office headcounts ← Workday  (per-office headcount field)
  //   travelers          ← Navan
  //   remote employees   ← Workday  (per-individual records)
  // When any of these is empty (live mode), show a "pending" placeholder
  // rather than a fake-zero count, so operators can tell "no integration"
  // from "the answer is zero".
  const hasHeadcounts = hasOfficeHeadcounts();
  const hasTravelers  = state.TRAVELERS.length > 0;
  const hasRemote     = state.REMOTE_EMPLOYEES.length > 0;
  return `
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Exposure in Scope</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;">
      <div><b style="color:var(--blue);font-size:18px;">${exp.offices.length}</b> office${exp.offices.length===1?'':'s'} <span style="color:var(--muted);font-size:11px;">(${esc(officeIds)})</span></div>
      ${hasHeadcounts
        ? `<div><b style="color:var(--green);font-size:18px;">${exp.officeHeadcount.toLocaleString()}</b> office headcount</div>`
        : `<div style="color:var(--muted);font-size:11px;font-style:italic;align-self:center;">Office headcount: awaiting Workday connection</div>`}
      ${hasTravelers
        ? `<div><b style="color:var(--yellow);font-size:18px;">${exp.travelerCount}</b> traveler${exp.travelerCount===1?'':'s'}</div>`
        : `<div style="color:var(--muted);font-size:11px;font-style:italic;align-self:center;">Travelers: awaiting Navan connection</div>`}
      ${hasRemote
        ? `<div><b style="color:#a855f7;font-size:18px;">${exp.remoteCount}</b> remote employee${exp.remoteCount===1?'':'s'}</div>`
        : `<div style="color:var(--muted);font-size:11px;font-style:italic;align-self:center;">Remote employees: awaiting Workday connection</div>`}
    </div>
    ${(hasHeadcounts || hasTravelers || hasRemote)
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:13px;">
          <b style="color:var(--text);font-size:16px;">${exp.totalExposed.toLocaleString()}</b> total exposed${(!hasHeadcounts || !hasTravelers || !hasRemote) ? ` <span style="color:var(--muted);font-size:11px;font-style:italic;">(partial — pending integrations above)</span>` : ''}
        </div>`
      : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);font-style:italic;">
          Total exposure unavailable — Workday + Navan integrations pending.
        </div>`}`;
}

export function bcpFormBodyHTML() {
  const countries = bcpAvailableCountries();
  const exp = bcpExposureInScope();
  const fenceAvailable = !!state.UI_STATE.fence;
  const useFenceNow = state.BCP_FORM.useFence && fenceAvailable;
  return `
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Event Type</label>
      <select id="bcp-event-type" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);">
        ${BCP_EVENT_TYPES.map(t => `<option value="${esc(t.id)}" ${t.id===state.BCP_FORM.eventTypeId?'selected':''}>${esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Event Title</label>
      <input id="bcp-title" type="text" placeholder="Concise headline operators will see" value="${esc(state.BCP_FORM.title)}"
        style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);" />
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Geographic Scope</label>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        ${fenceAvailable ? `<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;color:var(--text);">
          <input id="bcp-use-fence" type="checkbox" ${state.BCP_FORM.useFence?'checked':''} />
          Use the currently drawn geo-fence (overrides country picks)
        </label>` : ''}
        <button id="bcp-draw-fence" class="btn-ghost" style="font-size:11px;padding:4px 10px;border:1px dashed var(--border);">✏ ${fenceAvailable?'Redraw fence':'Draw fence on map'}</button>
        ${fenceAvailable ? `<button id="bcp-clear-fence" class="btn-ghost" style="font-size:11px;padding:4px 8px;color:var(--muted);">✕ Clear fence</button>` : ''}
      </div>
      <div id="bcp-country-list" style="display:flex;flex-wrap:wrap;gap:5px;${useFenceNow?'opacity:0.4;pointer-events:none;':''}">
        ${countries.map(c => `<button class="bcp-country-chip" data-country="${esc(c)}"
          style="padding:4px 10px;border:1px solid var(--border);border-radius:14px;background:${state.BCP_FORM.countries.includes(c)?'var(--green)':'var(--bg3)'};color:${state.BCP_FORM.countries.includes(c)?'#062c1f':'var(--text)'};font-size:11px;cursor:pointer;font-weight:${state.BCP_FORM.countries.includes(c)?'700':'400'};">${esc(c)}</button>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${bcpExposureSummaryHTML(exp)}
    </div>
    <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${bcpAcledRiskHTML()}
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Recommended Template</label>
      <select id="bcp-template" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);">
        ${
          // Pull all built-in templates from the BC + travel + check-in categories
          // so the new event-class BC variants (bc_announce_quake, _terror,
          // travel_advisory, etc.) show up here too. Grouped via optgroups.
          (() => {
            const bcCats = ['bc_announce','bc_checkin','bc_closure','travel','checkin'];
            const groups = bcCats.map(catId => {
              const cat = TEMPLATE_CATEGORIES.find(c => c.id === catId);
              const list = Object.entries(TEMPLATES)
                .filter(([_, t]) => t.category === catId)
                .map(([k, t]) => ({ id: k, name: t.name, priority: t.priority||99 }))
                .sort((a,b) => a.priority - b.priority);
              if (!list.length) return '';
              return `<optgroup label="${esc(cat.label)}">${
                list.map(t => `<option value="${esc(t.id)}" ${t.id===state.BCP_FORM.templateId?'selected':''}>${esc(t.name)}</option>`).join('')
              }</optgroup>`;
            }).join('');
            return groups;
          })()
        }
      </select>
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Additional Context (Optional)</label>
      <textarea id="bcp-message" rows="3" placeholder="Anything the templated message doesn't cover. Will be appended to the message body when sent."
        style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);font-family:inherit;resize:vertical;">${esc(state.BCP_FORM.customMessage)}</textarea>
    </div>
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer;padding:10px 12px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3);border-radius:4px;color:var(--text);">
      <input id="bcp-ack" type="checkbox" style="margin-top:2px;" ${state.BCP_FORM.acknowledged?'checked':''} />
      <span><b>I confirm this event meets BCI escalation threshold.</b> Declaring will create a Business Continuity Incident and pre-load Crisis Comms with the affected scope. No messages are sent until you click Send in the Crisis panel.</span>
    </label>`;
}

export function refreshBCPExposure() {
  const body = document.getElementById('bcp-form-body');
  if (body) body.innerHTML = bcpFormBodyHTML();
  bindBCPFormHandlers();
  updateBCPDeclareButton();
}

export function updateBCPDeclareButton() {
  const btn = document.getElementById('bcp-declare-btn'); if (!btn) return;
  const ok = state.BCP_FORM.acknowledged && state.BCP_FORM.title.trim().length > 0 &&
    (state.BCP_FORM.useFence ? !!state.UI_STATE.fence : state.BCP_FORM.countries.length > 0);
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '0.5';
  btn.style.cursor = ok ? 'pointer' : 'not-allowed';
}

export function bindBCPHandlers() {
  document.getElementById('bcp-declare-btn').addEventListener('click', declareBCP);
  refreshBCPExposure();
}

export function bindBCPFormHandlers() {
  document.getElementById('bcp-event-type').addEventListener('change', e => {
    state.BCP_FORM.eventTypeId = e.target.value;
    const t = BCP_EVENT_TYPES.find(x => x.id === state.BCP_FORM.eventTypeId);
    const titleInput = document.getElementById('bcp-title');
    if (t && t.titleHint && (!state.BCP_FORM.title || state.BCP_FORM.title.trim() === '' || BCP_EVENT_TYPES.some(x => x.titleHint && state.BCP_FORM.title === x.titleHint))) {
      titleInput.value = t.titleHint;
      state.BCP_FORM.title = t.titleHint;
    }
    updateBCPDeclareButton();
  });
  document.getElementById('bcp-title').addEventListener('input', e => {
    state.BCP_FORM.title = e.target.value;
    updateBCPDeclareButton();
  });
  const fenceChk = document.getElementById('bcp-use-fence');
  if (fenceChk) fenceChk.addEventListener('change', e => {
    state.BCP_FORM.useFence = e.target.checked;
    refreshBCPExposure();
  });
  const drawBtn = document.getElementById('bcp-draw-fence');
  if (drawBtn) drawBtn.addEventListener('click', () => {
    // Mark that we're waiting for a fence so the draw handler can reopen us.
    state.BCP_FORM._waitingForFence = true;
    closeModal();
    // Open Map Tools dropdown directly to the Geo-fence tab. Don't auto-pick
    // a shape — operator may want Circle, Rectangle, or Polygon.
    document.getElementById('tools-dropdown').classList.add('open');
    setMapToolsTab('fence');
    // Show floating cancel chip + auto-timeout so we don't get stuck waiting.
    showBCIWaitingChip();
    toast('Pick a shape and draw on the map. Click the chip top-center to cancel.');
  });
  const clearBtn = document.getElementById('bcp-clear-fence');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearFence();
    state.BCP_FORM.useFence = false;
    refreshBCPExposure();
  });
  document.querySelectorAll('.bcp-country-chip').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.country;
    if (state.BCP_FORM.countries.includes(c)) state.BCP_FORM.countries = state.BCP_FORM.countries.filter(x => x !== c);
    else state.BCP_FORM.countries.push(c);
    refreshBCPExposure();
  }));
  document.getElementById('bcp-template').addEventListener('change', e => { state.BCP_FORM.templateId = e.target.value; });
  document.getElementById('bcp-message').addEventListener('input', e => { state.BCP_FORM.customMessage = e.target.value; });
  document.getElementById('bcp-ack').addEventListener('change', e => {
    state.BCP_FORM.acknowledged = e.target.checked;
    updateBCPDeclareButton();
  });
  // "View full Risk Profile →" link in the compact BCI risk panel — opens
  // the standalone modal pre-populated with whatever countries are currently
  // selected. The modal is layered on top via showModal() (single-modal
  // architecture means closing the Risk modal will dismiss the BCI; that's
  // a known limitation we can revisit if it becomes annoying).
  const openRisk = document.getElementById('bcp-open-risk');
  if (openRisk) {
    openRisk.addEventListener('click', e => {
      e.preventDefault();
      showRiskProfileModal(state.BCP_FORM.countries);
    });
  }
}

export function declareBCP() {
  const exp = bcpExposureInScope();
  const evt = BCP_EVENT_TYPES.find(x => x.id === state.BCP_FORM.eventTypeId);
  const officeIds = exp.offices.map(o => o.id);
  const linkAlert = state.ALERTS.find(a =>
    SEV_RANK[a.sev] >= SEV_RANK.high && a.officeId && officeIds.includes(a.officeId));
  const description = `Business Continuity Incident declared by operator. Type: ${evt.label}. ` +
    `Scope: ${state.BCP_FORM.useFence ? 'drawn geo-fence' : state.BCP_FORM.countries.join(', ')}. ` +
    `Exposure at declaration: ${exp.officeHeadcount + exp.remoteCount} employees, ` +
    `${exp.travelerCount} travelers across ${exp.offices.length} office(s).`;
  const inc = createIncident({
    title: state.BCP_FORM.title, offices: officeIds, severity: 'ext',
    description, alertId: linkAlert?.id || null,
  });
  inc.bcp = true;
  inc.bcpEventType = evt.id;
  inc.bcpScope = state.BCP_FORM.useFence ? { type:'fence' } : { type:'countries', countries: state.BCP_FORM.countries.slice() };
  inc.bcpExposureSnapshot = {
    offices: exp.offices.length, officeHeadcount: exp.officeHeadcount,
    travelers: exp.travelerCount, remote: exp.remoteCount,
  };
  // Extend response tracking to include in-scope travelers (even those NOT
  // at any office) and remote employees. createIncident's buildResponseShells
  // only covers office-resident employees + travelers atOffice — for a BCI
  // we need the full in-scope population.
  if (!state.UI_STATE.responses[inc.id]) state.UI_STATE.responses[inc.id] = {};
  exp.travelers.forEach(t => {
    const key = 'T-' + t.id;
    if (!state.UI_STATE.responses[inc.id][key]) {
      state.UI_STATE.responses[inc.id][key] = { status:'no', when:null, by:null, traveler:true };
    }
  });
  exp.remote.forEach(r => {
    const key = 'R-' + r.id;
    if (!state.UI_STATE.responses[inc.id][key]) {
      state.UI_STATE.responses[inc.id][key] = { status:'no', when:null, by:null, remote:true };
    }
  });
  addIncidentLog(inc.id, 'create',
    `🚨 <b>BCI</b> declared: ${esc(evt.label)}. Exposure: ${exp.officeHeadcount + exp.remoteCount} employees · ${exp.travelerCount} travelers · ${exp.offices.length} office(s).`);
  state.UI_STATE.selectedOffices = officeIds.slice();
  state.UI_STATE.template = state.BCP_FORM.templateId;
  state.UI_STATE.subject = `[EXTREME · BCI] ${state.BCP_FORM.title}`;
  // Only overwrite the Crisis Comm draft if the BCI form contributed context.
  // If BCI message is empty, preserve whatever the operator was already drafting.
  if (state.BCP_FORM.customMessage && state.BCP_FORM.customMessage.trim()) {
    state.UI_STATE.customMessage = state.BCP_FORM.customMessage;
  }
  state.UI_STATE.linkedIncidentId = inc.id;
  closeModal();
  openPanel('crisis');
  setCcTab('compose');
  renderCC();
  renderIncidents();
  toast(`🚨 BCI declared: ${state.BCP_FORM.title}. ${exp.totalExposed.toLocaleString()} recipients staged.`);
}

export function showRiskProfileModal(prefilledCountries) {
  state.RISK_VIEW.selected = Array.isArray(prefilledCountries) ? prefilledCountries.slice() : [];
  state.RISK_VIEW.search = '';
  state.RISK_VIEW.regionFilter = 'all';
  showModal(riskModalHTML());
  bindRiskModalHandlers();
}

export function riskCountryList() {
  // Build a name → entry map starting from COUNTRY_PRESENCE
  const byName = new Map();
  for (const cp of COUNTRY_PRESENCE) {
    byName.set(cp.name, { name: cp.name, region: cp.region, total: 0, fatalities: 0, hasAcled: false });
  }
  // Overlay ACLED data when available
  for (const [name, r] of Object.entries(state.ACLED_RISK)) {
    const total = (r.battles||0) + (r.vac||0) + (r.explosions||0) + (r.riots||0) + (r.strategicDev||0);
    const existing = byName.get(name);
    if (existing) {
      existing.total = total;
      existing.fatalities = r.fatalities || 0;
      existing.hasAcled = true;
    } else {
      // ACLED has data for a country not in COUNTRY_PRESENCE — surface it anyway
      // (e.g. Ukraine, Yemen — not necessarily NR-presence countries but
      // operationally relevant for traveler safety / BCI scope).
      byName.set(name, { name, region: '—', total, fatalities: r.fatalities || 0, hasAcled: true });
    }
  }
  const all = Array.from(byName.values());
  const filtered = all.filter(c => {
    if (state.RISK_VIEW.regionFilter !== 'all' && c.region !== state.RISK_VIEW.regionFilter) return false;
    if (state.RISK_VIEW.search && !c.name.toLowerCase().includes(state.RISK_VIEW.search.toLowerCase())) return false;
    return true;
  });
  filtered.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return filtered;
}

export function riskLiveHazardsHTML() {
  if (state.RISK_VIEW.selected.length === 0) return '';
  const h = liveHazardsAggregated(state.RISK_VIEW.selected);
  const outbreaks = outbreaksAggregated(state.RISK_VIEW.selected);
  const header = `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Live Hazards <span style="text-transform:none;letter-spacing:0;">· current · from active alert pipeline + WHO</span></div>`;

  // Quiet state — nothing active in the selected scope
  if (h.total === 0 && !h.travelAdvisoryLevel && outbreaks.length === 0) {
    return `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${header}
      <div style="font-size:12px;color:var(--muted);font-style:italic;">No active hazards detected in the selected ${state.RISK_VIEW.selected.length===1?'country':'countries'}. The alert pipeline will refresh as new events come in.</div>
    </div>`;
  }

  // Build the visible rows — only show categories with non-zero counts,
  // plus the advisory level if elevated above L1.
  const rows = [];
  if (h.travelAdvisoryLevel) {
    const ADVISORY_TEXT = { L1: 'Exercise Normal Precautions', L2: 'Exercise Increased Caution', L3: 'Reconsider Travel', L4: 'Do Not Travel' };
    const ADVISORY_COLOR = { L1: 'var(--muted)', L2: '#facc15', L3: '#fb923c', L4: '#ef4444' };
    rows.push(`<div style="font-size:13px;display:flex;align-items:center;gap:8px;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ADVISORY_COLOR[h.travelAdvisoryLevel]};"></span>
      <span style="color:var(--text);"><b>Travel Advisory: ${h.travelAdvisoryLevel}</b> · ${ADVISORY_TEXT[h.travelAdvisoryLevel]}</span>
      <span style="color:var(--muted);font-size:11px;">State Dept</span>
    </div>`);
  }
  if (h.earthquakes)   rows.push(`<div style="font-size:13px;">🌍 <b>${h.earthquakes}</b> recent earthquake${h.earthquakes===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· USGS / EMSC</span></div>`);
  if (h.severeWeather) rows.push(`<div style="font-size:13px;">🌪 <b>${h.severeWeather}</b> severe weather warning${h.severeWeather===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· NWS / MeteoAlarm</span></div>`);
  if (h.gdacsActive)   rows.push(`<div style="font-size:13px;">🚨 <b>${h.gdacsActive}</b> GDACS Orange/Red event${h.gdacsActive===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· global disaster coordination</span></div>`);
  if (h.wildfires)     rows.push(`<div style="font-size:13px;">🔥 <b>${h.wildfires}</b> wildfire${h.wildfires===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· EONET / NWS</span></div>`);
  if (h.volcanoes)     rows.push(`<div style="font-size:13px;">🌋 <b>${h.volcanoes}</b> volcanic event${h.volcanoes===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· EONET</span></div>`);
  if (h.civilUnrest)   rows.push(`<div style="font-size:13px;">⚠️ <b>${h.civilUnrest}</b> civil unrest event${h.civilUnrest===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· live feed</span></div>`);
  if (h.publicSafety)  rows.push(`<div style="font-size:13px;">🚓 <b>${h.publicSafety}</b> public safety incident${h.publicSafety===1?'':'s'}</div>`);
  // WHO Disease Outbreak News — show one row summarizing diseases. The
  // detail (per-country, with cases / since dates) is below the rollup
  // for operators who want to read the WHO source. Rendered only when
  // outbreaks exist for the selected countries.
  if (outbreaks.length > 0) {
    const diseases = [...new Set(outbreaks.map(o => o.disease))];
    const SEV_RANK_LOCAL = { low: 1, mod: 2, high: 3, ext: 4 };
    const maxSev = outbreaks.reduce((max, o) => SEV_RANK_LOCAL[o.severity] > SEV_RANK_LOCAL[max] ? o.severity : max, 'low');
    const maxColor = maxSev === 'ext' ? '#ef4444' : maxSev === 'high' ? '#fb923c' : maxSev === 'mod' ? '#facc15' : 'var(--muted)';
    rows.push(`<div style="font-size:13px;">🦠 <b style="color:${maxColor};">${outbreaks.length}</b> active disease outbreak${outbreaks.length===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· ${esc(diseases.join(', '))} · WHO</span></div>`);
  }

  // Optional WHO outbreak detail block — only shown if outbreaks exist;
  // gives the operator the per-country, per-disease breakdown with WHO
  // source links. Compact list, scrollable if it grows.
  const outbreakDetail = outbreaks.length === 0 ? '' : `
    <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">WHO Outbreak Detail</div>
      ${outbreaks.map(o => {
        const sevDot = o.severity === 'ext' ? '#ef4444' : o.severity === 'high' ? '#fb923c' : o.severity === 'mod' ? '#facc15' : 'var(--muted)';
        const cases = o.cases ? ` · ${o.cases.toLocaleString()} cases` : '';
        return `<div style="font-size:12px;padding:3px 0;display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sevDot};flex-shrink:0;"></span>
          <span style="color:var(--text);"><b>${esc(o.country)}</b> · ${esc(o.disease)}</span>
          <span style="color:var(--muted);font-size:11px;">since ${esc(o.since)}${cases}</span>
          <a href="${esc(o.link)}" target="_blank" rel="noopener" style="color:var(--green);font-size:11px;margin-left:auto;">WHO ↗</a>
        </div>`;
      }).join('')}
    </div>`;

  return `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
    ${header}
    <div style="display:flex;flex-direction:column;gap:6px;">${rows.join('')}</div>
    ${outbreakDetail}
  </div>`;
}

export function riskModalHTML() {
  const countries = riskCountryList();
  const totalAvailable = countries.length;   // total countries in the picker (presence ∪ ACLED)
  const selectedCount = state.RISK_VIEW.selected.length;
  const aclLoaded = hasAcledRisk();
  const aggregated = (selectedCount > 0 && aclLoaded) ? aggregateAcledRisk(state.RISK_VIEW.selected) : null;

  const regionChip = (id, label) => `<button data-risk-region="${id}" style="padding:5px 11px;background:${id===state.RISK_VIEW.regionFilter?'var(--green)':'var(--bg3)'};color:${id===state.RISK_VIEW.regionFilter?'#062c1f':'var(--text)'};border:0;border-radius:14px;font-size:11px;cursor:pointer;font-weight:${id===state.RISK_VIEW.regionFilter?'700':'400'};">${esc(label)}</button>`;

  // ACLED aggregated panel — three states:
  //   1. ACLED data present + countries selected: full counts + breakdown
  //   2. ACLED data present + nothing selected: empty hint
  //   3. ACLED not loaded (live + bare Pages): pending placeholder with note
  //      that Live Hazards above still works
  const aclHeader = `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">ACLED Historical Context <span style="text-transform:none;letter-spacing:0;">· last 30 days</span></div>`;
  let aggregatedPanel;
  if (!aclLoaded) {
    aggregatedPanel = `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${aclHeader}
      <div style="font-size:12px;color:var(--muted);font-style:italic;">Pending ACLED license &amp; integration. Vetted civil-unrest and conflict counts (battles, violence-against-civilians, explosions, riots, strategic developments) will populate here once ACLED is connected. Live Hazards above pulls from the active alert pipeline regardless.</div>
    </div>`;
  } else if (aggregated) {
    aggregatedPanel = `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${aclHeader}
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;">
        <div><b style="color:#ef4444;font-size:18px;">${aggregated.battles}</b> battles</div>
        <div><b style="color:#f87171;font-size:18px;">${aggregated.vac}</b> VAC</div>
        <div><b style="color:#fb923c;font-size:18px;">${aggregated.explosions}</b> explosions</div>
        <div><b style="color:#facc15;font-size:18px;">${aggregated.riots}</b> riots</div>
        <div><b style="color:#a3a3a3;font-size:18px;">${aggregated.strategicDev}</b> strategic dev</div>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:13px;display:flex;justify-content:space-between;align-items:baseline;">
        <span><b style="color:var(--text);font-size:16px;">${aggregated.totalEvents.toLocaleString()}</b> violent events</span>
        <span><b style="color:#ef4444;font-size:16px;">${aggregated.fatalities.toLocaleString()}</b> fatalities reported</span>
      </div>
      ${selectedCount > 1 ? `<div style="margin-top:8px;">${
        state.RISK_VIEW.selected.map(c => {
          const r = state.ACLED_RISK[c] || { battles:0, vac:0, explosions:0, riots:0, strategicDev:0, fatalities:0 };
          const events = r.battles + r.vac + r.explosions + r.riots + r.strategicDev;
          return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-top:1px solid var(--border);">
            <span style="color:var(--text);">${esc(c)}</span>
            <span style="color:var(--muted);">${events} events · ${r.fatalities} fatalities</span>
          </div>`;
        }).join('')
      }</div>` : ''}
    </div>`;
  } else {
    aggregatedPanel = `<div style="margin:14px 18px 0 18px;padding:14px 18px;color:var(--muted);font-size:12px;font-style:italic;text-align:center;background:var(--bg3);border:1px dashed var(--border);border-radius:4px;">
      Click one or more country chips below to see aggregated ACLED counts.
    </div>`;
  }

  const chipGrid = countries.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;">No countries match the filter.</div>`
    : `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 18px;">${
        countries.map(c => {
          const isSel = state.RISK_VIEW.selected.includes(c.name);
          const heat = c.total >= 100 ? '#ef4444' : c.total >= 30 ? '#f59e0b' : c.total >= 5 ? '#a3a3a3' : '#525252';
          // Show ACLED count badge only when data is available — in live mode
          // c.hasAcled is false and a "0" badge would mislead the operator into
          // thinking the country had zero events instead of "no ACLED data yet".
          const badge = c.hasAcled
            ? `<span style="background:${isSel?'rgba(0,0,0,0.18)':heat};color:${isSel?'#062c1f':'#fff'};border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700;">${c.total}</span>`
            : '';
          return `<button class="risk-country-chip" data-country="${esc(c.name)}"
            style="padding:5px 10px;border:1px solid ${isSel?'var(--green)':'var(--border)'};border-radius:14px;background:${isSel?'var(--green)':'var(--bg3)'};color:${isSel?'#062c1f':'var(--text)'};font-size:11px;cursor:pointer;font-weight:${isSel?'700':'500'};display:inline-flex;align-items:center;gap:6px;">
            <span>${esc(c.name)}</span>${badge}
          </button>`;
        }).join('')
      }</div>`;

  return `<div style="width:min(720px,92vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:16px;font-weight:700;">🌐 Country Risk Profile <span style="font-weight:400;color:var(--muted);font-size:13px;">· last 30 days · ACLED</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Vetted civil-unrest and conflict counts. Note: ACLED has a typical 5-14 day publication lag — this is contextual baseline, not real-time detection.</div>
      </div>
      <button class="btn-ghost" onclick="App.closeModal()" aria-label="Close">✕</button>
    </div>
    <div style="display:flex;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap;">
      <input id="risk-search" type="text" placeholder="Search country..." value="${esc(state.RISK_VIEW.search)}"
        style="flex:1;min-width:180px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);font-size:12px;" />
      <div style="display:flex;gap:4px;">
        ${regionChip('all','All')}${regionChip('Americas','Americas')}${regionChip('EMEA','EMEA')}${regionChip('APAC','APAC')}
      </div>
      <div style="font-size:11px;color:var(--muted);">${countries.length} of ${totalAvailable} countries</div>
    </div>
    ${riskLiveHazardsHTML()}
    ${aggregatedPanel}
    <div style="padding:12px 0 0 0;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-left:18px;">
      Countries by event count · click to add/remove
    </div>
    <div id="risk-chip-body" style="flex:1;overflow-y:auto;padding:10px 0 16px 0;">
      ${chipGrid}
    </div>
  </div>`;
}

export function bindRiskModalHandlers() {
  const search = document.getElementById('risk-search');
  if (search) {
    search.addEventListener('input', e => {
      state.RISK_VIEW.search = e.target.value;
      // Debounce the re-render — typing fast shouldn't rebuild the modal
      // on every keystroke. 150ms after the last keystroke avoids 3-4
      // unnecessary HTML regenerations while typing a normal word.
      if (_riskSearchDebounce) clearTimeout(_riskSearchDebounce);
      _riskSearchDebounce = setTimeout(() => {
        _riskSearchDebounce = null;
        const back = document.getElementById('modal-back');
        if (back) back.querySelector('.modal').innerHTML = riskModalHTML();
        bindRiskModalHandlers();
        // Restore focus + caret position after the re-render replaces the input
        const s = document.getElementById('risk-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 150);
    });
  }
  document.querySelectorAll('[data-risk-region]').forEach(b => b.addEventListener('click', () => {
    state.RISK_VIEW.regionFilter = b.dataset.riskRegion;
    const back = document.getElementById('modal-back');
    if (back) back.querySelector('.modal').innerHTML = riskModalHTML();
    bindRiskModalHandlers();
  }));
  document.querySelectorAll('.risk-country-chip').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.country;
    if (state.RISK_VIEW.selected.includes(c)) state.RISK_VIEW.selected = state.RISK_VIEW.selected.filter(x => x !== c);
    else state.RISK_VIEW.selected.push(c);
    const back = document.getElementById('modal-back');
    if (back) back.querySelector('.modal').innerHTML = riskModalHTML();
    bindRiskModalHandlers();
  }));
}

