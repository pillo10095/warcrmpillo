// ============================================================
// POST /api/openwa/session/[sessionId]/start
//
// Starts a session on the OpenWA gateway (initializes the WhatsApp
// connection → QR generation). Admin only.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { prisma } from '@/lib/db/prisma';
import { resolveOpenWAClient, ProviderNotConfiguredError } from '@/lib/whatsapp/providers';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
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

    let started;
    try {
      started = await client.startSession(session.openwaSessionId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown OpenWA error';

      // OpenWA auto-starts sessions on create (or a prior start already
      // brought the engine up). "already started" is not an error — the
      // session is live, so reflect its real status and continue.
      if (/already started/i.test(message)) {
        started = await client.getSession(session.openwaSessionId);
        return finishStarted(prisma, session.id, started.status);
      }

      return NextResponse.json(
        { error: `OpenWA start failed: ${message}` },
        { status: 502 }
      );
    }

    return finishStarted(prisma, session.id, started.status);
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function finishStarted(
  prisma: typeof import('@/lib/db/prisma').prisma,
  sessionId: string,
  status: string,
) {
  await prisma.openWASession.update({
    where: { id: sessionId },
    data: { status, updatedAt: new Date() },
  });

  return NextResponse.json({
    success: true,
    status,
  });
}
