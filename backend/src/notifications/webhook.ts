import { config } from '../config.js';
import { log } from '../log.js';

/**
 * Generic webhook notifier. Auto-detects the destination from the URL:
 *
 *   - hooks.slack.com/services/...   → Slack incoming webhook payload
 *   - events.pagerduty.com/v2/...    → PagerDuty Events API v2 payload
 *   - any other URL                  → generic JSON POST
 *
 * Set WEBHOOK_URL in .env. Empty/unset disables all notifications (logs only).
 */

export type Severity = 'info' | 'warning' | 'critical';

export interface NotifyArgs {
  title: string;
  body: string;
  severity?: Severity;
  /** Source ID, incident ID, etc. Used as PagerDuty dedup key. */
  dedupKey?: string;
  /** Optional URL to link from the alert (the dashboard or the source). */
  link?: string;
}

function isSlack(url: string): boolean {
  return url.includes('hooks.slack.com/');
}
function isPagerDuty(url: string): boolean {
  return url.includes('events.pagerduty.com');
}

function slackPayload(a: NotifyArgs) {
  const colorBySev = { info: '#1ce783', warning: '#facc15', critical: '#f87171' } as const;
  return {
    text: `*${a.title}*`,
    attachments: [{
      color: colorBySev[a.severity ?? 'warning'],
      text: a.body,
      ...(a.link ? { actions: [{ type: 'button', text: 'Open', url: a.link }] } : {}),
    }],
  };
}

function pagerDutyPayload(a: NotifyArgs) {
  // Events API v2 — service routing key must already be in the URL
  const sevMap = { info: 'info', warning: 'warning', critical: 'critical' } as const;
  return {
    routing_key: process.env.PAGERDUTY_ROUTING_KEY ?? '',  // optional: some setups put key in URL only
    event_action: 'trigger',
    dedup_key: a.dedupKey ?? a.title,
    payload: {
      summary: a.title,
      source: 'nr-safety-alerts',
      severity: sevMap[a.severity ?? 'warning'],
      custom_details: { body: a.body, link: a.link ?? '' },
    },
    links: a.link ? [{ href: a.link, text: 'Open' }] : [],
  };
}

export async function notify(args: NotifyArgs): Promise<void> {
  const url = config.webhookUrl;
  if (!url) {
    log.info({ alert: args }, 'notify.skipped (no WEBHOOK_URL configured)');
    return;
  }
  let body: unknown;
  if (isSlack(url))         body = slackPayload(args);
  else if (isPagerDuty(url)) body = pagerDutyPayload(args);
  else                       body = { ...args };

  try {
    const resp = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      log.warn({ status: resp.status, text: text.slice(0, 200) }, 'notify.http_error');
      return;
    }
    log.info({ title: args.title, dest: isSlack(url) ? 'slack' : isPagerDuty(url) ? 'pagerduty' : 'generic' }, 'notify.sent');
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'notify.failed');
  }
}
