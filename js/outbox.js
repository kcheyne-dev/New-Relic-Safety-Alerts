/**
 * NRSA / S.T.A.R. View — failed-send outbox.
 *
 * Introduced 2026-07-13 (post-bridge-cleanup, first product-work session).
 * Every Crisis Comms send that fails backend persist gets enqueued here so
 * the operator has a durable trail + can retry when the backend recovers.
 * Without this module, failures manifested as a one-shot toast and then
 * silent data loss — the smoke harness caught one such race condition
 * back in June (see MEMORY.md); this closes the class of hole for real.
 *
 * Three failure kinds get captured:
 *
 *   'comms'             — standalone Crisis send (no linked incident);
 *                          commsApi.send() rejected.
 *   'incident-message'  — send tied to an already-persisted incident;
 *                          incidentsApi.sendMessage() rejected.
 *   'incident-create'   — the whole incident-create round-trip failed,
 *                          stranding both the incident and any messages
 *                          that were queued while it was in flight.
 *
 * Auto-retry policy (per the 2026-07-13 design conversation):
 *   - One silent retry per entry per session (tracked in-memory via the
 *     _attemptedThisSession Set — resets on reload so a returning
 *     operator gets a fresh sweep).
 *   - Triggered on boot after loadState() + at the top of every dispatchSend.
 *   - After the auto-retry either succeeds (silent dismiss) or fails
 *     (entry stays for manual retry).
 *
 * UI surface (built in outbox #3 + #4):
 *   - Header badge chip when outboxCount() > 0 → opens full-list modal
 *   - Inline "⚠ Send failed — Retry" chips in the Crisis Comms Log tab
 *     next to each affected message row (matched by msg.id → entry.msgId)
 *
 * Retention: entries live until the operator dismisses them (no auto-purge).
 * On successful retry (auto or manual), the entry is hard-deleted.
 *
 * Persistence: entries live at state.UI_STATE.outbox, so the normal
 * saveState() debounce carries them across reloads for free.
 */

import { state } from './state.js';
import { esc, uid } from './helpers.js';
import { API_BASE, commsApi, incidentsApi } from './api.js';
import { closeModal, showModal, toast } from './modals.js';
import { saveState } from './persistence.js';
import { renderAll } from './render.js';

/* Per-session guard: entries we've already auto-retried this page load,
   so we don't hammer the backend across multiple dispatchSend calls or
   between boot-flush and the first send. In-memory (Set), reset on reload
   by construction — a fresh page load re-attempts every stale entry. */
const _attemptedThisSession = new Set();

/**
 * How many failed sends are queued? Used by the header badge to decide
 * whether to render itself. Live count from state; badge re-renders after
 * every enqueue / dismiss / successful retry.
 */
export function outboxCount() {
  return state.UI_STATE.outbox.length;
}

/**
 * Push a new failed-send entry onto the outbox and re-render.
 * `entry` should contain: kind, msgId, display, plus payload fields
 * appropriate to the kind. We fill in id, when, attempts, status,
 * and lastError from `err` (if provided).
 */
export function enqueueFailure(entry, err) {
  const now = new Date().toISOString();
  const record = {
    id: 'ob_' + uid().slice(2),   // ob_XXX; helpers.uid gives i_XXX, strip prefix
    when: now,
    attempts: 0,
    status: 'pending',
    lastError: err ? (err.message || String(err)) : 'Backend persist failed',
    ...entry,
  };
  state.UI_STATE.outbox.push(record);
  saveState();
  renderAll();
  return record;
}

/**
 * Remove an entry by id. Hard-delete — no soft-archive. Called both by
 * successful retries (silent) and by operator [Dismiss] clicks. Idempotent
 * (dismissing a not-found id is a no-op).
 */
export function dismissEntry(id) {
  const before = state.UI_STATE.outbox.length;
  state.UI_STATE.outbox = state.UI_STATE.outbox.filter(e => e.id !== id);
  if (state.UI_STATE.outbox.length !== before) {
    saveState();
    renderAll();
  }
}

/**
 * Retry one outbox entry. Async fire-and-forget — caller doesn't await.
 * On success: silent dismiss. On failure: bump attempts + lastError,
 * mark status='failed', keep in outbox. Callers include operator
 * [Retry] button clicks and autoRetryPending() sweeps.
 *
 * If API_BASE is empty (mock mode), we bail early: retries are meaningless
 * because there's no backend to persist to.
 */
export async function retryEntry(id) {
  if (!API_BASE) return;
  const entry = state.UI_STATE.outbox.find(e => e.id === id);
  if (!entry) return;

  entry.status = 'retrying';
  renderAll();

  try {
    if (entry.kind === 'comms') {
      await commsApi.send(entry.apiPayload);
    } else if (entry.kind === 'incident-message') {
      await incidentsApi.sendMessage(entry.incidentId, entry.apiPayload);
    } else if (entry.kind === 'incident-create') {
      await _retryIncidentCreate(entry);
    } else {
      throw new Error(`Unknown outbox entry kind: ${entry.kind}`);
    }
    // Success: hard-delete and re-render.
    dismissEntry(id);
  } catch (err) {
    entry.attempts += 1;
    entry.lastError = err.message || String(err);
    entry.status = 'failed';
    saveState();
    renderAll();
  }
}

/**
 * Sweep the outbox and fire one silent retry per entry we haven't already
 * tried this session. Called on boot (after loadState) and at the top of
 * every dispatchSend. Fire-and-forget per entry.
 *
 * The per-session guard is critical: without it, every dispatchSend during
 * a stuck backend would kick off retries for every stale entry, hammering
 * a backend that just told us "no". Once per session is the right budget
 * for "backend probably recovered, try once quietly."
 */
export function autoRetryPending() {
  if (!API_BASE) return;
  for (const entry of state.UI_STATE.outbox) {
    if (_attemptedThisSession.has(entry.id)) continue;
    _attemptedThisSession.add(entry.id);
    retryEntry(entry.id);   // fire-and-forget
  }
}

/**
 * Retry an 'incident-create' entry: create the incident on the backend,
 * swap the local id → server id in state (mirroring the original
 * .then() branch in incidents.js createIncident), then flush any messages
 * that were stranded when the original create failed. Failed message
 * flushes become their own 'incident-message' outbox entries.
 */
async function _retryIncidentCreate(entry) {
  // 1. Create the incident on backend.
  const serverInc = await incidentsApi.create(entry.incidentCreatePayload);

  // 2. Find the local incident and swap ids. If the operator manually
  //    closed / deleted the local row in the meantime, we still succeeded
  //    on the backend — just log a note and skip the local swap.
  const localInc = state.UI_STATE.incidents.find(x => x.id === entry.localIncidentId);
  if (localInc) {
    const oldId = localInc.id;
    const newId = serverInc.id;
    if (oldId !== newId) {
      localInc.id = newId;
      localInc.opened = serverInc.opened;
      localInc._persistPending = false;
      state.UI_STATE.responses[newId] = state.UI_STATE.responses[oldId] || {};
      delete state.UI_STATE.responses[oldId];
      if (state.UI_STATE.selectedIncidentId === oldId) state.UI_STATE.selectedIncidentId = newId;
      if (state.UI_STATE.linkedIncidentId === oldId) state.UI_STATE.linkedIncidentId = newId;
    }
  } else {
    console.warn('_retryIncidentCreate: local incident', entry.localIncidentId, 'gone by retry time; backend row exists as', serverInc.id);
  }

  // 3. Flush queued messages. Each is best-effort; failures become their
  //    own outbox entries so nothing goes silent.
  const queued = entry.queuedMessages || [];
  for (const q of queued) {
    try {
      const serverMsgId = await incidentsApi.sendMessage(serverInc.id, q.apiPayload);
      if (q.msg && serverMsgId) q.msg.id = serverMsgId;
    } catch (msgErr) {
      enqueueFailure({
        kind: 'incident-message',
        incidentId: serverInc.id,
        apiPayload: q.apiPayload,
        msgId: q.msg?.id ?? null,
        display: q.display || {
          subject: q.apiPayload?.subject || `[${q.apiPayload?.templateName || 'Custom'}]`,
          offices: q.apiPayload?.offices || [],
          channels: q.apiPayload?.channels || [],
          reach: q.apiPayload?.recipientsCount || 0,
          isTest: !!q.apiPayload?.isTest,
        },
      }, msgErr);
    }
  }

  toast(`✓ Incident + ${queued.length} message${queued.length === 1 ? '' : 's'} recovered from outbox.`);
}

/**
 * Look up a failed-outbox entry by msg.id. Used by renderCCLog to decide
 * whether to append a "⚠ Send failed — Retry" chip to a message row.
 * Returns the entry object or undefined. Only 'comms' and 'incident-message'
 * entries carry msgId; 'incident-create' entries carry the ORIGINAL
 * messageId that triggered the create, if any.
 */
export function outboxEntryForMsg(msgId) {
  if (!msgId) return undefined;
  return state.UI_STATE.outbox.find(e => e.msgId === msgId);
}

/**
 * Small inline HTML chip for the Log tab, shown next to a message that's
 * queued in the outbox. Click triggers retryEntry(); render.js's re-render
 * on state change will make the chip disappear once retry succeeds.
 */
export function outboxChipHTML(entryId) {
  return `<button class="outbox-chip" data-outbox-retry="${esc(entryId)}" title="This send failed to persist to backend. Click to retry.">⚠ Send failed — Retry</button>`;
}

/**
 * Full-list outbox modal. Shows each queued entry with its display info,
 * attempts count, last error, and per-row [Retry] + [Dismiss] buttons.
 * Auto-rebuilds itself after any button click so state stays in sync.
 */
export function showOutboxModal() {
  const entries = state.UI_STATE.outbox.slice().reverse();   // newest first
  const html = entries.length
    ? entries.map(_outboxRowHTML).join('')
    : '<div class="empty" style="padding:20px;text-align:center;color:var(--muted)">No failed sends. Everything made it through.</div>';

  showModal(`
    <h3>Failed sends — Outbox</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px">
      Sends the backend rejected or couldn't be reached. Retry when the backend recovers, or dismiss to clear.
      ${entries.length ? `<b>${entries.length}</b> queued.` : ''}
    </p>
    <div class="outbox-list" style="max-height:60vh;overflow-y:auto">${html}</div>
    <div class="modal-actions">
      <button class="btn-ghost" id="outbox-close">Close</button>
    </div>
  `);

  document.getElementById('outbox-close').onclick = closeModal;

  // Wire per-row retry / dismiss buttons. Use event delegation to survive
  // the rebuild after each action.
  const listEl = document.querySelector('.outbox-list');
  if (listEl) {
    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-ob-action]');
      if (!btn) return;
      const id = btn.dataset.obId;
      if (btn.dataset.obAction === 'retry') {
        btn.disabled = true;
        btn.textContent = 'Retrying…';
        await retryEntry(id);
        // Rebuild the modal in place so the row goes away on success or
        // updates attempts/lastError on failure.
        _rebuildOutboxModal();
      } else if (btn.dataset.obAction === 'dismiss') {
        dismissEntry(id);
        _rebuildOutboxModal();
      }
    });
  }
}

function _outboxRowHTML(e) {
  const kindLabel = e.kind === 'comms' ? 'Standalone message'
                  : e.kind === 'incident-message' ? 'Incident message'
                  : 'Incident create';
  const d = e.display || {};
  const offices = (d.offices || []).map(o => `<span class="src-pill">${esc(o)}</span>`).join('');
  const channels = (d.channels || []).map(c => `<span class="src-pill">${esc(c)}</span>`).join('');
  const reach = d.reach ? `<span class="src-pill">${d.reach.toLocaleString()} recipients</span>` : '';
  const testBadge = d.isTest ? '<span class="test-badge" title="Drill mode — routed to test channel">🧪 Test</span>' : '';
  const attempts = e.attempts > 0 ? ` · ${e.attempts} previous ${e.attempts === 1 ? 'retry' : 'retries'}` : '';
  const when = new Date(e.when).toLocaleString();
  return `
    <div class="outbox-entry" data-ob-entry-id="${esc(e.id)}" style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
      <div style="font-size:11px;color:var(--muted)">
        <b>${esc(kindLabel)}</b> · ${esc(when)}${attempts} ${testBadge}
      </div>
      ${d.subject ? `<div style="font-weight:600;font-size:12px;margin:4px 0">${esc(d.subject)}</div>` : ''}
      <div style="font-size:11px;margin:4px 0">
        ${offices}${channels}${reach}
      </div>
      <div style="font-size:11px;color:var(--red);margin-top:4px" title="${esc(e.lastError || '')}">
        ${esc((e.lastError || '').slice(0, 120))}${(e.lastError || '').length > 120 ? '…' : ''}
      </div>
      <div class="modal-actions" style="margin-top:8px">
        <button class="btn-ghost" data-ob-action="dismiss" data-ob-id="${esc(e.id)}">Dismiss</button>
        <button class="btn-primary" style="width:auto;margin:0;padding:6px 12px" data-ob-action="retry" data-ob-id="${esc(e.id)}">Retry</button>
      </div>
    </div>`;
}

function _rebuildOutboxModal() {
  // The modal-back overlay stays; we just replace the inner modal HTML.
  // Same technique as bindRiskModalHandlers uses for the risk-search
  // debounce re-render in modals.js.
  if (document.getElementById('modal-back')) {
    closeModal();
    showOutboxModal();
  }
}
