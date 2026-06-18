import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * NRSA Crisis Comms smoke harness.
 *
 * Single happy-path round trip:
 *   boot → login → backfill → alert click → real send → unlink →
 *   test toggle → test send → verify both via /api/incidents → verify badges.
 *
 * The test drives the UI for sends (matches what an operator does) and reads
 * back through /api/incidents to confirm Postgres state. Both flows produce
 * real incidents tagged with RUN_ID so the cleanup script can prune them.
 *
 * See README.md for preconditions, troubleshooting, and design notes.
 */

const FRONTEND_URL = process.env.NRSA_FRONTEND_URL || 'http://localhost:8000';
const API_URL      = process.env.NRSA_API_URL      || 'http://localhost:8080';
const USER_EMAIL   = process.env.NRSA_USER_EMAIL   || 'kcheyne@newrelic.com';
const USER_PASSWORD= process.env.NRSA_USER_PASSWORD|| 'YourChoice';

const RUN_ID = `smoke-${Date.now()}`;

test.describe('NRSA Crisis Comms smoke', () => {
  test('full round-trip: login → real send → unlink → test send → verify', async ({ page, request }) => {
    test.slow();   // 3x default timeout — login + 2 sends with API verification

    // ---------------------------------------------------------------
    // 1. Boot + log in
    // ---------------------------------------------------------------
    await page.goto(FRONTEND_URL);

    // Login modal appears only when no valid JWT is in localStorage. The
    // test should be idempotent across reruns, so detect either case.
    const loginVisible = await page.locator('#login-email')
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (loginVisible) {
      await page.fill('#login-email', USER_EMAIL);
      await page.fill('#login-password', USER_PASSWORD);
      await page.click('#login-submit');
      // Modal closes on success; #login-error appears on bad creds.
      await expect(page.locator('#login-email')).toBeHidden({ timeout: 10_000 });
    }

    // Capture the JWT for direct API verification.
    const token = await page.evaluate(() => localStorage.getItem('nrsa-jwt'));
    expect(token, 'JWT should be in localStorage after login').toBeTruthy();

    // ---------------------------------------------------------------
    // 2. Backfill — at least one alert should appear within 15s
    // ---------------------------------------------------------------
    // The Alerts panel boots collapsed; opening it surfaces the feed body
    // and forces the alert cards to render. Click the rail.
    await page.click('#rail-alerts');
    await expect(page.locator('#panel-alerts')).not.toHaveClass(/collapsed/);

    await expect(page.locator('#feed-body .alert-card').first())
      .toBeVisible({ timeout: 15_000 });
    const alertCount = await page.locator('#feed-body .alert-card').count();
    expect(alertCount, 'at least one alert should backfill').toBeGreaterThan(0);

    // Status strip "Last fetch" chip — green = ok class.
    const lastFetchChip = page.locator('.ss-chip.ok')
      .filter({ hasText: /Last fetch/i });
    await expect(lastFetchChip).toBeVisible({ timeout: 5_000 });

    // ---------------------------------------------------------------
    // 3. Click an alert
    // ---------------------------------------------------------------
    const firstAlert = page.locator('#feed-body .alert-card').first();
    await firstAlert.click();
    await expect(firstAlert).toHaveClass(/selected/);

    // ---------------------------------------------------------------
    // 4. Open Crisis Comms
    // ---------------------------------------------------------------
    await page.click('#rail-crisis');
    await expect(page.locator('#panel-crisis')).not.toHaveClass(/collapsed/);

    // Compose tab should be active (default ccTab = 'compose').
    await expect(
      page.locator('#panel-crisis .tab[data-cc-tab="compose"]')
    ).toHaveClass(/active/);

    // ---------------------------------------------------------------
    // 5. Send a real message
    // ---------------------------------------------------------------
    await pickFirstOffice(page);

    const realBody = `${RUN_ID} REAL — smoke harness real message body. Do not act; this is from the automated smoke test.`;
    await page.fill('#msg-body', realBody);

    // Test mode should be off by default.
    const testCheckbox = page.locator('#cc-test-mode');
    await expect(testCheckbox).not.toBeChecked();

    // Make sure the Send button is enabled (office picked + slack channel
    // is on by default), then send.
    const sendBtn = page.locator('#btn-send');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // The Send button opens a confirmation modal (confirmSend in index.html);
    // the actual dispatch only runs when #modal-confirm is clicked. Modal
    // shows the office / channel / recipient summary so a real operator
    // can sanity-check before pressing the button.
    await expect(page.locator('#modal-confirm')).toBeVisible({ timeout: 5_000 });
    await page.click('#modal-confirm');

    // Send flips ccTab → 'log'. Wait for that as the post-send signal.
    await expect(
      page.locator('#panel-crisis .tab[data-cc-tab="log"]')
    ).toHaveClass(/active/, { timeout: 5_000 });

    // Round-trip: poll /api/incidents until an incident exists whose
    // messages contain our tagged body. We wait on the FULL condition
    // (incident + message) rather than just incident-create, because
    // dispatchSend persists the message in a queue that flushes AFTER the
    // incident's create-promise resolves — so the incident shows up a
    // beat before its first message does.
    const { incidentId: realIncidentId, message: realMsg } =
      await waitForIncidentWithMessage(request, token!, realBody);
    expect(realIncidentId, 'real send should auto-create an incident').toBeTruthy();
    expect(realMsg.is_test, 'is_test should be false on a real send').toBe(false);
    // Real send must NOT have the [TEST] subject prefix.
    expect((realMsg.subject || '')).not.toMatch(/^\[TEST\]/);

    // ---------------------------------------------------------------
    // 6. Unlink → toggle test mode → send a test message
    // ---------------------------------------------------------------
    // Switch back to the Compose tab; click Unlink so the test toggle
    // becomes available again.
    await page.click('#panel-crisis .tab[data-cc-tab="compose"]');
    await expect(page.locator('#cc-unlink')).toBeVisible({ timeout: 3_000 });
    await page.click('#cc-unlink');

    // After unlinking the form re-renders; the test-mode row should now
    // be in the DOM.
    await expect(testCheckbox).toBeVisible({ timeout: 3_000 });
    await testCheckbox.check();
    await expect(testCheckbox).toBeChecked();

    // Send button label flips to the test variant.
    await expect(sendBtn).toContainText(/Send as Test/);

    await pickFirstOffice(page);
    const testBody = `${RUN_ID} TEST — smoke harness drill message body. Logged with is_test=true.`;
    await page.fill('#msg-body', testBody);
    await sendBtn.click();

    // Same confirmation-modal flow as the real send.
    await expect(page.locator('#modal-confirm')).toBeVisible({ timeout: 5_000 });
    await page.click('#modal-confirm');

    // Round-trip the test send the same way: wait until the test message
    // body shows up in some incident's persisted messages. Exclude the real
    // incident's id so we don't accidentally match the previous send.
    const { incidentId: testIncidentId, message: testMsg } =
      await waitForIncidentWithMessage(request, token!, testBody, [realIncidentId]);
    expect(testIncidentId, 'test send should auto-create a second incident').toBeTruthy();
    expect(testIncidentId).not.toBe(realIncidentId);
    expect(testMsg.is_test, 'is_test should be true on a test send').toBe(true);
    expect(testMsg.subject || '', 'subject should carry [TEST] prefix').toMatch(/^\[TEST\]/);
    expect(testMsg.body, 'body should include the drill-warning preamble').toContain('TEST DRILL');

    // ---------------------------------------------------------------
    // 7. Render verification — badges should appear on the right surfaces
    // ---------------------------------------------------------------
    await page.click('#rail-incident');
    await expect(page.locator('#panel-incident')).not.toHaveClass(/collapsed/);

    // The TEST incident card should carry the cyan test-badge.
    const testCard = page.locator(`.incident-row[data-id="${testIncidentId}"]`);
    await expect(testCard).toBeVisible();
    await expect(testCard.locator('.test-badge')).toBeVisible();

    // The REAL incident card should NOT have a test-badge (sanity check).
    const realCard = page.locator(`.incident-row[data-id="${realIncidentId}"]`);
    await expect(realCard).toBeVisible();
    await expect(realCard.locator('.test-badge')).toHaveCount(0);

    // Click the test incident, switch to its Comms tab, verify the message
    // row carries the inline 🧪 Test badge AND the is-test class for tinting.
    await testCard.click();
    await page.click('[data-i-tab="comms"]');

    const testCommCard = page.locator('.comm-card.is-test').first();
    await expect(testCommCard).toBeVisible();
    await expect(testCommCard.locator('.test-badge')).toContainText(/Test/i);

    // ---------------------------------------------------------------
    // 8. Sprint 5 phase 6 — full lifecycle: note → close → reopen
    // ---------------------------------------------------------------
    // The test incident is currently selected (we clicked it in step 7).
    // Switch to the Notes tab and add a tagged note, verify it round-trips.
    await page.click('[data-i-tab="notes"]');
    await expect(page.locator('#note-input')).toBeVisible({ timeout: 3_000 });
    const noteText = `${RUN_ID} smoke note for Phase 6 lifecycle verification`;
    await page.fill('#note-input', noteText);
    await page.click('#note-add');

    // Note persists fire-and-forget; poll the incident detail until it
    // shows up on the server.
    await pollUntil(
      async () => {
        const d = await fetchIncident(request, token!, testIncidentId);
        return (d.notes || []).some((n: any) => n.body?.includes(noteText));
      },
      'note should round-trip to /api/incidents/:id/notes',
    );

    // Close the incident from the Details tab. The Close flow opens a modal
    // (#close-note + #modal-confirm) — same pattern as the Send confirmation.
    await page.click('[data-i-tab="details"]');
    await expect(page.locator('#btn-close-inc')).toBeVisible({ timeout: 3_000 });
    await page.click('#btn-close-inc');
    await expect(page.locator('#close-note')).toBeVisible({ timeout: 3_000 });
    await page.fill('#close-note', `${RUN_ID} smoke close-note for Phase 6`);
    await page.click('#modal-confirm');

    // Verify status=closed via the API.
    await pollUntil(
      async () => {
        const d = await fetchIncident(request, token!, testIncidentId);
        return d.incident?.status === 'closed';
      },
      'incident status should flip to closed on /api/incidents/:id/close',
    );

    // Reopen. Single click — no confirmation modal on the reopen path.
    await expect(page.locator('#btn-reopen-inc')).toBeVisible({ timeout: 3_000 });
    await page.click('#btn-reopen-inc');

    // Verify status=open via the API.
    await pollUntil(
      async () => {
        const d = await fetchIncident(request, token!, testIncidentId);
        return d.incident?.status === 'open';
      },
      'incident status should flip back to open on /api/incidents/:id/reopen',
    );

    // Final receipt — useful when grepping smoke output later.
    // eslint-disable-next-line no-console
    console.log(`✓ smoke complete — RUN_ID=${RUN_ID}  real=${realIncidentId}  test=${testIncidentId}`);
  });
});

/* ------------------------------ helpers ------------------------------ */

async function pickFirstOffice(page: Page): Promise<void> {
  // The office picker is a single <select>; selecting a non-empty option
  // fires a change handler that pushes the office id into STATE.selectedOffices
  // and re-renders the form.
  const officeSelect = page.locator('#cc-office-pick');
  await officeSelect.waitFor({ state: 'visible' });
  // Skip the placeholder option at index 0; pick whatever is next.
  const firstOption = await officeSelect.locator('option').nth(1).getAttribute('value');
  expect(firstOption, 'office picker should have at least one real option').toBeTruthy();
  await officeSelect.selectOption(firstOption!);
}

async function fetchIncident(
  request: APIRequestContext,
  token: string,
  incidentId: string,
): Promise<any> {
  const resp = await request.get(`${API_URL}/api/incidents/${incidentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(resp.ok(), `GET /api/incidents/${incidentId} should succeed (got ${resp.status()})`).toBeTruthy();
  return await resp.json();
}

/**
 * Generic polling helper — repeatedly invokes `predicate` until it returns
 * true, with a 5s default timeout. Used for fire-and-forget API mutations
 * (notes, close, reopen) where the UI optimistically advances before the
 * server has acknowledged. Throws with the supplied label on timeout.
 */
async function pollUntil(
  predicate: () => Promise<boolean>,
  label: string,
  timeoutMs = 5_000,
  intervalMs = 250,
): Promise<void> {
  const max = Math.floor(timeoutMs / intervalMs);
  for (let i = 0; i < max; i++) {
    if (await predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out (${timeoutMs}ms): ${label}`);
}

/**
 * Poll /api/incidents?status=open until an incident exists whose `messages`
 * contain the given body substring. Returns both the incident id and the
 * matched message row. Fails after ~15s.
 *
 * Why message-aware (not just incident-aware): the frontend's createIncident
 * resolves as soon as the incident row is persisted. Its first message is
 * sent on a SEPARATE round-trip from the queue/flush path in dispatchSend,
 * which means the incident is observable in the API a beat before its
 * messages are. A simpler "wait for new incident" probe races that gap and
 * sometimes fetches detail before the message has landed.
 *
 * @param bodyMatch  — substring of the persisted message body. Use a unique
 *                     RUN_ID-tagged string so this never matches stale rows.
 * @param excludeIds — incident ids to skip (e.g., the prior send's incident
 *                     when waiting for the SECOND send).
 */
async function waitForIncidentWithMessage(
  request: APIRequestContext,
  token: string,
  bodyMatch: string,
  excludeIds: string[] = [],
): Promise<{ incidentId: string; message: any }> {
  for (let i = 0; i < 30; i++) {
    const list = await request.get(`${API_URL}/api/incidents?status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (list.ok()) {
      const data = await list.json();
      const incidents: Array<{ id: string; created_at: string }> = data.incidents || [];
      // Newest first — most likely to be the one we just created.
      incidents.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      for (const inc of incidents) {
        if (excludeIds.includes(inc.id)) continue;
        const det = await request.get(`${API_URL}/api/incidents/${inc.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (det.ok()) {
          const detail = await det.json();
          const msg = (detail.messages || []).find((m: any) => m.body?.includes(bodyMatch));
          if (msg) return { incidentId: inc.id, message: msg };
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(
    `waitForIncidentWithMessage: no incident with message containing "${bodyMatch.slice(0, 60)}…" appeared within 15s. ` +
    'Either the send was skipped, the queue/flush race regressed, or the backend is not persisting.'
  );
}
