// ============================================================
// POST /api/openwa/messages/bulk
//
// Enqueues a bulk-send batch on the account's OpenWA line (max 100
// recipients per batch, enforced by the gateway). Returns the batch
// id; poll /api/openwa/messages/batch/[batchId] for progress.
// Agent role — same send capability as the inbox.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveOpenWAProvider, ProviderNotConfiguredError } from '@/lib/whatsapp/providers';

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`openwa-bulk:${userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages must be a non-empty array of { to, text }' },
        { status: 400 }
      );
    }
    if (messages.length > 100) {
      return NextResponse.json(
        { error: 'OpenWA bulk is limited to 100 messages per batch' },
        { status: 400 }
      );
    }
    for (const m of messages) {
      if (!m?.to || typeof m.text !== 'string' || !m.text.trim()) {
        return NextResponse.json(
          { error: 'each message needs a non-empty "to" and "text"' },
          { status: 400 }
        );
      }
    }

    let provider;
    try {
      provider = await resolveOpenWAProvider(accountId);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    let result;
    try {
      result = await provider.sendBulk(
        messages.map((m) => ({ to: m.to, text: m.text }))
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown OpenWA error';
      return NextResponse.json(
        { error: `OpenWA bulk failed: ${message}` },
        { status: 502 }
      );
    }

    console.log(
      `[openwa/bulk] batch ${result.batchId} enqueued for account ${accountId} by user ${userId} (${result.totalMessages} messages)`
    );

    return NextResponse.json({
      success: true,
      batch_id: result.batchId,
      total_messages: result.totalMessages,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
