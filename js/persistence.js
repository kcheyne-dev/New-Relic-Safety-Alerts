/**
 * NRSA / S.T.A.R. View — persistence + report-export functions.
 *
 * SESSION 3 / step 8 (2026-06-19): extracted from legacy-app.js. Three
 * categories of functionality co-located here because they all serialize
 * STATE in some form:
 *
 *   - localStorage persistence: buildPersistPayload, saveState (debounced),
 *     loadState (called once at boot), exportData (download as JSON),
 *     resetData (clear localStorage + reload).
 *   - Alert details report: showAlertDetails opens a new browser tab with
 *     the alert serialized as a printable HTML page (severity + summary +
 *     impact + related alerts + Google Maps link).
 *   - Incident report: exportIncidentReport opens a new tab with a full
 *     printable incident report (~300 lines of HTML template). Used as the
 *     post-incident artifact for stakeholder reporting.
 *
 * BRIDGE RELIANCE:
 *   - Reads STATE.incidents, STATE.responses, STATE.crisisLog via window
 *     (bridged from state.js).
 *   - Reads ALERTS, TRAVELERS, REMOTE_EMPLOYEES via window (state bridge).
 *   - Reads OFFICE_BY_ID, SEV_COLOR, SEV_NAME, SOURCES via window (constants
 *     bridge from constants.js).
 *   - Calls helpers (esc, linkify, fmtSize, fmtHeadcount, sumHeadcount,
 *     stripAtt, stripIncident, stripMessageAtts) via window (helpers bridge).
 *   - Calls toast and (rarely) closeModal via window (legacy-app.js function
 *     declarations are global on classic scripts).
 *
 * The save flow on every state mutation:
 *   STATE.X = newValue  →  saveState()  →  setTimeout(_saveTimer, 500ms)
 *   →  buildPersistPayload()  →  localStorage.setItem(PERSIST_KEY, json)
 *
 * The load flow on boot:
 *   loadState()  →  localStorage.getItem(PERSIST_KEY)  →  Object.assign(STATE, ...)
 *   →  rehydrate incidents/responses/customLocations/etc.
 */

// Bridge-cleanup persistence.js hygiene (2026-07-13): expanded from the
// original two imports (PERSIST_*) to include every constant the module
// reads. No ESLint globals trim earned here — all of SEV_RANK / SEV_NAME /
// SEV_COLOR / SOURCES / OFFICE_BY_ID have legacy-app.js bare users so they
// stay in globals. Value: typo protection and dependency clarity — a typo
// like `SEV_NAM` now fires no-undef inside persistence.js immediately.
import {
  OFFICE_BY_ID,
  PERSIST_KEY,
  PERSIST_DEBOUNCE_MS,
  SEV_COLOR,
  SEV_NAME,
  SEV_RANK,
  SOURCES,
} from './constants.js';

export function showAlertDetails(id) {
  const a = ALERTS.find(x => x.id === id); if (!a) return;
  const o = a.officeId ? OFFICE_BY_ID[a.officeId] : null;
  const ageMin = Math.floor((Date.now() - new Date(a.issued).getTime())/60000);
  const stale = ageMin > 4320 || (SEV_RANK[a.sev]<=1 && ageMin>1440);
  const src = SOURCES.find(s => s.id === a.source) || { name:a.source, status:'ok' };
  const visitors = o ? travelersAtOffice(o.id).length : 0;
  const sevColor = SEV_COLOR[a.sev];
  const related = ALERTS.filter(x => x.id !== a.id &&
    (x.officeId === a.officeId || x.type === a.type) &&
    Math.abs(new Date(x.issued)-new Date(a.issued)) < 6*3600*1000).slice(0,4);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Alert ${a.id} — ${a.title}</title>
<style>
  body { margin:0; background:#18181b; color:#e4e4e7; font-family:-apple-system,system-ui,sans-serif; padding:32px; max-width:780px; }
  h1 { font-size:22px; margin:0 0 6px 0; line-height:1.3; }
  .sub { color:#a1a1aa; font-size:13px; margin-bottom:18px; }
  .sev { display:inline-block; padding:3px 10px; border-radius:4px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; background:${sevColor}22; color:${sevColor}; border:1px solid ${sevColor}; }
  .summary { background:#27272a; border:1px solid #3f3f46; border-left:4px solid ${sevColor}; border-radius:6px; padding:14px 16px; font-size:14px; line-height:1.6; margin-bottom:20px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { padding:8px 12px; text-align:left; border-bottom:1px solid #3f3f46; }
  th { color:#a1a1aa; font-weight:500; width:160px; }
  .stale { color:#facc15; }
  .src-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-left:4px; vertical-align:middle; background:${src.status==='ok'?'#1ce783':src.status==='stale'?'#facc15':'#f87171'}; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#1ce783; margin:24px 0 8px 0; }
  .related { display:flex; flex-direction:column; gap:6px; }
  .rel { background:#27272a; border:1px solid #3f3f46; border-radius:5px; padding:8px 12px; font-size:12px; }
  .rel-title { font-weight:600; }
  .rel-meta { color:#a1a1aa; font-size:11px; margin-top:3px; }
  a { color:#1e90ff; text-decoration:none; }
  a:hover { text-decoration:underline; }
  .nav { background:#27272a; border:1px solid #3f3f46; border-radius:6px; padding:10px 14px; margin-bottom:24px; font-size:12px; display:flex; justify-content:space-between; align-items:center; }
  @media print { body { background:#fff; color:#000; } .summary,.rel,.nav,th,td { background:#fff; color:#000; border-color:#ccc; } }
</style></head><body>
  <div class="nav">
    <span><b>NR Safety Alerts</b> · Alert ${a.id}</span>
    <span><a href="${location.href.split('#')[0]}" target="_top">← Back to dashboard</a> · <a href="#" onclick="window.print();return false;">Print</a> · <a href="#" onclick="navigator.clipboard.writeText(location.href);return false;">Copy Link</a></span>
  </div>

  <span class="sev">${SEV_NAME[a.sev]}</span>
  <h1 style="margin-top:8px">${a.title}</h1>
  <div class="sub">${a.type} · ${a.source} · ${stale?'<span class="stale">⚠ stale · </span>':''}issued ${relTime(a.issued)} ago</div>

  <div class="summary">${a.summary}</div>

  <h2>Details</h2>
  <table>
    <tr><th>Severity</th><td><span class="sev">${SEV_NAME[a.sev]}</span></td></tr>
    <tr><th>Type</th><td>${a.type}</td></tr>
    <tr><th>Source</th><td>${src.url ? `<a href="${src.url}" target="_blank" rel="noopener"><b>${a.source}</b></a>` : `<b>${a.source}</b>`} — ${src.name} <span class="src-dot"></span> <span style="font-size:11px;color:#a1a1aa">${src.status}</span>${src.url ? ` <a href="${src.url}" target="_blank" rel="noopener" style="margin-left:8px;font-size:11px">View at source ↗</a>` : ''}${a.sourceUrl ? ` · <a href="${a.sourceUrl}" target="_blank" rel="noopener" style="font-size:11px">View this alert ↗</a>` : ''}</td></tr>
    <tr><th>Location</th><td>${a.location}</td></tr>
    <tr><th>Coordinates</th><td>${a.lat.toFixed(4)}, ${a.lng.toFixed(4)} <a href="https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}" target="_blank" style="margin-left:8px;font-size:11px">View on Google Maps ↗</a></td></tr>
    <tr><th>Impact radius</th><td>${a.radiusKm ? a.radiusKm + ' km' : '—'}</td></tr>
    <tr><th>Issued</th><td>${new Date(a.issued).toLocaleString()} <span style="color:#a1a1aa">(${relTime(a.issued)} ago)</span></td></tr>
    <tr><th>Affected office</th><td>${o ? `<b>${o.id} · ${o.name}</b>, ${o.country}${o.headcount!=null?` — ${fmtHeadcount(o.headcount)} employees`:' — <span style="font-style:italic;color:#a1a1aa">headcount pending Workday integration</span>'}<br><span style="color:#a1a1aa;font-size:11px">${o.address}</span>` : '<span style="color:#a1a1aa">— regional / travel-only</span>'}</td></tr>
    ${o?`<tr><th>Visiting travelers</th><td>${visitors} ✈</td></tr>`:''}
    <tr><th>Alert ID</th><td><code style="font-family:monospace;font-size:11px">${a.id}</code></td></tr>
  </table>

  ${related.length ? `<h2>Related alerts</h2><div class="related">${related.map(r => `
    <div class="rel" style="border-left:3px solid ${SEV_COLOR[r.sev]}">
      <div class="rel-title">${r.title}</div>
      <div class="rel-meta"><span class="sev" style="font-size:9px;padding:1px 5px;background:${SEV_COLOR[r.sev]}22;color:${SEV_COLOR[r.sev]};border-color:${SEV_COLOR[r.sev]}">${SEV_NAME[r.sev]}</span> ${r.source} · ${r.location} · ${relTime(r.issued)} ago</div>
    </div>`).join('')}</div>` : ''}

  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:24px">
    <a href="${location.href.split('#')[0]}#alert/${esc(a.id)}" target="_top" style="background:#27272a;border:1px solid #3f3f46;color:#e4e4e7;border-radius:5px;padding:6px 12px;text-decoration:none;font-size:12px">📍 Show on dashboard</a>
    ${o?`<a href="${location.href.split('#')[0]}#open-incident/${esc(a.id)}" target="_top" style="background:rgba(248,113,113,.12);border:1px solid #f87171;color:#f87171;border-radius:5px;padding:6px 12px;text-decoration:none;font-size:12px">🚨 Open incident from this alert</a>`:''}
  </div>

  <div style="margin-top:32px;color:#a1a1aa;font-size:11px;border-top:1px solid #3f3f46;padding-top:14px">
    NR Safety Alerts · This page is a static snapshot. Data is regenerated on every dashboard load.
  </div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blocked. Allow pop-ups for this site to view details.'); return; }
  w.document.write(html);
  w.document.close();
  w.document.title = `Alert ${a.id} — ${a.title}`;
}

export function exportIncidentReport(incidentId) {
  const inc = STATE.incidents.find(x => x.id === incidentId); if (!inc) return;
  const resp = STATE.responses[inc.id] || {};
  const rs = Object.values(resp);
  const ok = rs.filter(r=>r.status==='ok').length;
  const help = rs.filter(r=>r.status==='help').length;
  const no = rs.filter(r=>r.status==='no').length;
  const total = rs.length;
  const pct = total ? Math.round(((ok+help)/total)*100) : 0;
  const offices = inc.offices.map(id => OFFICE_BY_ID[id]).filter(Boolean);
  const sev = SEV_NAME[inc.severity];
  const sevColor = SEV_COLOR[inc.severity];
  const opened = new Date(inc.opened).toLocaleString();
  const closed = inc.closedAt ? new Date(inc.closedAt).toLocaleString() : null;
  const messages = (inc.messages||[]).slice().sort((a,b)=>new Date(a.when)-new Date(b.when));
  const log = (inc.log||[]).slice();
  const notes = (inc.notes||[]).slice().sort((a,b)=>new Date(a.when)-new Date(b.when));
  // Originating alert (if incident was opened from one)
  const origAlert = inc.alertId ? ALERTS.find(x => x.id === inc.alertId) : null;
  const origSrc = origAlert ? (SOURCES.find(s => s.id === origAlert.source) || { name: origAlert.source }) : null;
  // Dashboard permalink (deep link back to this incident)
  const dashRoot = location.href.split('#')[0];
  const dashLink = `${dashRoot}#incident/${inc.id}`;

  // Related alerts: any active alert in any affected office (excluding origAlert which has its own section)
  const relatedAlerts = ALERTS.filter(a =>
    a.officeId && inc.offices.includes(a.officeId) &&
    (!origAlert || a.id !== origAlert.id)
  );

  // build per-office response table
  const employeeRows = []; const travelerRows = []; const remoteRows = [];
  Object.entries(resp).forEach(([eid, r]) => {
    if (r.traveler) {
      const t = TRAVELERS.find(x => 'T-'+x.id === eid);
      if (t) travelerRows.push({ name: t.name, who: `${OFFICE_BY_ID[t.home]?.name||t.home} → ${t.destCity}`, status: r.status, when: r.when, by: r.by });
    } else if (r.remote) {
      const re = REMOTE_EMPLOYEES.find(x => 'R-'+x.id === eid);
      if (re) remoteRows.push({ name: re.name, who: `${re.city}, ${re.country} (remote)`, status: r.status, when: r.when, by: r.by });
    } else {
      const e = EMPLOYEES.find(x => x.id === eid);
      if (e) employeeRows.push({ name: e.name, who: `${OFFICE_BY_ID[e.office]?.name||e.office} · ${e.role||'—'}`, status: r.status, when: r.when, by: r.by });
    }
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Incident Report — ${esc(inc.title)}</title>
<style>
  body { margin:0; background:#fff; color:#18181b; font-family:-apple-system,system-ui,sans-serif; padding:32px; max-width:900px; }
  h1 { font-size:24px; margin:6px 0 8px 0; line-height:1.3; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:#1ce783; margin:28px 0 8px 0; padding-bottom:6px; border-bottom:1px solid #d4d4d8; }
  .sev { display:inline-block; padding:3px 10px; border-radius:4px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; background:${sevColor}22; color:${sevColor}; border:1px solid ${sevColor}; }
  .meta-bar { display:flex; gap:16px; flex-wrap:wrap; color:#52525b; font-size:12px; margin-bottom:18px; padding-bottom:12px; border-bottom:2px solid ${sevColor}; }
  .summary { background:#fafafa; border:1px solid #d4d4d8; border-left:4px solid ${sevColor}; border-radius:4px; padding:14px 16px; font-size:13px; line-height:1.6; margin-bottom:8px; }
  .closure { background:#fef2f2; border:1px solid #fecaca; border-left:4px solid #dc2626; border-radius:4px; padding:12px 14px; font-size:13px; line-height:1.5; margin-top:12px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { color:#52525b; font-weight:600; text-align:left; padding:6px 10px; border-bottom:2px solid #d4d4d8; }
  td { padding:6px 10px; border-bottom:1px solid #e4e4e7; vertical-align:top; }
  .tally-row { display:flex; gap:10px; margin:10px 0; }
  .tally-cell { flex:1; background:#fafafa; border:1px solid #d4d4d8; border-radius:5px; padding:10px; text-align:center; }
  .tally-cell .n { font-weight:800; font-size:22px; }
  .tally-cell .l { font-size:11px; color:#52525b; text-transform:uppercase; letter-spacing:.05em; }
  .tally-cell.ok .n { color:#16a34a; } .tally-cell.help .n { color:#dc2626; } .tally-cell.no .n { color:#71717a; }
  .progress-bar { height:6px; background:#e4e4e7; border-radius:3px; overflow:hidden; margin-top:6px; }
  .progress-bar > span { display:block; height:100%; background:#16a34a; }
  .msg-block { background:#fafafa; border:1px solid #d4d4d8; border-left:4px solid ${sevColor}; border-radius:4px; padding:12px 14px; margin-bottom:10px; }
  .msg-step { font-size:11px; font-weight:700; color:#1ce783; text-transform:uppercase; letter-spacing:.06em; }
  .msg-when { font-size:11px; color:#71717a; }
  .msg-subject { font-size:13px; font-weight:700; margin:4px 0; }
  .msg-body { font-size:12px; line-height:1.5; color:#27272a; white-space:pre-wrap; margin-top:6px; }
  .pill { display:inline-block; background:#fff; border:1px solid #d4d4d8; padding:2px 8px; border-radius:10px; font-size:10px; color:#52525b; margin-right:4px; }
  .log { background:#fafafa; border:1px solid #d4d4d8; border-radius:4px; padding:8px 12px; font-size:11px; }
  .log-row { padding:6px 0; border-bottom:1px dotted #d4d4d8; }
  .log-row:last-child { border-bottom:0; }
  .log-when { color:#71717a; font-size:10px; }
  .nav { background:#fafafa; border:1px solid #d4d4d8; border-radius:5px; padding:10px 14px; margin-bottom:18px; font-size:12px; display:flex; justify-content:space-between; align-items:center; }
  .nav a { color:#1e90ff; text-decoration:none; margin-left:12px; }
  .nav a:hover { text-decoration:underline; }
  .status-ok { color:#16a34a; font-weight:700; }
  .status-help { color:#dc2626; font-weight:700; }
  .status-no { color:#71717a; }
  .footer { margin-top:36px; padding-top:14px; border-top:1px solid #d4d4d8; font-size:11px; color:#71717a; }
  .facts-table th { width:170px; vertical-align:top; }
  .facts-table td { vertical-align:top; }
  .facts-table code { font-family:ui-monospace,monospace; font-size:11px; background:#f4f4f5; padding:1px 5px; border-radius:3px; }
  @media print { .nav, .no-print { display:none; } body { padding:14px; } }
</style></head><body>
  <div class="nav no-print">
    <span><b>NR Safety Alerts · CMT Dashboard</b> — Incident Report · <code style="font-size:11px;color:#52525b">${esc(inc.id)}</code></span>
    <span>
      <a href="#" onclick="window.print();return false;">🖨 Print</a>
      <a href="#" onclick="downloadJSON();return false;">⬇ JSON</a>
      <a href="#" onclick="navigator.clipboard.writeText('${dashLink}');this.textContent='✓ Copied';return false;">🔗 Copy link</a>
      <a href="${dashLink}" target="_top">← Open in dashboard</a>
    </span>
  </div>

  <span class="sev">${sev}</span>
  <h1>${esc(inc.title)}</h1>
  <div class="meta-bar">
    <span><b>Status:</b> ${inc.status}</span>
    <span><b>Opened:</b> ${opened}</span>
    ${closed?`<span><b>Closed:</b> ${closed}</span>`:''}
    <span><b>Offices:</b> ${esc(inc.offices.join(', '))}</span>
    <span><b>Incident ID:</b> <code>${esc(inc.id)}</code></span>
    ${inc.reopens?.length?`<span><b>Reopened:</b> ${inc.reopens.length}×</span>`:''}
  </div>

  <h2>Incident Summary</h2>
  <table class="facts-table">
    <tr><th>Title</th><td>${esc(inc.title)}</td></tr>
    <tr><th>Severity</th><td><span class="sev">${sev}</span></td></tr>
    <tr><th>Status</th><td>${inc.status}${inc.status==='closed'?` (closed ${closed})`:''}</td></tr>
    <tr><th>Opened</th><td>${opened}${closed?` · duration: ${(() => {
      const ms = new Date(inc.closedAt) - new Date(inc.opened);
      const hrs = Math.floor(ms/3600000); const min = Math.floor((ms%3600000)/60000);
      return `${hrs}h ${min}m`;
    })()}`:''}</td></tr>
    ${inc.reopens?.length?`<tr><th>Reopened</th><td>${inc.reopens.length}× — last ${new Date(inc.reopens[inc.reopens.length-1].when).toLocaleString()}</td></tr>`:''}
    <tr><th>Affected offices</th><td>${offices.map(o => `${o.id} · ${esc(o.name)}`).join(', ')||'—'}</td></tr>
    <tr><th>Total headcount</th><td>${hasOfficeHeadcounts() ? `${sumHeadcount(offices).toLocaleString()} employees` : '<span style="font-style:italic;color:#a1a1aa">pending Workday integration</span>'}</td></tr>
    <tr><th>Messages sent</th><td>${messages.length}${messages.length?` · last ${relTime(messages[messages.length-1].when)} ago`:''}</td></tr>
    <tr><th>Response tracking</th><td>${total ? `${ok} OK · ${help} need help · ${no} no response (${pct}% responded)` : 'No tracked responses'}</td></tr>
    <tr><th>Notes recorded</th><td>${notes.length}</td></tr>
    <tr><th>Activity log entries</th><td>${log.length}</td></tr>
    <tr><th>Originating source</th><td>${origAlert
      ? `Alert <code>${esc(origAlert.id)}</code> — ${esc(origAlert.title)}`
      : 'Manually created'}</td></tr>
    ${origAlert ? `<tr><th>Source feed</th><td><b>${esc(origAlert.source)}</b>${origSrc?.name ? ` — ${esc(origSrc.name)}` : ''} <span class="pill" style="background:${origSrc?.status==='ok'?'#dcfce7':origSrc?.status==='stale'?'#fef9c3':'#fee2e2'};color:${origSrc?.status==='ok'?'#16a34a':origSrc?.status==='stale'?'#a16207':'#dc2626'};border-color:currentColor">${origSrc?.status||'unknown'}</span>${origSrc?.url ? ` · <a href="${origSrc.url}" target="_blank" rel="noopener">View at source ↗</a>` : ''}${origAlert.sourceUrl ? ` · <a href="${origAlert.sourceUrl}" target="_blank" rel="noopener">View this alert at source ↗</a>` : ''}</td></tr>` : ''}
    <tr><th>Incident ID</th><td><code>${esc(inc.id)}</code></td></tr>
    <tr><th>Dashboard link</th><td><a href="${dashLink}" target="_blank" rel="noopener">${dashLink} ↗</a></td></tr>
  </table>

  <h2>Description</h2>
  <div class="summary">${inc.description ? esc(inc.description) : '<i style="color:#71717a">No description provided when this incident was opened.</i>'}</div>
  ${inc.closedNote?`<div class="closure"><b>Closure note:</b> ${esc(inc.closedNote)}</div>`:''}

  ${origAlert ? `<h2>Originating Alert</h2>
  <div class="msg-block" style="border-left-color:${SEV_COLOR[origAlert.sev]}">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
      <div>
        <span class="sev" style="background:${SEV_COLOR[origAlert.sev]}22;color:${SEV_COLOR[origAlert.sev]};border-color:${SEV_COLOR[origAlert.sev]}">${SEV_NAME[origAlert.sev]}</span>
        <span class="msg-step" style="color:${SEV_COLOR[origAlert.sev]};margin-left:6px">${esc(origAlert.type)} · ${esc(origAlert.source)}</span>
      </div>
      <span class="msg-when">issued ${new Date(origAlert.issued).toLocaleString()}</span>
    </div>
    <div class="msg-subject" style="margin-top:8px">${esc(origAlert.title)}</div>
    <div class="msg-body">${esc(origAlert.summary)}</div>
    <table style="margin-top:10px;font-size:12px">
      <tr><th style="width:140px">Source</th><td>${origSrc?.url ? `<a href="${origSrc.url}" target="_blank" rel="noopener">${esc(origAlert.source)} — ${esc(origSrc.name)} ↗</a>` : esc(origAlert.source)}</td></tr>
      <tr><th>Location</th><td>${esc(origAlert.location)}</td></tr>
      <tr><th>Coordinates</th><td>${origAlert.lat.toFixed(4)}, ${origAlert.lng.toFixed(4)} <a href="https://www.google.com/maps/search/?api=1&query=${origAlert.lat},${origAlert.lng}" target="_blank" rel="noopener" style="margin-left:8px">View on Google Maps ↗</a></td></tr>
      <tr><th>Impact radius</th><td>${origAlert.radiusKm ? origAlert.radiusKm + ' km' : '—'}</td></tr>
      <tr><th>Alert ID</th><td><code>${esc(origAlert.id)}</code> · <a href="${dashRoot}#alert/${esc(origAlert.id)}" target="_blank" rel="noopener">Full alert page ↗</a></td></tr>
    </table>
  </div>` : ''}

  ${relatedAlerts.length ? `<h2>Related Alerts (${relatedAlerts.length})</h2>
  <p style="font-size:11px;color:#71717a;margin-bottom:8px">Other active alerts in the affected offices at time of report.</p>
  <table>
    <tr><th>Severity</th><th>Source</th><th>Title</th><th>Office</th><th>Issued</th><th>Links</th></tr>
    ${relatedAlerts.map(a => {
      const aSrc = SOURCES.find(s => s.id === a.source);
      const statusColor = aSrc?.status==='ok'?'#16a34a':aSrc?.status==='stale'?'#a16207':'#dc2626';
      return `<tr>
        <td><span class="sev" style="background:${SEV_COLOR[a.sev]}22;color:${SEV_COLOR[a.sev]};border-color:${SEV_COLOR[a.sev]};font-size:10px;padding:2px 6px">${SEV_NAME[a.sev]}</span></td>
        <td>
          <b>${esc(a.source)}</b>${aSrc?.name ? ` — ${esc(aSrc.name)}` : ''}
          ${aSrc?.status ? `<br><span style="font-size:10px;color:${statusColor}">● ${aSrc.status}</span>` : ''}
          ${aSrc?.url ? ` · <a href="${aSrc.url}" target="_blank" rel="noopener" style="font-size:10px">View at source ↗</a>` : ''}
        </td>
        <td>${esc(a.title)}</td>
        <td>${esc(a.officeId||'—')}</td>
        <td>${new Date(a.issued).toLocaleString()}</td>
        <td>
          <a href="${dashRoot}#alert/${esc(a.id)}" target="_blank" rel="noopener">Alert page ↗</a>
          ${a.sourceUrl ? `<br><a href="${a.sourceUrl}" target="_blank" rel="noopener">At source ↗</a>` : ''}
          <br><a href="https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}" target="_blank" rel="noopener">Map ↗</a>
        </td>
      </tr>`;
    }).join('')}
  </table>` : ''}

  <h2>Affected Offices</h2>
  <table>
    <tr><th>Code</th><th>Name</th><th>Country</th><th>Address</th><th style="text-align:right">Headcount</th><th>Map</th></tr>
    ${offices.map(o => `<tr>
      <td><b>${o.id}</b></td>
      <td>${esc(o.name)}</td>
      <td>${esc(o.country)}</td>
      <td>${esc(o.address)}</td>
      <td style="text-align:right">${fmtHeadcount(o.headcount)}</td>
      <td><a href="https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}" target="_blank" rel="noopener">📍 Maps ↗</a></td>
    </tr>`).join('')}
  </table>

  <h2>Response Tally</h2>
  <div class="tally-row">
    <div class="tally-cell ok"><div class="n">${ok}</div><div class="l">OK</div></div>
    <div class="tally-cell help"><div class="n">${help}</div><div class="l">Needs Help</div></div>
    <div class="tally-cell no"><div class="n">${no}</div><div class="l">No Response</div></div>
    <div class="tally-cell"><div class="n">${pct}%</div><div class="l">Responded</div></div>
  </div>
  <div class="progress-bar"><span style="width:${pct}%"></span></div>

  <h2>Communications Sent (${messages.length})</h2>
  ${messages.length ? messages.map((m,i)=>{
    const tplName = m.templateName || allTemplates().find(t=>t.id===m.template)?.name || 'Custom';
    // Test messages get an inline 🧪 TEST badge + a left-rail accent.
    // The Export Report is the artifact CMT will share post-incident or
    // post-drill, so the marker has to be unmissable on a printed page.
    const testBadge = m.isTest
      ? ' <span style="display:inline-block;background:#cffafe;color:#0e7490;border:1px solid #67e8f9;border-radius:3px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-left:6px">🧪 TEST DRILL</span>'
      : '';
    const testStyle = m.isTest ? 'border-left-color:#0891b2;background:#ecfeff;' : '';
    return `<div class="msg-block" style="${testStyle}">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="msg-step">${i+1}. ${esc(tplName)}${testBadge}</span>
        <span class="msg-when">${new Date(m.when).toLocaleString()}</span>
      </div>
      ${m.subject?`<div class="msg-subject">${esc(m.subject)}</div>`:''}
      <div class="msg-body">${linkify(esc(m.body))}</div>
      ${m.attachments?.length?`<div style="margin-top:8px;font-size:11px"><b>Attachments:</b> ${m.attachments.map(a => `<a href="${a.data||'#'}" target="_blank" ${a.data?`download="${esc(a.name)}"`:''} style="margin-right:6px">${fileIcon(a.type)} ${esc(a.name)}${a.size?` (${fmtSize(a.size)})`:''}</a>`).join('')}</div>`:''}
      <div style="margin-top:8px">
        ${m.channels.map(c=>`<span class="pill">${c.toUpperCase()}</span>`).join('')}
        <span class="pill">${(m.recipients ?? m.recipientsCount ?? 0).toLocaleString()} recipients</span>
        <span class="pill">${esc(m.offices.join(', '))}</span>
        ${m.responseRequired?'<span class="pill" style="color:#16a34a;border-color:#16a34a">tracked</span>':''}
      </div>
    </div>`;
  }).join('') : '<div class="summary">No messages sent for this incident.</div>'}

  <h2>Employee Responses (${employeeRows.length})</h2>
  ${employeeRows.length?`<table>
    <tr><th>Name</th><th>Office / Role</th><th>Status</th><th>When</th><th>Logged by</th></tr>
    ${employeeRows.map(r => `<tr>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.who)}</td>
      <td class="status-${r.status==='no'?'no':r.status}">${r.status==='no'?'No response':r.status==='ok'?'OK':'Needs Help'}</td>
      <td>${r.when?new Date(r.when).toLocaleString():'—'}</td>
      <td>${esc(r.by||'—')}</td>
    </tr>`).join('')}
  </table>`:'<div class="summary">No employee responses logged.</div>'}

  ${travelerRows.length?`<h2>Travelers (${travelerRows.length})</h2><table>
    <tr><th>Name</th><th>Home → Destination</th><th>Status</th><th>When</th><th>Logged by</th></tr>
    ${travelerRows.map(r => `<tr>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.who)}</td>
      <td class="status-${r.status==='no'?'no':r.status}">${r.status==='no'?'No response':r.status==='ok'?'OK':'Needs Help'}</td>
      <td>${r.when?new Date(r.when).toLocaleString():'—'}</td>
      <td>${esc(r.by||'—')}</td>
    </tr>`).join('')}
  </table>`:''}

  ${remoteRows.length?`<h2>Remote Employees (${remoteRows.length})</h2><table>
    <tr><th>Name</th><th>Location</th><th>Status</th><th>When</th><th>Logged by</th></tr>
    ${remoteRows.map(r => `<tr>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.who)}</td>
      <td class="status-${r.status==='no'?'no':r.status}">${r.status==='no'?'No response':r.status==='ok'?'OK':'Needs Help'}</td>
      <td>${r.when?new Date(r.when).toLocaleString():'—'}</td>
      <td>${esc(r.by||'—')}</td>
    </tr>`).join('')}
  </table>`:''}

  <h2>Notes (${notes.length})</h2>
  ${notes.length?notes.map(n=>`<div class="msg-block" style="border-left-color:#facc15">
    <div class="msg-when">${new Date(n.when).toLocaleString()} · ${esc(n.by||'—')}</div>
    <div class="msg-body" style="margin-top:4px">${linkify(esc(n.body))}</div>
    ${n.attachments?.length?`<div style="margin-top:6px;font-size:11px"><b>Attachments:</b> ${n.attachments.map(a => `<a href="${a.data||'#'}" target="_blank" ${a.data?`download="${esc(a.name)}"`:''} style="margin-right:6px">${fileIcon(a.type)} ${esc(a.name)}${a.size?` (${fmtSize(a.size)})`:''}</a>`).join('')}</div>`:''}
  </div>`).join(''):'<div class="summary">No notes logged.</div>'}

  <h2>Activity Log (${log.length})</h2>
  <div class="log">
    ${log.map(l=>`<div class="log-row"><div class="log-when">${new Date(l.when).toLocaleString()} · ${esc(l.by)} · ${esc(l.kind)}</div><div>${l.body}</div></div>`).join('')}
  </div>

  <h2>References & Source Links</h2>
  <table>
    <tr><th style="width:200px">Item</th><th>Link</th></tr>
    <tr><td>Dashboard permalink</td><td><a href="${dashLink}" target="_blank" rel="noopener">${dashLink}</a></td></tr>
    ${origAlert ? `<tr><td>Originating alert</td><td><a href="${dashRoot}#alert/${esc(origAlert.id)}" target="_blank" rel="noopener">Alert ${esc(origAlert.id)} — ${esc(origAlert.title)} ↗</a></td></tr>` : ''}
    ${origSrc?.url ? `<tr><td>Originating data source</td><td><b>${esc(origSrc.id||origAlert.source)}</b> — ${esc(origSrc.name)} · <a href="${origSrc.url}" target="_blank" rel="noopener">${origSrc.url} ↗</a></td></tr>` : ''}
    ${origAlert?.sourceUrl ? `<tr><td>Originating alert at source</td><td><a href="${origAlert.sourceUrl}" target="_blank" rel="noopener">${origAlert.sourceUrl} ↗</a></td></tr>` : ''}
    ${(() => {
      // Unique sources from related alerts
      const sources = {};
      relatedAlerts.forEach(a => {
        const s = SOURCES.find(x => x.id === a.source);
        if (s?.url && !sources[s.id]) sources[s.id] = s;
      });
      return Object.values(sources).map(s => `<tr><td>Related data source</td><td><b>${esc(s.id)}</b> — ${esc(s.name)} · <a href="${s.url}" target="_blank" rel="noopener">${s.url} ↗</a></td></tr>`).join('');
    })()}
    ${relatedAlerts.map(a => `<tr><td>Related alert</td><td><a href="${dashRoot}#alert/${esc(a.id)}" target="_blank" rel="noopener">Alert ${esc(a.id)} — ${esc(a.title)} ↗</a>${a.sourceUrl ? ` · <a href="${a.sourceUrl}" target="_blank" rel="noopener">at source ↗</a>` : ''}</td></tr>`).join('')}
    ${offices.map(o => `<tr><td>${o.id} office location</td><td>${esc(o.address)} · <a href="https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}" target="_blank" rel="noopener">View on Google Maps ↗</a></td></tr>`).join('')}
  </table>

  <div class="footer">
    NR Safety Alerts · CMT Dashboard<br>
    Report generated ${new Date().toLocaleString()}<br>
    Incident ID <code>${esc(inc.id)}</code> · This report is a static snapshot of the incident at the time of export.
  </div>

  <script>
    window.__incident = ${JSON.stringify({
      id: inc.id, title: inc.title, status: inc.status, severity: inc.severity,
      opened: inc.opened, closedAt: inc.closedAt, closedNote: inc.closedNote,
      offices: inc.offices, officeDetails: offices,
      description: inc.description,
      alertId: inc.alertId,
      originatingAlert: origAlert || null,
      originatingSource: origSrc || null,
      relatedAlerts: relatedAlerts.map(a => ({
        ...a,
        sourceMeta: SOURCES.find(s => s.id === a.source) || null,
        dashboardLink: `${dashRoot}#alert/${a.id}`,
        mapsLink: `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`,
      })),
      dashboardLink: dashLink,
      messages, notes, log: inc.log, responses: resp,
      reopens: inc.reopens || [],
      generatedAt: new Date().toISOString(),
    }).replace(/</g,'\\u003c')};
    function downloadJSON() {
      const blob = new Blob([JSON.stringify(window.__incident, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'incident-' + window.__incident.id + '.json'; a.click();
      URL.revokeObjectURL(url);
    }
  <\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blocked. Allow pop-ups for this site to view the report.'); return; }
  w.document.write(html);
  w.document.close();
}

/* private */ let _saveTimer = null;

export function buildPersistPayload() {
  return {
    schema: 1,
    savedAt: new Date().toISOString(),
    incidents:        STATE.incidents.map(stripIncident),
    responses:        STATE.responses,
    crisisLog:        STATE.crisisLog.map(stripMessageAtts),
    roomMessages:     STATE.roomMessages,
    userTemplates:    STATE.userTemplates,
    customLocations:  STATE.customLocations,
    expandedOffices:  Array.from(STATE.expandedOffices || []),
    incidentListFilter: STATE.incidentListFilter,
    panelWidths:      STATE.panelWidths,
    draft: {
      selectedOffices:  STATE.selectedOffices,
      channels:         STATE.channels,
      template:         STATE.template,
      customMessage:    STATE.customMessage,
      subject:          STATE.subject,
      responseRequired: STATE.responseRequired,
      reminderInterval: STATE.reminderInterval,
      attachments:      (STATE.attachments || []).map(stripAtt),
      linkedIncidentId: STATE.linkedIncidentId,
      composeAdvanced:  STATE.composeAdvanced,
      isTest:           STATE.isTest,
    },
    noteAttachments:  (STATE.noteAttachments || []).map(stripAtt),
  };
}

export function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const json = JSON.stringify(buildPersistPayload());
      localStorage.setItem(PERSIST_KEY, json);
      lastSavedAt = new Date();
      // refresh just the saved indicator in the strip
      const strip = document.getElementById('status-strip');
      if (strip) renderStatusStrip();
    } catch (err) {
      console.error('Persist save failed:', err);
      if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
        toast('Local storage full. Use Manual → Export Data, then Reset to free space.');
      }
    }
  }, PERSIST_DEBOUNCE_MS);
}

export function loadState() {
  try {
    const json = localStorage.getItem(PERSIST_KEY);
    if (!json) return false;
    const data = JSON.parse(json);
    if (data.schema !== 1) {
      console.warn('Saved data has unknown schema version:', data.schema, '— ignoring.');
      return false;
    }
    if (Array.isArray(data.incidents))      STATE.incidents = data.incidents;
    if (data.responses)                     STATE.responses = data.responses;
    if (Array.isArray(data.crisisLog))      STATE.crisisLog = data.crisisLog;
    if (Array.isArray(data.roomMessages))   STATE.roomMessages = data.roomMessages;
    if (Array.isArray(data.userTemplates))  STATE.userTemplates = data.userTemplates;
    if (Array.isArray(data.customLocations))STATE.customLocations = data.customLocations;
    if (Array.isArray(data.expandedOffices))STATE.expandedOffices = new Set(data.expandedOffices);
    if (data.incidentListFilter)            STATE.incidentListFilter = data.incidentListFilter;
    if (data.panelWidths)                   STATE.panelWidths = { ...STATE.panelWidths, ...data.panelWidths };
    if (data.draft) {
      STATE.selectedOffices  = data.draft.selectedOffices  || [];
      STATE.channels         = data.draft.channels         || STATE.channels;
      STATE.template         = data.draft.template         || '';
      STATE.customMessage    = data.draft.customMessage    || '';
      STATE.subject          = data.draft.subject          || '';
      if (typeof data.draft.responseRequired === 'boolean') STATE.responseRequired = data.draft.responseRequired;
      STATE.reminderInterval = data.draft.reminderInterval || '15m';
      STATE.attachments      = data.draft.attachments      || [];
      STATE.linkedIncidentId = data.draft.linkedIncidentId || null;
      if (typeof data.draft.composeAdvanced === 'boolean') STATE.composeAdvanced = data.draft.composeAdvanced;
    }
    if (Array.isArray(data.noteAttachments)) STATE.noteAttachments = data.noteAttachments;
    if (data.savedAt) lastSavedAt = new Date(data.savedAt);
    return true;
  } catch (err) {
    console.error('Persist load failed:', err);
    return false;
  }
}

export function exportData() {
  const payload = buildPersistPayload();
  payload.exportedAt = new Date().toISOString();
  payload.app = 'NR Safety Alerts — CMT Dashboard';
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `safety-alerts-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Data exported.');
}

export function resetData() {
  showModal(`<h3>Reset all local data?</h3>
    <p style="font-size:12px;color:var(--muted);line-height:1.5">
      This permanently clears all incidents, sent messages, room thread, custom templates, custom locations, and the current draft from this browser.
      <br><br>
      The mock alert/office data will reload as if you opened the app fresh. <b>This cannot be undone.</b>
      <br><br>
      Consider <b>Export Data</b> first.
    </p>
    <div class="modal-actions">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px;background:var(--red);color:#fff" id="modal-confirm">Yes, reset everything</button>
    </div>`);
  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('modal-confirm').onclick = () => {
    try { localStorage.removeItem(PERSIST_KEY); } catch(_) {}
    closeModal();
    toast('Local data cleared. Reloading…');
    setTimeout(() => location.reload(), 600);
  };
}

