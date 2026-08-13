// ============================================================
// GET /api/openwa/messages/batch/[batchId]
//
// Polls the progress of a bulk-send batch on the OpenWA gateway.
// Agent role.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveOpenWAProvider, ProviderNotConfiguredError } from '@/lib/whatsapp/providers';

interface RouteContext {
  params: Promise<{ batchId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { accountId } = await requireRole('agent');
    const { batchId } = await ctx.params;

    let provider;
    try {
      provider = await resolveOpenWAProvider(accountId);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    let status;
    try {
      status = await provider.getBatchStatus(batchId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown OpenWA error';
      return NextResponse.json(
        { error: `OpenWA batch status failed: ${message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      batch_id: status.batchId,
      status: status.status,
      sent: status.sent,
      failed: status.failed,
      pending: status.pending,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
