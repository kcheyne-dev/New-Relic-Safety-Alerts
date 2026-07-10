import { test, expect, Page } from '@playwright/test';

/**
 * NRSA proximity-detection smoke harness.
 *
 * The Crisis Comms smoke covers the UI flow downstream of detection. This
 * spec covers the math UPSTREAM — the engine behind Q1 (Office threat) and
 * Q2 (Traveler threat). If `enrichEventWithImpact` or `relevanceTierOf`
 * silently break, an event near an office could fail to surface; the
 * existing smoke would still pass because it seeds an alert with
 * affectedOfficeIds already set. This spec asserts the detection itself.
 *
 * Four test cases:
 *   1. DIRECT   — event near SFO, fired via the 🧪 Tests modal Office scenario
 *   2. WATCH    — sev=ext at Pacific midpoint (no office, no presence country),
 *                 hidden by default, surfaces under 🌐 All toggle
 *   3. INDIRECT — sev=high in Brazil (presence country, no office), visible
 *                 by default, amber chip
 *   4. DIRECT via traveler-in-radius — alert at a mock traveler's location
 *                 (Singapore, no NR office within 3000km), verifies
 *                 `state.TRAVELERS.filter(...)` in enrichEventWithImpact
 *                 populates affectedTravelers correctly after the 2026-07-03
 *                 batch-C bridge cleanup migration. Added post-batch-C code
 *                 review to close the state.TRAVELERS verification gap.
 *
 * Hybrid injection: Test 1 uses the existing UI affordance (Tests modal)
 * because that exercises both the detection path AND the operator's actual
 * surface for synthetic injection. Tests 2/3/4 use page.evaluate to push
 * directly through `window.enrichEventWithImpact + ALERTS + renderAll`
 * because the Tests modal doesn't have premade Watch / Indirect / Traveler
 * scenarios and adding them would expand operator-facing surface area
 * unnecessarily.
 *
 * The spec runs in mock mode (#api=mock) so it doesn't need a live backend
 * or login — purely tests the frontend detection logic.
 *
 * See README.md for preconditions (frontend served on :8000) and design notes.
 */

const FRONTEND_URL = process.env.NRSA_FRONTEND_URL || 'http://localhost:8000';

test.describe('NRSA proximity-detection smoke', () => {

  test.beforeEach(async ({ page }) => {
    // Mock mode boots without auth and runs the demo + Tests scenarios IIFEs.
    await page.goto(`${FRONTEND_URL}/index.html#api=mock`);

    // Wait for the demo bootstrap to finish — Tests pill appears at the
    // tail of bootTestScenarios(), which runs after bootDemoMode() seeds
    // ALERTS / TRAVELERS / EMPLOYEES. Once #test-launcher is visible, the
    // detection pipeline is ready to receive injections.
    await expect(page.locator('#test-launcher')).toBeVisible({ timeout: 10_000 });
  });

  test.afterEach(async ({ page }) => {
    // Clear any synthetic events the test injected so reruns are isolated.
    // Both `test-*` (Tests modal scenarios) and our page.evaluate-injected
    // alerts are matched.
    await page.evaluate(() => {
      if (Array.isArray(window.ALERTS)) {
        window.ALERTS = window.ALERTS.filter((a: any) =>
          !String(a.id).startsWith('test-') && !String(a.id).startsWith('proximity-')
        );
        if (typeof window.renderAll === 'function') window.renderAll();
      }
    });
  });

  // ---------------------------------------------------------------
  // 1. DIRECT — Tests modal Office scenario near SFO
  // ---------------------------------------------------------------
  test('DIRECT tier: Office threat scenario surfaces SFO impact + red chip', async ({ page }) => {
    await fireOfficeThreatScenario(page);

    // The Office scenario injects an alert with `id` prefixed `test-office-`.
    // Open the Alerts panel and find the card for that id.
    await page.click('#rail-alerts');
    await expect(page.locator('#panel-alerts')).not.toHaveClass(/collapsed/);

    const officeAlertCard = page.locator('#feed-body .alert-card[data-id^="test-office-"]').first();
    await expect(officeAlertCard).toBeVisible({ timeout: 5_000 });

    // The DIRECT chip — relevanceTierOf returned 'direct' because SFO
    // (37.78, -122.39) is within the 200km radius of the injected alert
    // at (37.84, -122.09).
    await expect(officeAlertCard.locator('.tier-chip.direct')).toBeVisible();
    await expect(officeAlertCard.locator('.tier-chip.direct')).toContainText('Direct');

    // SFO impact badge — enrichEventWithImpact should have added SFO to
    // affectedOfficeIds via the proximity check (the alert's officeId is
    // also 'SFO', so this is a belt-and-suspenders assertion that the
    // pipeline didn't dedupe it away).
    const sfoBadge = officeAlertCard.locator('.impact-badge.impact-office', { hasText: 'SFO' });
    await expect(sfoBadge).toBeVisible();

    // The card should be visible in the DEFAULT view (officeRelevantOnly=true).
    // Direct alerts ARE relevant by definition; if this assertion fails,
    // either `isRelevant` calculation broke or `passesFilter` regressed.
    const isRelevantByDefault = await page.evaluate(() => {
      const a = (window.ALERTS || []).find((x: any) => String(x.id).startsWith('test-office-'));
      return a ? { tier: a.relevanceTier, isRelevant: a.isRelevant, sevFilter: window.STATE?.officeRelevantOnly } : null;
    });
    expect(isRelevantByDefault).not.toBeNull();
    expect(isRelevantByDefault!.tier).toBe('direct');
    expect(isRelevantByDefault!.isRelevant).toBe(true);
    expect(isRelevantByDefault!.sevFilter).toBe(true);  // default
  });

  // ---------------------------------------------------------------
  // 2. WATCH — sev=ext at Pacific midpoint, no NR overlap
  // ---------------------------------------------------------------
  test('WATCH tier: sev=ext with no office/presence overlap is hidden by default, visible under 🌐 All', async ({ page }) => {
    // Inject an alert at lat=0, lng=180 (Pacific Ocean far from any NR
    // office or presence country), sev='ext', no officeId, no country in
    // title/location.
    const tier = await injectAlert(page, {
      id: 'proximity-watch-' + Date.now(),
      sev: 'ext',
      type: 'Natural Disaster',
      source: 'USGS',
      lat: 0,
      lng: 180,
      radiusKm: 100,
      title: 'M7.2 earthquake — submarine, mid-Pacific',
      location: 'Pacific Ocean',
      summary: 'Deep-ocean tremor, no land impact, no tsunami advisory.',
      issued: new Date().toISOString(),
    });
    expect(tier).toBe('watch');

    // Open the Alerts panel.
    await page.click('#rail-alerts');
    await expect(page.locator('#panel-alerts')).not.toHaveClass(/collapsed/);

    const watchCard = page.locator('#feed-body .alert-card[data-id^="proximity-watch-"]');

    // DEFAULT view: officeRelevantOnly=true. Watch alerts are NOT
    // relevant (only direct + indirect are), so passesFilter rejects.
    // The card should not be in the rendered feed body.
    await expect(watchCard).toHaveCount(0);

    // Toggle to 🌐 All via the status-strip chip.
    const relevanceToggle = page.locator('[data-ss-action="toggle-relevance"]');
    await expect(relevanceToggle).toBeVisible();
    await relevanceToggle.click();

    // Now the watch card should appear with the blue 👁 Watch chip.
    await expect(watchCard).toBeVisible({ timeout: 3_000 });
    await expect(watchCard.locator('.tier-chip.watch')).toBeVisible();
    await expect(watchCard.locator('.tier-chip.watch')).toContainText('Watch');

    // No office/traveler badges — the alert has no office overlap.
    await expect(watchCard.locator('.impact-badge.impact-office')).toHaveCount(0);
    await expect(watchCard.locator('.impact-badge.impact-trav')).toHaveCount(0);

    // Restore default toggle so afterEach cleanup runs against the
    // same starting state next test.
    await relevanceToggle.click();
  });

  // ---------------------------------------------------------------
  // 3. INDIRECT — sev=high in Brazil (presence country, no office)
  // ---------------------------------------------------------------
  test('INDIRECT tier: sev=high in a presence country with no office surfaces with amber chip, visible by default', async ({ page }) => {
    // Confirm Brazil is in COUNTRY_PRESENCE before relying on it. If a
    // future change drops Brazil, the test should fail loudly with a
    // clear message rather than silently mis-categorize.
    const presenceCountries = await page.evaluate(() =>
      (window.COUNTRY_PRESENCE || []).map((cp: any) => ({ name: cp.name, hasOffice: cp.hasOffice }))
    );
    const brazil = presenceCountries.find((c: any) => c.name === 'Brazil');
    expect(brazil, 'Brazil should be in COUNTRY_PRESENCE for this test to be meaningful').toBeTruthy();
    expect(brazil!.hasOffice, 'Brazil should NOT be an office country (test asserts indirect tier)').toBe(false);

    // Inject an alert at São Paulo coordinates. The alert has no officeId
    // and no affectedOfficeIds; alertCountryFor will fall back to text
    // matching against COUNTRY_PRESENCE names — "Brazil" appears in both
    // the title and location.
    const tier = await injectAlert(page, {
      id: 'proximity-indirect-' + Date.now(),
      sev: 'high',
      type: 'Civil Unrest',
      source: 'GDELT',
      lat: -23.55,
      lng: -46.63,
      radiusKm: 50,
      title: 'Large protest forming in São Paulo, Brazil',
      location: 'São Paulo, Brazil',
      summary: 'Reports of crowd buildup near Avenida Paulista. Police presence increasing.',
      issued: new Date().toISOString(),
    });
    expect(tier).toBe('indirect');

    // Open the Alerts panel.
    await page.click('#rail-alerts');
    await expect(page.locator('#panel-alerts')).not.toHaveClass(/collapsed/);

    const indirectCard = page.locator('#feed-body .alert-card[data-id^="proximity-indirect-"]');

    // DEFAULT view (officeRelevantOnly=true): indirect alerts ARE relevant
    // and SHOULD be visible. If this fails, either `isRelevant` is no
    // longer including 'indirect' or `passesFilter` regressed.
    await expect(indirectCard).toBeVisible({ timeout: 3_000 });
    await expect(indirectCard.locator('.tier-chip.indirect')).toBeVisible();
    await expect(indirectCard.locator('.tier-chip.indirect')).toContainText('In-country');

    // No office badge — Brazil has no office, just NR presence. Travelers
    // could match if a mock traveler happens to be in Brazil; we don't
    // assert on absence of trav badge to avoid coupling to demo seed data.
    await expect(indirectCard.locator('.impact-badge.impact-office')).toHaveCount(0);
  });

  // ---------------------------------------------------------------
  // 4. DIRECT via traveler-in-radius — no office match, only traveler
  // ---------------------------------------------------------------
  //
  // Added post-batch-C bridge cleanup (2026-07-03) to close a verification
  // gap the code review flagged: the existing 3 cases don't exercise
  // `state.TRAVELERS.filter(t => distanceKm(...) <= radiusKm)` in
  // enrichEventWithImpact. If the state.TRAVELERS access ever silently
  // breaks (e.g., a future refactor accidentally reads a snapshot instead
  // of the live singleton), this test fails loudly with an empty
  // affectedTravelers array.
  //
  // Note on the other flagged branch: relevanceTierOf line ~359 —
  //   `if (state.TRAVELERS.some(t => t.country === country)) return 'indirect';`
  // is currently UNREACHABLE dead code, because alertCountryFor only ever
  // returns country names from COUNTRY_PRESENCE (via text match) or from
  // OFFICE_BY_ID (via officeId). Any country name it returns is either
  // caught by the earlier COUNTRY_PRESENCE.some(...) check OR belongs to
  // an office, in which case branch 1 (affectedOfficeIds > 0) fires first.
  // Keeping the branch as a defensive fallback for future changes to
  // alertCountryFor's country-resolution logic. No test covers it because
  // there's no legitimate path through the public API that reaches it.
  test('DIRECT tier via traveler-in-radius: no office match but a mock traveler within radius', async ({ page }) => {
    // Pick a stable mock traveler far from any NR office. `t1` (A. Patel)
    // in Singapore is ideal: no NR office in Singapore, closest office
    // (BLR) is ~3300km away — well outside our 100km alert radius.
    const seedTraveler = await page.evaluate(() =>
      (window.TRAVELERS || []).find((t: any) => t.id === 't1') || null,
    );
    expect(seedTraveler, 'Mock TRAVELERS should include t1 (Singapore) — seeded via bootDemoMode').toBeTruthy();
    expect(typeof seedTraveler.lat).toBe('number');
    expect(typeof seedTraveler.lng).toBe('number');

    // Inject alert AT the traveler's location. Title/location deliberately
    // avoid any country name — this ensures alertCountryFor returns null
    // (no text match against COUNTRY_PRESENCE), so the tier decision falls
    // through to affectedTravelers being non-empty (branch 2 of
    // relevanceTierOf: `affectedTravelers > 0 → 'direct'`).
    const tier = await injectAlert(page, {
      id: 'proximity-trav-direct-' + Date.now(),
      sev: 'high',
      type: 'Natural Disaster',
      source: 'USGS',
      lat: seedTraveler.lat,
      lng: seedTraveler.lng,
      radiusKm: 100,
      title: 'M5.8 submarine tremor near travel corridor',
      location: 'Ocean',   // no country name
      summary: 'Seismic activity near ongoing business travel.',
      issued: new Date().toISOString(),
    });
    expect(tier).toBe('direct');

    // THE key assertion: enrichEventWithImpact must have populated
    // affectedTravelers with t1's id via `state.TRAVELERS.filter(...)`.
    // If the batch-C migration accidentally broke that read, this
    // affectedTravelers array is empty and the test fails.
    const enriched = await page.evaluate(() =>
      (window.ALERTS || []).find((a: any) =>
        String(a.id).startsWith('proximity-trav-direct-'),
      ),
    );
    expect(enriched, 'injected alert should be findable in window.ALERTS').toBeTruthy();
    expect(enriched.affectedTravelers, 'state.TRAVELERS.filter should populate affectedTravelers with t1').toContain('t1');
    expect(enriched.affectedOfficeIds, 'no NR office within 100km of Singapore').toEqual([]);

    // UI-side: card should render with the Direct chip and traveler impact
    // badge (belt-and-suspenders — proves the render pipeline honors the
    // affectedTravelers array).
    await page.click('#rail-alerts');
    await expect(page.locator('#panel-alerts')).not.toHaveClass(/collapsed/);
    const travCard = page.locator('#feed-body .alert-card[data-id^="proximity-trav-direct-"]');
    await expect(travCard).toBeVisible({ timeout: 3_000 });
    await expect(travCard.locator('.tier-chip.direct')).toBeVisible();
    await expect(travCard.locator('.impact-badge.impact-trav')).toBeVisible();
  });
});

// =================================================================
// Helpers
// =================================================================

/**
 * Click through the 🧪 Tests modal → Office threat scenario. The scenario
 * injects an M6.5 quake near SFO via demo.js's `fireOfficeThreat()`. The
 * modal closes itself on click; the injected alert is named `test-office-*`.
 */
async function fireOfficeThreatScenario(page: Page) {
  await page.click('#test-launcher');
  // Modal renders with 3 scenario buttons + clear + close.
  await expect(page.locator('#test-office-btn')).toBeVisible({ timeout: 3_000 });
  await page.click('#test-office-btn');
  // fireOfficeThreat closes the modal via App.closeModal() at the end.
  await expect(page.locator('#test-office-btn')).toBeHidden({ timeout: 3_000 });
}

/**
 * Inject a synthetic alert directly through the bridged window globals.
 * Returns the computed `relevanceTier` so the caller can assert the
 * detection-pipeline output before checking the DOM.
 *
 * The alert flows through `enrichEventWithImpact` → `relevanceTierOf` (sets
 * affectedOfficeIds, affectedTravelers, totalEmployeesAffected, relevanceTier,
 * isRelevant), then is appended to `window.ALERTS` (the bridge's getter/setter
 * routes the assignment to `state.ALERTS`), then `renderAll()` re-renders.
 */
async function injectAlert(page: Page, alert: any): Promise<string | null> {
  return await page.evaluate((a: any) => {
    if (typeof window.enrichEventWithImpact !== 'function') {
      throw new Error('window.enrichEventWithImpact not found — bridge missing or page not booted');
    }
    if (typeof window.renderAll !== 'function') {
      throw new Error('window.renderAll not found — bridge missing or page not booted');
    }
    const enriched = window.enrichEventWithImpact(a);
    window.ALERTS = (window.ALERTS || []).concat([enriched]);
    window.renderAll();
    return enriched.relevanceTier || null;
  }, alert);
}

// TypeScript: declare the bridged globals so the spec compiles cleanly.
// These are set up by main.js's bridge; the spec only reads them.
declare global {
  interface Window {
    ALERTS: any[];
    STATE: any;
    COUNTRY_PRESENCE: any[];
    TRAVELERS: any[];
    enrichEventWithImpact: (a: any) => any;
    renderAll: () => void;
  }
}
