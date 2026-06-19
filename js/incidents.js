/**
 * NRSA / S.T.A.R. View — incident state-mutation helpers.
 *
 * SESSION 3 / cleanup #3 (2026-06-19): the four functions that own creating,
 * extending, and reopening incidents in STATE. They sit at the seam between
 * render code and persistence + API:
 *
 *   - createIncident: makes a new incident object (with a local `i_xxx` id),
 *     adds it to STATE.incidents, builds response shells for the affected
 *     offices, logs the create, and kicks off a fire-and-forget POST to
 *     /api/incidents. The local-id → server-UUID swap happens in the
 *     .then() callback once the round-trip completes — and that callback
 *     is also where queued messages from the dispatchSend race fix get
 *     flushed (see _pendingMessages handling).
 *
 *   - buildResponseShells: walks office employees + travelers and seeds
 *     STATE.responses[incidentId] with status='no' rows. Idempotent
 *     (skips entries that already exist) so re-calling on top up is safe.
 *
 *   - reopenIncident: flips status='open', clears closedAt, appends to
 *     reopens[], logs, persists. Reverts local state on backend rejection.
 *
 *   - addIncidentLog: append-only audit entry. Used by every state mutation
 *     on incidents (create, comm, note, close, reopen).
 *
 * BRIDGE RELIANCE:
 *   - STATE.incidents / STATE.responses (state.js bridge)
 *   - incidentsApi (api.js bridge — for fire-and-forget persist)
 *   - EMPLOYEES, TRAVELERS, OFFICES (state + constants bridges)
 *   - travelersAtOffice (helpers.js bridge)
 *   - renderIncidents, addIncidentLog (sibling — same module), toast (modals.js)
 *   - uid (helpers.js bridge — local id generation)
 *   - esc (helpers.js — for log body)
 */

export function createIncident({ title, offices, severity, description, messageId, alertId }) {
  const inc = {
    id: uid(), title, offices, severity, description, messageId, alertId: alertId || null,
    opened: new Date().toISOString(), status:'open', closedNote:null, closedAt:null,
    notes: [], log: [], messages: [],
    reopens: [],   // [{ when, by }] each time the incident is reopened
    _persistPending: !!API_BASE,   // true while the backend round-trip is in flight
  };
  STATE.incidents.unshift(inc);
  STATE.responses[inc.id] = {};
  buildResponseShells(inc.id, offices);
  addIncidentLog(inc.id, 'create', `Incident <b>${esc(title)}</b> opened.`);

  // Live mode: fire-and-forget persist to backend. We use the local client
  // ID until the server returns; on success we swap to the server-issued
  // UUID and update STATE.responses to match. On failure we log + toast
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
        STATE.responses[newId] = STATE.responses[oldId] || {};
        delete STATE.responses[oldId];
        if (STATE.selectedIncidentId === oldId) STATE.selectedIncidentId = newId;
        if (STATE.linkedIncidentId === oldId) STATE.linkedIncidentId = newId;

        // Flush any messages that were queued while this create was in
        // flight (see dispatchSend's _pendingMessages branch). Sequential
        // sends are fine — the queue is typically 1-2 entries — and serial
        // ordering preserves the operator's intended message order in the
        // incident's audit trail.
        const queued = inc._pendingMessages || [];
        inc._pendingMessages = [];
        for (const q of queued) {
          incidentsApi.sendMessage(newId, q.apiPayload).then((serverMsgId) => {
            if (serverMsgId) q.msg.id = serverMsgId;
          }).catch((e) => {
            console.warn('queued message persist failed:', e);
            toast('⚠ A queued message failed to persist to backend.');
          });
        }

        renderIncidents();
      })
      .catch((err) => {
        console.warn('incident create persist failed (kept local):', err);
        inc._persistPending = false;
        const stranded = (inc._pendingMessages || []).length;
        inc._pendingMessages = [];
        toast(stranded
          ? `⚠ Incident + ${stranded} message(s) saved locally — backend persist failed.`
          : '⚠ Incident saved locally — backend persist failed. See console.');
      });
  }

  return inc;
}

export function buildResponseShells(incidentId, offices) {
  offices.forEach(oid => {
    EMPLOYEES.filter(e => e.office === oid).forEach(e => {
      if (!STATE.responses[incidentId][e.id]) {
        STATE.responses[incidentId][e.id] = { status:'no', when:null, by:null };
      }
    });
    travelersAtOffice(oid).forEach(t => {
      const key = 'T-'+t.id;
      if (!STATE.responses[incidentId][key]) {
        STATE.responses[incidentId][key] = { status:'no', when:null, by:null, traveler:true };
      }
    });
  });
}

export function reopenIncident(incidentId) {
  const inc = STATE.incidents.find(x => x.id === incidentId); if (!inc) return;
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
  const inc = STATE.incidents.find(x=>x.id===id); if (!inc) return;
  inc.log.push({ when: new Date().toISOString(), by:'cowork-3p', kind, body });
}

