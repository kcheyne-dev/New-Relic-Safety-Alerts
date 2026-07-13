/**
 * NRSA / S.T.A.R. View — backend API client + live-mode bootstrap.
 *
 * SESSION 2 / step 7 (2026-06-19): extracted from legacy-app.js. Wires
 * the dashboard to /api/* on the backend (live mode), with a JWT login
 * modal and an SSE event stream for real-time push.
 *
 * BOOT FLOW (live mode):
 *   1. legacy-app.js's tail still contains the boot trigger:
 *        if (API_BASE) {
 *          if (getStoredToken()) bootLiveMode();
 *          else showLoginModal();
 *        }
 *      The trigger MUST stay in legacy-app.js because it depends on render
 *      functions (renderAll, renderIncidents, etc.) being defined; api.js
 *      runs at module-load time, before legacy-app.js's deferred body, so
 *      auto-running boot here would race.
 *   2. bootLiveMode pulls /api/auth/me to verify the JWT, then runs four
 *      backfills in sequence (alerts, WHO outbreaks, optional migration of
 *      localStorage-only incidents, server-canonical incidents) and finally
 *      opens the SSE stream for new-event push.
 *
 * BRIDGE RELIANCE:
 *   - Mutates state.X via window setters (state.ALERTS = data.events.map(...) etc.)
 *   - Calls render functions defined in legacy-app.js (renderAll, renderIncidents)
 *     via window-fallthrough (function declarations on classic scripts ARE on window).
 *   - Calls helper functions defined in helpers.js (enrichEventWithImpact,
 *     stripIncident, esc) via window — main.js bridges them.
 *
 * The migration helper at the bottom (migrateLocalIncidents) is one-shot —
 * after a successful first boot it has nothing to migrate and is a no-op.
 * Stays in api.js because it's part of the bootLiveMode call chain. */

import {
  TOKEN_KEY,
  BACKEND_TYPE_TO_CATEGORY,
  BACKEND_CATEGORY_TO_LABEL,
  SOURCE_ID_TO_CATEGORY,
} from './constants.js';
// Bridge-cleanup api.js full migration (2026-07-13, no ESLint trim):
// last medium-size module to migrate. Same techniques as previous batches.
// Introduces three new circular imports (api↔modals, api↔render,
// api↔incidents) — safe because api.js's module top-level is only
// TOKEN_KEY-etc. constants + an IIFE that parses location.hash for
// API_BASE (no cross-module calls at load time).
import { state } from './state.js';
import {
  enrichEventWithImpact,
  esc,
  stripIncident,
} from './helpers.js';
import {
  closeModal,
  showModal,
  toast,
} from './modals.js';
import {
  renderAll,
  renderIncidents,
  renderStatusStrip,
} from './render.js';
import {
  buildResponseShells,
  createIncident,
} from './incidents.js';

export const API_BASE = (() => {
  const hashMatch = location.hash.match(/[#&]api=([^&]+)/);
  if (hashMatch) {
    const v = decodeURIComponent(hashMatch[1]);
    return v === 'mock' ? '' : v.replace(/\/$/, '');
  }
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:') {
    return 'http://localhost:8080';
  }
  return '';
})();

export function getStoredToken()  { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }

export function storeToken(tok)   { try { localStorage.setItem(TOKEN_KEY, tok); } catch {} }

export function clearStoredToken(){ try { localStorage.removeItem(TOKEN_KEY); } catch {} }

export async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const tok = getStoredToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const resp = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (resp.status === 401) {
    clearStoredToken();
    showLoginModal();
    throw new Error('Not authenticated');
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${text.slice(0, 200)}`);
  }
  const ct = resp.headers.get('content-type') || '';
  return ct.includes('application/json') ? resp.json() : resp.text();
}

export function mapIncidentRowToState(r, sub = {}) {
  return {
    id:           r.id,
    title:        r.title,
    description:  r.description ?? '',
    severity:     r.severity,
    offices:      r.offices ?? [],
    alertId:      r.alert_id ?? null,
    status:       r.status,
    closedNote:   r.closed_note ?? null,
    closedAt:     r.closed_at ?? null,
    opened:       r.created_at,
    reopens:      Array.isArray(r.reopens) ? r.reopens : [],
    notes:        Array.isArray(sub.notes)    ? sub.notes.map(mapNoteRow)        : [],
    log:          Array.isArray(sub.log)      ? sub.log.map(mapLogRow)            : [],
    messages:     Array.isArray(sub.messages) ? sub.messages.map(mapMessageRow)   : [],
  };
}

export function mapNoteRow(r) {
  return {
    id:          r.id,
    when:        r.added_at,
    by:          r.added_by_user_id ?? 'system',
    body:        r.body,
    attachments: r.attachments ?? [],
  };
}

export function mapLogRow(r) {
  return {
    id:    r.id,
    when:  r.at,
    by:    r.by_user_id ?? 'system',
    kind:  r.kind,
    body:  r.body,
  };
}

export function mapMessageRow(r) {
  return {
    id:               r.id,
    incidentId:       r.incident_id ?? null,
    when:             r.sent_at,
    by:               r.sent_by_user_id ?? 'system',
    template:         r.template ?? null,
    templateName:     r.template_name ?? null,
    subject:          r.subject ?? '',
    body:             r.body,
    channels:         r.channels ?? [],
    offices:          r.offices ?? [],
    recipientsCount:  r.recipients_count ?? 0,
    // Locally-created messages use `recipients`; server-mapped messages used
    // to drop that field, so the comm-card / crisis-log render that reads
    // `m.recipients` would render `undefined.toLocaleString()` and crash.
    // Mirror the count so render code doesn't have to branch on shape.
    recipients:       r.recipients_count ?? 0,
    responseRequired: r.response_required ?? false,
    reminderInterval: r.reminder_interval ?? null,
    attachments:      r.attachments ?? [],
    // 2026-06-18: drill flag. Backend default is FALSE for legacy rows.
    isTest:           r.is_test ?? false,
  };
}

export const incidentsApi = {
  /** GET /api/incidents — list, optionally filtered by status='open'|'closed'. */
  async list(status) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await apiFetch(`/api/incidents${qs}`);
    return (data?.incidents ?? []).map(r => mapIncidentRowToState(r));
  },
  /** GET /api/incidents/:id — full detail with messages, responses, notes, log. */
  async get(id) {
    const data = await apiFetch(`/api/incidents/${encodeURIComponent(id)}`);
    if (!data?.incident) return null;
    return {
      incident:  mapIncidentRowToState(data.incident, { messages: data.messages, notes: data.notes, log: data.log }),
      responses: data.responses ?? [],
    };
  },
  /** POST /api/incidents — create. Returns mapped incident. */
  async create({ title, description, severity, offices, alertId }) {
    const data = await apiFetch('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ title, description, severity, offices, alertId: alertId ?? undefined }),
    });
    return mapIncidentRowToState(data.incident);
  },
  /** POST /api/incidents/:id/close. */
  async close(id, closureNote) {
    return apiFetch(`/api/incidents/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      body: JSON.stringify({ closureNote: closureNote ?? '' }),
    });
  },
  /** POST /api/incidents/:id/reopen. Body is empty semantically but we
   *  send `{}` because Fastify rejects body-less requests when the
   *  Content-Type is application/json (FST_ERR_CTP_EMPTY_JSON_BODY). */
  async reopen(id) {
    return apiFetch(`/api/incidents/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
      body: '{}',
    });
  },
  /** POST /api/incidents/:id/messages — send incident-linked Crisis message. */
  async sendMessage(incidentId, payload) {
    const data = await apiFetch(`/api/incidents/${encodeURIComponent(incidentId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.messageId;
  },
  /** PUT /api/incidents/:id/responses/:employeeId — record OK/Help/No status. */
  async updateResponse(incidentId, employeeId, payload) {
    return apiFetch(`/api/incidents/${encodeURIComponent(incidentId)}/responses/${encodeURIComponent(employeeId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  /** POST /api/incidents/:id/notes — add note. */
  async addNote(incidentId, { body, attachments }) {
    const data = await apiFetch(`/api/incidents/${encodeURIComponent(incidentId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body, attachments: attachments ?? [] }),
    });
    return data.noteId;
  },
};

export const commsApi = {
  /** GET /api/comms — list standalone Crisis messages.
   *  Pass null for `incidentId` to filter to standalone-only;
   *  pass a UUID to filter to that incident; omit for all. */
  async list(incidentId) {
    const qs = incidentId === null ? '?incidentId=null'
             : incidentId         ? `?incidentId=${encodeURIComponent(incidentId)}`
             : '';
    const data = await apiFetch(`/api/comms${qs}`);
    return (data?.messages ?? []).map(mapMessageRow);
  },
  /** POST /api/comms — send a standalone Crisis message (no incident). */
  async send(payload) {
    const data = await apiFetch('/api/comms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.messageId;
  },
};

export function showLoginModal() {
  showModal(`<h3>Sign in</h3>
    <p style="font-size:12px;color:var(--muted)">Backend at <code style="font-size:11px">${esc(API_BASE)}</code></p>
    <div class="field"><label>Email</label><input id="login-email" type="email" autofocus placeholder="you@newrelic.com"/></div>
    <div class="field"><label>Password</label><input id="login-password" type="password"/></div>
    <div id="login-error" style="color:var(--red);font-size:12px;margin-top:6px;display:none"></div>
    <div class="modal-actions">
      <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="login-submit">Sign in</button>
    </div>`);
  const submit = async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    err.style.display = 'none';
    try {
      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!resp.ok) throw new Error('Invalid credentials');
      const data = await resp.json();
      storeToken(data.token);
      state.OPERATOR = { name: data.user.name, role: data.user.role, roleLabel: data.user.role.toUpperCase() };
      closeModal();
      bootLiveMode();
    } catch (e) {
      err.textContent = e.message || 'Login failed';
      err.style.display = 'block';
    }
  };
  document.getElementById('login-submit').onclick = submit;
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

export function mapBackendCategory(evt) {
  if (evt && evt.category && BACKEND_CATEGORY_TO_LABEL[evt.category]) {
    return BACKEND_CATEGORY_TO_LABEL[evt.category];
  }
  if (evt && evt.type && BACKEND_TYPE_TO_CATEGORY[evt.type]) {
    return BACKEND_TYPE_TO_CATEGORY[evt.type];
  }
  if (evt && evt.source && SOURCE_ID_TO_CATEGORY[evt.source]) {
    return SOURCE_ID_TO_CATEGORY[evt.source];
  }
  return 'Public Safety';   // safer default than 'Natural Disaster'
}

export function mapBackendType(t) {
  return BACKEND_TYPE_TO_CATEGORY[t] || 'Public Safety';
}

export function isPrescribedFire(e) {
  const t = (e.title || '').toLowerCase();
  return t.includes('prescribed fire') || /\brx\b/i.test(e.title || '') || t.startsWith('rx ');
}

export async function backfillAlerts() {
  try {
    const data = await apiFetch('/api/events?limit=500');
    if (data?.events) {
      state.ALERTS = data.events
        .filter(e => !isPrescribedFire(e))
        .map(e => enrichEventWithImpact({
          id: e.id, sev: e.sev, type: mapBackendCategory(e), source: e.source,
          title: e.title, location: e.location,
          officeId: e.officeId, affectedOfficeIds: e.affectedOfficeIds || [],
          lat: e.lat, lng: e.lng, radiusKm: e.radiusKm ?? 0,
          summary: e.summary, issued: e.issued, sourceUrl: e.sourceUrl,
        }));
      renderAll();
      state.lastRefreshAt = new Date();
      toast(`Loaded ${state.ALERTS.length} live alerts.`);
    }
  } catch (err) {
    console.error('backfill failed:', err);
  }
}

/* private */ let _sseConnection = null;

export function subscribeLiveStream() {
  if (_sseConnection) { _sseConnection.close(); _sseConnection = null; }
  const tok = getStoredToken();
  if (!tok) return;
  // EventSource can't send Authorization header — use ?token= query param
  const es = new EventSource(`${API_BASE}/api/events/stream?token=${encodeURIComponent(tok)}`);
  _sseConnection = es;
  es.addEventListener('event', (msg) => {
    try {
      const data = JSON.parse(msg.data);
      const mapEvt = (e) => enrichEventWithImpact({
        ...e, type: mapBackendCategory(e), radiusKm: e.radiusKm ?? 0,
        affectedOfficeIds: e.affectedOfficeIds || [],
      });
      if (data.kind === 'new' && data.event) {
        if (isPrescribedFire(data.event)) return;     // ignore controlled burns
        const evt = mapEvt(data.event);
        state.ALERTS = [evt, ...state.ALERTS.filter(a => a.id !== evt.id)];
        renderAll();
        toast(`📡 New alert: ${evt.title.slice(0, 40)}…`);
      } else if (data.kind === 'updated' && data.event) {
        if (isPrescribedFire(data.event)) return;
        const evt = mapEvt(data.event);
        state.ALERTS = state.ALERTS.map(a => a.id === evt.id ? evt : a);
        renderAll();
      }
      // Any successful SSE message means the backend is reachable, so refresh
      // the "Last fetch" chip's age clock too — not just /api/events backfills.
      state.lastRefreshAt = new Date();
    } catch (e) { /* noop */ }
  });
  es.onerror = () => { /* EventSource auto-reconnects; no log spam */ };
}

export async function backfillWhoOutbreaks() {
  // WHO Disease Outbreak News — populated separately from the alert pipeline.
  // Schema mirrors state.WHO_OUTBREAKS_MOCK so the swap from mock → real is data-only.
  // Soft-fails: a missing or stale-error WHO endpoint shouldn't block the dashboard.
  try {
    const json = await apiFetch('/api/who-outbreaks');
    if (Array.isArray(json?.outbreaks)) {
      state.WHO_OUTBREAKS = json.outbreaks;
      // If the Risk Profile modal is currently open, re-render it so the new data shows.
      const back = document.getElementById('modal-back');
      if (back && document.querySelector('.risk-country-chip')) {
        back.querySelector('.modal').innerHTML = riskModalHTML();
        bindRiskModalHandlers();
      }
    }
  } catch (err) {
    // Don't disrupt dashboard if WHO is unavailable — outbreak data is contextual, not critical.
    console.warn('WHO outbreaks fetch failed:', err);
  }
}

export function isLocalIncidentId(id) {
  return typeof id === 'string' && id.startsWith('i_');
}

export async function migrateLocalIncidents() {
  if (!API_BASE) return;
  // _persistPending=true means createIncident's own .then is still in
  // flight for that incident. Skip those — re-attempting here would
  // double-create.
  const local = (state.UI_STATE.incidents || []).filter(
    i => isLocalIncidentId(i.id) && !i._persistPending
  );
  if (!local.length) return;

  let migrated = 0;
  let failed   = 0;

  for (const inc of local) {
    let serverInc;
    try {
      serverInc = await incidentsApi.create({
        title:       inc.title,
        description: inc.description || '',
        severity:    inc.severity,
        offices:     inc.offices || [],
        alertId:     inc.alertId || undefined,
      });
    } catch (err) {
      console.warn('migrate: incident create failed (kept local):', inc.id, err);
      failed++;
      continue;
    }

    const oldId = inc.id;
    const newId = serverInc.id;
    // Swap the id across every STATE field that keys off it. After this,
    // backfillIncidents (which runs next) will line up perfectly with the
    // local STATE because the ids match.
    inc.id = newId;
    if (state.UI_STATE.responses[oldId]) {
      state.UI_STATE.responses[newId] = state.UI_STATE.responses[oldId];
      delete state.UI_STATE.responses[oldId];
    }
    if (state.UI_STATE.selectedIncidentId === oldId) state.UI_STATE.selectedIncidentId = newId;
    if (state.UI_STATE.linkedIncidentId   === oldId) state.UI_STATE.linkedIncidentId   = newId;

    // Sub-resources, sequential + best-effort. Order matters: messages
    // before notes is just convention; close goes last because it freezes
    // the incident on the server.
    for (const m of (inc.messages || [])) {
      try {
        await incidentsApi.sendMessage(newId, {
          template:         m.template ?? undefined,
          templateName:     m.templateName,
          subject:          m.subject || undefined,
          body:             m.body,
          channels:         m.channels || [],
          offices:          m.offices || [],
          recipientsCount:  m.recipients ?? m.recipientsCount ?? 0,
          responseRequired: !!m.responseRequired,
          reminderInterval: m.reminder ?? m.reminderInterval ?? undefined,
          attachments:      m.attachments || [],
          isTest:           !!m.isTest,
        });
      } catch (e) { console.warn('migrate: message persist failed', oldId, e); }
    }
    for (const n of (inc.notes || [])) {
      try {
        await incidentsApi.addNote(newId, {
          body: n.body,
          attachments: n.attachments || [],
        });
      } catch (e) { console.warn('migrate: note persist failed', oldId, e); }
    }
    // Only persist non-default responses (status='no' is the implicit shell
    // built by buildResponseShells; no need to round-trip it).
    const respMap = state.UI_STATE.responses[newId] || {};
    for (const [eid, r] of Object.entries(respMap)) {
      if (!r || r.status === 'no') continue;
      const employeeId = eid.replace(/^T-/, '');   // strip traveler prefix
      try {
        await incidentsApi.updateResponse(newId, employeeId, {
          status:     r.status,
          isTraveler: !!r.traveler,
        });
      } catch (e) { console.warn('migrate: response persist failed', oldId, eid, e); }
    }
    if (inc.status === 'closed') {
      try {
        await incidentsApi.close(newId, inc.closedNote || '');
      } catch (e) { console.warn('migrate: close persist failed', oldId, e); }
    }
    migrated++;
  }

  if (migrated > 0) {
    const tail = failed ? ` ${failed} failed — kept local.` : '';
    toast(`✓ Migrated ${migrated} localStorage incident${migrated === 1 ? '' : 's'} to backend.${tail}`);
  } else if (failed > 0) {
    toast(`⚠ ${failed} localStorage incident${failed === 1 ? '' : 's'} could not migrate — kept local.`);
  }
  // state.UI_STATE.incidents now has the right ids; render so the panel reflects
  // any selection/link changes that came along with the swap.
  renderIncidents();
}

export async function backfillIncidents() {
  // Defensive: bare GitHub Pages and #api=mock both have empty API_BASE.
  // bootLiveMode already gates on API_BASE before reaching here, but
  // guarding inside the function keeps it safe to call from elsewhere.
  if (!API_BASE) return;
  // Pull incidents from the backend (Sprint 5). Soft-fail: if the call
  // errors, leave any localStorage-loaded incidents in place rather than
  // wiping state.UI_STATE.incidents — that's better UX than empty-state on a hiccup.
  try {
    const incidents = await incidentsApi.list();
    // Hydrate full detail (responses + log + messages) for each incident
    // in parallel. For 100+ incidents this would need pagination, but
    // we're well under that for now.
    const details = await Promise.all(
      incidents.map(async (inc) => {
        try {
          const full = await incidentsApi.get(inc.id);
          return full ? { ...full.incident, _backendResponses: full.responses } : inc;
        } catch (e) {
          console.warn('incident detail fetch failed:', inc.id, e);
          return inc;
        }
      })
    );
    state.UI_STATE.incidents = details;
    // Build state.UI_STATE.responses from per-incident response rows
    state.UI_STATE.responses = {};
    for (const inc of details) {
      const respMap = {};
      for (const r of (inc._backendResponses || [])) {
        const key = r.is_traveler ? `T-${r.employee_id}` : r.employee_id;
        respMap[key] = {
          status: r.status,
          when:   r.status_set_at,
          by:     r.status_set_by_user_id ?? 'system',
          traveler: r.is_traveler || undefined,
        };
      }
      state.UI_STATE.responses[inc.id] = respMap;
      delete inc._backendResponses;
    }
    renderIncidents();
  } catch (err) {
    console.warn('backfillIncidents failed (using localStorage):', err);
  }
}

export async function bootLiveMode() {
  try {
    const me = await apiFetch('/api/auth/me');
    if (me?.user) {
      state.OPERATOR = { name: me.user.name, role: me.user.role, roleLabel: me.user.role.toUpperCase() };
      renderStatusStrip();
    }
  } catch { /* token invalid → showLoginModal already handled it */ return; }

  await backfillAlerts();
  await backfillWhoOutbreaks();
  // Migrate any localStorage-only incidents BEFORE backfillIncidents fetches
  // the server list. backfillIncidents replaces state.UI_STATE.incidents wholesale,
  // so anything still local-only at that point would be lost on next save.
  // See migrateLocalIncidents for the full strategy.
  await migrateLocalIncidents();
  await backfillIncidents();
  subscribeLiveStream();

  // Refresh-on-focus: when tab regains focus, re-pull events + WHO outbreaks
  window.addEventListener('focus', () => {
    backfillAlerts();
    backfillWhoOutbreaks();
  });
}

