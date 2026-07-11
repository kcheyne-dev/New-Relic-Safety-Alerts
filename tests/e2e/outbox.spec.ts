import { test, expect, Page } from '@playwright/test';

/**
 * NRSA failed-send outbox smoke.
 *
 * Verifies that the outbox correctly captures a Crisis Comms send whose
 * backend persist fails, surfaces it in the UI (status-strip badge +
 * inline Log-tab chip + modal list), and clears it on both retry (with
 * backend recovered) and dismiss.
 *
 * Force-fail technique: page.route() intercepts specific POST endpoints
 * and fulfills with 500 before the request reaches the real backend.
 * Removing the route ("backend recovered") lets subsequent requests
 * (including retries) pass through normally. This keeps the test hermetic
 * — no need to actually take the backend down.
 *
 * Test data cleanup: outbox entries live in localStorage (via saveState)
 * so they'd survive across test runs and contaminate later runs. We clear
 * state.UI_STATE.outbox via addInitScript before every navigation to keep
 * runs deterministic.
 *
 * Scope: three scenarios cover the main mechanics. The 'incident-message'
 * and 'incident-create' variants of enqueueFailure share the same enqueue
 * → badge → modal → retry/dismiss pipeline as 'comms', so the standalone-
 * comms scenario proves the shared code path. Kind-specific retries
 * (especially _retryIncidentCreate) can get their own dedicated tests if
 * their retry logic evolves.
 */

const FRONTEND_URL  = process.env.NRSA_FRONTEND_URL  || 'http://localhost:8000';
const USER_EMAIL    = process.env.NRSA_USER_EMAIL    || 'kcheyne@newrelic.com';
const USER_PASSWORD = process.env.NRSA_USER_PASSWORD || 'YourChoice';

const RUN_ID = `outbox-${Date.now()}`;

test.describe('NRSA failed-outbox smoke', () => {
  test('failed comms enqueue → badge + inline chip → retry recovers → dismiss clears', async ({ page }) => {
    test.slow();   // login + multiple send cycles

    // Deterministic start: wipe any outbox entries that survived a prior
    // aborted test run before boot code reads state from localStorage.
    // Runs on every navigation which is fine — a fresh page = fresh outbox.
    await page.addInitScript(() => {
      try {
        const raw = localStorage.getItem('nrsa-state-v1');
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.UI_STATE) s.UI_STATE.outbox = [];
          localStorage.setItem('nrsa-state-v1', JSON.stringify(s));
        }
      } catch {
        /* localStorage inaccessible or malformed — safe to ignore */
      }
    });

    // ---------------------------------------------------------------
    // 1. Boot + log in
    // ---------------------------------------------------------------
    await page.goto(FRONTEND_URL);
    const loginVisible = await page.locator('#login-email')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (loginVisible) {
      await page.fill('#login-email', USER_EMAIL);
      await page.fill('#login-password', USER_PASSWORD);
      await page.click('#login-submit');
      await expect(page.locator('#login-email')).toBeHidden({ timeout: 10_000 });
    }

    // Wait for backfill so we know the app is fully wired before we start
    // manipulating the send flow.
    await page.click('#rail-alerts');
    await expect(page.locator('#feed-body .alert-card').first())
      .toBeVisible({ timeout: 15_000 });

    // Sanity: fresh outbox after the init-script wipe.
    const initialCount = await getOutboxCount(page);
    expect(initialCount, 'outbox should be empty at start').toBe(0);

    // ---------------------------------------------------------------
    // SCENARIO 1: force POST /api/comms to fail, verify outbox capture
    // ---------------------------------------------------------------
    // Route matcher targets the standalone-comms endpoint specifically —
    // we don't want to break /api/incidents (that's a different failure
    // kind and would confuse the assertions below).
    await page.route('**/api/comms', route => {
      route.fulfill({ status: 500, body: '{"error":"forced failure for outbox smoke"}' });
    });

    await page.click('#rail-crisis');
    await pickFirstOffice(page);

    // Uncheck response-required so this becomes a standalone comms send
    // (dispatchSend flow: no linkedIncidentId + no responseRequired → commsApi.send).
    const respRequired = page.locator('#resp-required');
    if (await respRequired.isChecked()) {
      await respRequired.uncheck();
    }

    const failBody = `${RUN_ID} SCENARIO 1 — forced comms failure`;
    await page.fill('#msg-body', failBody);
    await page.click('#btn-send');
    await expect(page.locator('#modal-confirm')).toBeVisible({ timeout: 5_000 });
    await page.click('#modal-confirm');

    // The .catch handler runs asynchronously after the mocked 500 lands.
    // Poll state.UI_STATE.outbox until the entry appears.
    await expect.poll(() => getOutboxCount(page), { timeout: 5_000 })
      .toBe(1);

    // Verify status-strip badge is rendered.
    const outboxBadge = page.locator('[data-ss-action="outbox"]');
    await expect(outboxBadge).toBeVisible({ timeout: 3_000 });
    await expect(outboxBadge).toContainText(/1 failed/i);

    // Verify inline chip in the Log tab. dispatchSend flips to the Log
    // tab after send, so we're already there.
    const inlineChip = page.locator('[data-outbox-retry]');
    await expect(inlineChip.first()).toBeVisible({ timeout: 3_000 });
    await expect(inlineChip.first()).toContainText(/Send failed/i);

    // ---------------------------------------------------------------
    // SCENARIO 2: retry with backend restored → entry vanishes
    // ---------------------------------------------------------------
    await page.unroute('**/api/comms');   // let requests through to the real backend

    // Retry via the inline chip in the Log tab. retryEntry sets status
    // to 'retrying' then re-renders; on success it hard-deletes the
    // entry. renderAll re-runs renderCC which reruns bindCCHandlers, so
    // the chip element gets replaced during retry — snapshot its
    // container instead and re-locate.
    await inlineChip.first().click();

    // Outbox should drain within a few seconds.
    await expect.poll(() => getOutboxCount(page), { timeout: 8_000 })
      .toBe(0);

    // Header badge should disappear once count drops to 0.
    await expect(outboxBadge).toBeHidden({ timeout: 3_000 });

    // Inline chip should be gone from the DOM.
    await expect(page.locator('[data-outbox-retry]')).toHaveCount(0);

    // ---------------------------------------------------------------
    // SCENARIO 3: force failure again, dismiss via modal → entry vanishes
    // ---------------------------------------------------------------
    await page.route('**/api/comms', route => {
      route.fulfill({ status: 500, body: '{"error":"forced failure for dismiss test"}' });
    });

    // Switch back to the Compose tab; the previous send left us on Log.
    await page.click('#panel-crisis .tab[data-cc-tab="compose"]');
    await pickFirstOffice(page);
    const failBody2 = `${RUN_ID} SCENARIO 3 — for dismiss`;
    await page.fill('#msg-body', failBody2);
    await page.click('#btn-send');
    await expect(page.locator('#modal-confirm')).toBeVisible({ timeout: 5_000 });
    await page.click('#modal-confirm');

    // Entry appears.
    await expect.poll(() => getOutboxCount(page), { timeout: 5_000 })
      .toBe(1);

    // Open the outbox modal via the status-strip chip.
    await outboxBadge.click();
    await expect(page.locator('.outbox-list')).toBeVisible({ timeout: 3_000 });

    // Verify the entry row is rendered with expected metadata.
    const outboxEntry = page.locator('.outbox-entry').first();
    await expect(outboxEntry).toBeVisible();
    await expect(outboxEntry).toContainText(/Standalone message/i);

    // Click Dismiss.
    await outboxEntry.locator('[data-ob-action="dismiss"]').click();

    // Outbox drains.
    await expect.poll(() => getOutboxCount(page), { timeout: 3_000 })
      .toBe(0);

    // The modal itself rebuilds after dismiss; with count=0, it shows the
    // empty state. Close the modal.
    await expect(page.locator('.outbox-list .empty')).toBeVisible({ timeout: 3_000 });
    await page.click('#outbox-close');
    await expect(page.locator('#modal-back')).toHaveCount(0, { timeout: 3_000 });

    // Header badge should be gone (count=0 hides it).
    await expect(outboxBadge).toBeHidden();

    // Cleanup: unroute so nothing carries into the next test file.
    await page.unroute('**/api/comms');

    // eslint-disable-next-line no-console
    console.log(`✓ outbox smoke complete — RUN_ID=${RUN_ID}`);
  });
});

/* ------------------------------ helpers ------------------------------ */

async function pickFirstOffice(page: Page): Promise<void> {
  const officeSelect = page.locator('#cc-office-pick');
  await officeSelect.waitFor({ state: 'visible' });
  const firstOption = await officeSelect.locator('option').nth(1).getAttribute('value');
  expect(firstOption, 'office picker should have at least one real option').toBeTruthy();
  await officeSelect.selectOption(firstOption!);
}

async function getOutboxCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const s = (window as any).state;
    return s?.UI_STATE?.outbox?.length ?? 0;
  });
}
