import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Auth is required — we resolve the caller's
 * account_id and dispatch over the account's automations.
 */
export async function POST(request: Request) {
  // Firing automations sends outbound WhatsApp — a write action. Require
  // at least `agent`; a viewer must not be able to trigger sends.
  let accountId: string
  try {
    const ctx = await requireRole('agent')
    accountId = ctx.accountId

    // Each POST fires real Meta sends, so cap the rate the same way the
    // manual-send route does — a scripted loop could otherwise burn the
    // account's WhatsApp throughput (and Meta's rate limits).
    const limit = checkRateLimit(`automation-engine:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type) {
    return NextResponse.json({ error: 'trigger_type required' }, { status: 400 })
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: body.trigger_type as AutomationTriggerType,
    contactId: body.contact_id ?? null,
    context: body.context ?? {},
  })

  return NextResponse.json({ ok: true })
}
