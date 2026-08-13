// ============================================================
// GET/DELETE /api/openwa/session/[sessionId]
//
// GET   — refresh the session's live status from OpenWA and persist
//         it back to openwa_sessions, then return both.
// DELETE— stop the session on OpenWA (graceful disconnect) and
//         remove the local row. Admin only.
//
// `[sessionId]` is OUR openwa_sessions row id (uuid), not OpenWA's
// session id — the row carries `openwaSessionId` for the gateway call.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { prisma } from '@/lib/db/prisma';
import { resolveOpenWAClient, ProviderNotConfiguredError } from '@/lib/whatsapp/providers';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

async function loadLocalSession(accountId: string, sessionId: string) {
  const session = await prisma.openWASession.findFirst({
    where: { id: sessionId, config: { accountId } },
  });
  if (!session) return null;
  return session;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { accountId } = await requireRole('admin');
    const { sessionId } = await ctx.params;

    const session = await loadLocalSession(accountId, sessionId);
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

    let live;
    try {
      live = await client.getSession(session.openwaSessionId);
    } catch (err) {
      // Gateway unreachable — still return the locally stored state so
      // the UI can show a stale-but-useful badge.
      console.warn(
        `[openwa/session] live status fetch failed for ${session.openwaSessionId}:`,
        err
      );
      return NextResponse.json({
        id: session.id,
        name: session.name,
        status: session.status,
        phone: session.phone,
        push_name: session.pushName,
        live: false,
      });
    }

    // Persist the refreshed status.
    await prisma.openWASession.update({
      where: { id: session.id },
      data: {
        status: live.status,
        phone: live.phone ?? session.phone,
        pushName: live.pushName ?? session.pushName,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      id: session.id,
      name: live.name ?? session.name,
      status: live.status,
      phone: live.phone ?? null,
      push_name: live.pushName ?? null,
      engine_loaded: live.engineLoaded ?? false,
      live: true,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const { accountId } = await requireRole('admin');
    const { sessionId } = await ctx.params;

    const session = await loadLocalSession(accountId, sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Best-effort graceful stop on OpenWA; a dead gateway shouldn't
    // block deleting the local line.
    try {
      const client = await resolveOpenWAClient(accountId);
      await client.stopSession(session.openwaSessionId);
    } catch (err) {
      console.warn(
        `[openwa/session] stop during delete failed for ${session.openwaSessionId}:`,
        err
      );
    }

    await prisma.openWASession.delete({ where: { id: session.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
