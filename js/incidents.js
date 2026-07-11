/**
 * NRSA / S.T.A.R. View — incident state-mutation helpers.
 *
 * SESSION 3 / cleanup #3 (2026-06-19): the four functions that own creating,
 * extending, and reopening incidents in state.UI_STATE. They sit at the seam between
 * render code and persistence + API:
 *
 *   - createIncident: makes a new incident object (with a local `i_xxx` id),
 *     adds it to state.UI_STATE.incidents, builds response shells for the affected
 *     offices, logs the create, and kicks off a fire-and-forget POST to
 *     /api/incidents. The local-id → server-UUID swap happens in the
 *     .then() callback once the round-trip completes — and that callback
 *     is also where queued messages from the dispatchSend race fix get
 *     flushed (see _pendingMessages handling).
 *
 *   - buildResponseShells: walks office employees + travelers and seeds
 *     state.UI_STATE.responses[incidentId] with status='no' rows. Idempotent
 *     (skips entries that already exist) so re-calling on top up is safe.
 *
 *   - reopenIncident: flips status='open', clears closedAt, appends to
 *     reopens[], logs, persists. Reverts local state on backend rejection.
 *
 *   - addIncidentLog: append-only audit entry. Used by every state mutation
 *     on incidents (create, comm, note, close, reopen).
 *
 * BRIDGE RELIANCE:
 *   - state.UI_STATE.incidents / state.UI_STATE.responses (state.js bridge)
 *   - incidentsApi (api.js bridge — for fire-and-forget persist)
 *   - state.EMPLOYEES, state.TRAVELERS, OFFICES (state + constants bridges)
 *   - travelersAtOffice (helpers.js bridge)
 *   - renderIncidents, addIncidentLog (sibling — same module), toast (modals.js)
 *   - uid (helpers.js bridge — local id generation)
 *   - esc (helpers.js — for log body)
 */

// Bridge-cleanup incidents.js first imports (2026-07-13, no ESLint trim):
// full explicit-imports posture in one batch — small module (4 exports),
// straightforward migration. Same techniques as helpers/render/modals/
// persistence batches.
//
// Circular imports introduced (safe — all cross-refs are inside function
// bodies, same pattern as the render↔modals + render↔persistence +
// modals↔persistence circulars already established):
//   - incidents.js → render.js (renderIncidents)
//     render.js already imports addIncidentLog, reopenIncident from incidents.js
//   - incidents.js → modals.js (toast)
//     modals.js already imports createIncident, addIncidentLog, reopenIncident,
//     buildResponseShells from incidents.js
// incidents.js's module top-level is just imports + export function decls —
// no top-level calls into any of these modules, so ES module circular
// resolution is safe.
import { state } from './state.js';
import {
  esc,
  travelersAtOffice,
  uid,
} from './helpers.js';
import { toast } from './modals.js';
import { renderIncidents } from './render.js';
import {
  API_BASE,
  incidentsApi,
} from './api.js';
import { enqueueFailure } from './outbox.js';

export function createIncident({ title, offices, severity, description, messageId, alertId }) {
  const inc = {
    id: uid(), title, offices, severity, description, messageId, alertId: alertId || null,
    opened: new Date().toISOString(), status:'open', closedNote:null, closedAt:null,
    notes: [], log: [], messages: [],
    reopens: [],   // [{ when, by }] each time the incident is reopened
    _persistPending: !!API_BASE,   // true while the backend round-trip is in flight
  };
  state.UI_STATE.incidents.unshift(inc);
  state.UI_STATE.responses[inc.id] = {};
  buildResponseShells(inc.id, offices);
  addIncidentLog(inc.id, 'create', `Incident <b>${esc(title)}</b> opened.`);

  // Live mode: fire-and-forget persist to backend. We use the local client
  // ID until the server returns; on success we swap to the server-issued
  // UUID and update state.UI_STATE.responses to match. On failure we log + toast
  // but do NOT block the user's flow — better to keep the dashboard usable
  // and have a partial-persist scenario than to lose the incident entirely.
  if (API_BASE) {
    incidentsApi.create({ title, description, severity, offices, alertId: alertId || undefined })
      .then((serverInc) => {
        // Swap local id → server UUID across STATE so subsequent
        // mutations (close/reopen/notes/responses) target the right row.
        const oldId = inc.id;
        const newId = serverInc.id;
        if (oldId === newId) return;       // shouldn't happen, but safe
        inc.id = newId;
        inc.opened = serverInc.opened;
        inc._persistPending = false;
        state.UI_STATE.responses[newId] = state.UI_STATE.responses[oldId] || {};
        delete state.UI_STATE.responses[oldId];
        if (state.UI_STATE.selectedIncidentId === oldId) state.UI_STATE.selectedIncidentId = newId;
        if (state.UI_STATE.linkedIncidentId === oldId) state.UI_STATE.linkedIncidentId = newId;

        // Flush any messages that were queued while this create was in
        // flight (see dispatchSend's _pendingMessages branch). Sequential
        // sends are fine — the queue is typically 1-2 entries — and serial
        // ordering preserves the operator's intended message order in the
        // incident's audit trail.
        //
        // CLOSURE NOTE: `inc` is the SAME object reference dispatchSend
        // pushed onto state.UI_STATE.incidents and onto which it parked
        // _pendingMessages. We mutated inc.id in place above (line 62) —
        // object identity never changed, only the id field — so this read
        // sees whatever dispatchSend queued. Don't replace `inc` with a
        // re-lookup by id here; that would race the queue.
        //
        // Queued sends: each is best-effort. Failures now enqueue to the
        // outbox (2026-07-13) instead of toast-and-drop. The operator sees
        // failed queued sends in the header badge + Log-tab chip and can
        // retry when the backend recovers. Fixes the "single Crisis-Comm-
        // lost edge case" the old code documented as an acceptable trade.
        const queued = inc._pendingMessages || [];
        inc._pendingMessages = [];
        for (const q of queued) {
          incidentsApi.sendMessage(newId, q.apiPayload).then((serverMsgId) => {
            if (serverMsgId) q.msg.id = serverMsgId;
          }).catch((e) => {
            console.warn('queued message persist failed:', e);
            enqueueFailure({
              kind: 'incident-message',
              incidentId: newId,
              apiPayload: q.apiPayload,
              msgId: q.msg?.id ?? null,
              display: q.display || {
                subject: q.apiPayload?.subject || `[${q.apiPayload?.templateName || 'Custom'}]`,
                offices: q.apiPayload?.offices || [],
                channels: q.apiPayload?.channels || [],
                reach: q.apiPayload?.recipientsCount || 0,
                isTest: !!q.apiPayload?.isTest,
              },
            }, e);
            toast('⚠ A queued message failed — queued in outbox for retry.');
          });
        }

        renderIncidents();
      })
      .catch((err) => {
        // Whole-incident create failed. Enqueue an 'incident-create' outbox
        // entry carrying the original create payload PLUS any messages that
        // were stranded waiting for the (never-received) server id. Retry
        // re-runs the entire create+flush dance via _retryIncidentCreate.
        console.warn('incident create persist failed (kept local):', err);
        inc._persistPending = false;
        const stranded = (inc._pendingMessages || []).slice();
        inc._pendingMessages = [];
        enqueueFailure({
          kind: 'incident-create',
          incidentCreatePayload: { title, description, severity, offices, alertId: alertId || undefined },
          localIncidentId: inc.id,
          queuedMessages: stranded,
          msgId: messageId || null,
          display: {
            subject: title,
            offices: offices.slice(),
            channels: [],   // create itself has no channels; queued messages have their own
            reach: 0,
            isTest: false,
          },
        }, err);
        toast(stranded.length
          ? `⚠ Incident + ${stranded.length} message(s) queued in outbox for retry.`
          : '⚠ Incident queued in outbox — backend persist failed.');
      });
  }

  return inc;
}

export function buildResponseShells(incidentId, offices) {
  offices.forEach(oid => {
    state.EMPLOYEES.filter(e => e.office === oid).forEach(e => {
      if (!state.UI_STATE.responses[incidentId][e.id]) {
        state.UI_STATE.responses[incidentId][e.id] = { status:'no', when:null, by:null };
      }
    });
    travelersAtOffice(oid).forEach(t => {
      const key = 'T-'+t.id;
      if (!state.UI_STATE.responses[incidentId][key]) {
        state.UI_STATE.responses[incidentId][key] = { status:'no', when:null, by:null, traveler:true };
      }
    });
  });
}

export function reopenIncident(incidentId) {
  const inc = state.UI_STATE.incidents.find(x => x.id === incidentId); if (!inc) return;
  const wasClosedAt = inc.closedAt;
  const wasLogLength = inc.log.length;
  inc.status = 'open';
  inc.closedAt = null;
  inc.reopens.push({ when: new Date().toISOString(), by:'cowork-3p' });
  addIncidentLog(inc.id, 'create', `Incident <b>reopened</b>.`);
  toast('Incident reopened.');
  renderIncidents();
  // Live mode: persist (fire-and-forget). Revert if backend rejects —
  // including the audit-log entry, so the timeline stays honest.
  if (API_BASE && !inc._persistPending) {
    incidentsApi.reopen(inc.id).catch(err => {
      console.warn('incident reopen persist failed:', err);
      inc.status = 'closed';
      inc.closedAt = wasClosedAt;
      inc.reopens.pop();
      inc.log.length = wasLogLength;     // truncate log to pre-reopen state
      toast('⚠ Reopen failed on backend — reverted locally.');
      renderIncidents();
    });
  }
}

export function addIncidentLog(id, kind, body) {
  const inc = state.UI_STATE.incidents.find(x=>x.id===id); if (!inc) return;
  inc.log.push({ when: new Date().toISOString(), by:'cowork-3p', kind, body });
}

