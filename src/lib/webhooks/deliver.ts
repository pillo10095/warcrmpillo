// ============================================================
// Outbound webhook delivery.
//
// `dispatchWebhookEvent` finds the account's active endpoints
// subscribed to an event, signs one JSON payload, and POSTs it to
// each in parallel. It is best-effort and never throws — callers fire
// it from the inbound webhook's `after()` block, where a failed
// delivery must not affect the 200 OK returned to Meta.
//
// Delivery semantics (documented in docs/public-api.md):
//   - At-most-once per event, single attempt with a short timeout.
//   - Each consecutive failure bumps `failure_count`; once it crosses
//     MAX_CONSECUTIVE_FAILURES the endpoint is auto-disabled
//     (`is_active = false`) so a dead sink stops being hit. A success
//     resets the counter and stamps `last_delivery_at`.
//   - Durable retry-with-backoff would need a queue/worker (a
//     follow-up); in-process retries inside `after()` would burn the
//     route's duration budget without a real durability guarantee.
// ============================================================

import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';

import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';

/** Per-endpoint HTTP timeout. Kept short — this runs in `after()`. */
export const DELIVERY_TIMEOUT_MS = 5000;

/** Auto-disable an endpoint after this many consecutive failures. */
export const MAX_CONSECUTIVE_FAILURES = 15;

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
}

/**
 * Deliver `event` (+ `data`) to every active endpoint of `accountId`
 * subscribed to it. Never throws.
 */
export async function dispatchWebhookEvent(
  accountId: string,
  event: WebhookEvent,
  data: unknown
): Promise<void> {
  try {
    const rows = await prisma.webhookEndpoint.findMany({
      where: { accountId, isActive: true },
      select: {
        id: true,
        url: true,
        secret: true,
        events: true,
      },
    });

    const subscribed = rows.filter((row) => {
      try {
        const events: unknown = JSON.parse(row.events);
        return (
          Array.isArray(events) &&
          events.some((e) => String(e) === event)
        );
      } catch {
        return false;
      }
    });
    if (subscribed.length === 0) return;

    // Sign the exact bytes we send so a receiver can recompute the
    // HMAC over the raw request body. `id` is a per-delivery uuid the
    // receiver can dedupe on (deliveries are at-least-once and may
    // repeat / arrive out of order).
    const payload = JSON.stringify({
      id: randomUUID(),
      event,
      occurred_at: new Date().toISOString(),
      account_id: accountId,
      data,
    });
    const tsSeconds = Math.floor(Date.now() / 1000);

    await Promise.allSettled(
      (subscribed as EndpointRow[]).map((row) =>
        deliverOne(row, event, payload, tsSeconds)
      )
    );
  } catch (err) {
    // Never let a delivery problem bubble into the webhook response.
    console.error('[webhooks] dispatch failed:', err);
  }
}

async function deliverOne(
  row: EndpointRow,
  event: WebhookEvent,
  payload: string,
  tsSeconds: number
): Promise<void> {
  // SSRF guard: refuse to POST to a host that resolves to a private /
  // loopback / link-local address. Counts as a failure so a
  // misconfigured internal URL surfaces and eventually auto-disables.
  if (!(await isDeliverableUrl(row.url))) {
    console.warn('[webhooks] refusing non-public delivery target for', row.id);
    await recordFailure(row);
    return;
  }

  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch (err) {
    // A row whose secret can't be decrypted can never produce a valid
    // signature — count it as a failure so it eventually auto-disables.
    console.error('[webhooks] secret decrypt failed for', row.id, err);
    await recordFailure(row);
    return;
  }

  try {
    const res = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': event,
        'X-Wacrm-Webhook-Id': row.id,
        'X-Wacrm-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, bypassing the SSRF check above. A 3xx is a
      // misconfiguration; treat it as a failure.
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`endpoint responded ${res.status}`);

    // Success: clear the failure streak.
    await prisma.webhookEndpoint.update({
      where: { id: row.id },
      data: { failureCount: 0, lastDeliveryAt: new Date() },
    });
  } catch (err) {
    console.warn(
      `[webhooks] delivery to ${row.id} failed:`,
      err instanceof Error ? err.message : err
    );
    await recordFailure(row);
  }
}

async function recordFailure(row: EndpointRow): Promise<void> {
  // Atomic increment + auto-disable at the threshold. Prisma's
  // `increment` does the update in a single statement, so two
  // deliveries to the same endpoint running concurrently (e.g.
  // conversation.created + message.received for one inbound message)
  // can't lose increments; a dead endpoint reliably reaches the
  // disable threshold.
  const updated = await prisma.webhookEndpoint.update({
    where: { id: row.id },
    data: { failureCount: { increment: 1 } },
    select: { failureCount: true },
  });
  if (updated.failureCount >= MAX_CONSECUTIVE_FAILURES) {
    await prisma.webhookEndpoint.update({
      where: { id: row.id },
      data: { isActive: false },
    });
  }
}