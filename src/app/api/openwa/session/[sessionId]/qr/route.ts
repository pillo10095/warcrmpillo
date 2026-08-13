// ============================================================
// GET /api/openwa/session/[sessionId]/qr
//
// Returns the pairing QR (PNG data URL) for a session so the user
// can scan it with WhatsApp. Admin only — the QR authenticates the
// account line.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { prisma } from '@/lib/db/prisma';
import { resolveOpenWAClient, ProviderNotConfiguredError } from '@/lib/whatsapp/providers';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { accountId } = await requireRole('admin');
    const { sessionId } = await ctx.params;

    const session = await prisma.openWASession.findFirst({
      where: { id: sessionId, config: { accountId } },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    let client;
    try {
      client = await resolveOpenWAClient(accountId);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    let qr;
    try {
      qr = await client.getQr(session.openwaSessionId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown OpenWA error';
      return NextResponse.json(
        { error: `OpenWA QR fetch failed: ${message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      qr_code: qr.qrCode,
      status: qr.status,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
