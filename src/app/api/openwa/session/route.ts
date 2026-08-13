// ============================================================
// POST /api/openwa/session
//
// Creates a new WhatsApp line on the account's OpenWA gateway:
//   1. builds a management client from the stored config,
//   2. POST /sessions on OpenWA (creates the line, no QR yet),
//   3. persists the returned session in openwa_sessions,
//   4. registers the account's webhook against that session so
//      inbound messages + status transitions reach us.
// Admin only — creating a line is account-wide configuration.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { prisma } from '@/lib/db/prisma';
import { resolveOpenWAClient, ProviderNotConfiguredError } from '@/lib/whatsapp/providers';

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }
    if (!/^[a-zA-Z0-9-]{3,50}$/.test(name)) {
      return NextResponse.json(
        {
          error: 'name must be 3-50 chars, letters/numbers/hyphens only',
        },
        { status: 400 }
      );
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

    let created;
    try {
      created = await client.createSession(name);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown OpenWA error';
      return NextResponse.json(
        { error: `OpenWA create session failed: ${message}` },
        { status: 502 }
      );
    }

    const session = await prisma.openWASession.create({
      data: {
        configId: (await prisma.openWAConfig.findUnique({
          where: { accountId },
          select: { id: true },
        }))!.id,
        openwaSessionId: created.id,
        name: created.name,
        phone: created.phone ?? null,
        pushName: created.pushName ?? null,
        status: created.status ?? 'created',
      },
    });

    // Register the inbound webhook for this session so messages and
    // status events reach /api/openwa/webhook.
    try {
      await client.registerWebhook({
        sessionId: created.id,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? ''}/api/openwa/webhook`,
        events: [
          'message.received',
          'message.ack',
          'message.failed',
          'session.status',
          'session.authenticated',
          'session.disconnected',
        ],
        secret: process.env.OPENWA_WEBHOOK_SECRET,
      });
    } catch (err) {
      console.warn(
        `[openwa/session] webhook registration failed for ${created.id}:`,
        err
      );
    }

    console.log(
      `[openwa/session] session "${name}" created for account ${accountId} by user ${userId}`
    );

    return NextResponse.json(
      {
        success: true,
        session: {
          id: session.id,
          openwa_session_id: session.openwaSessionId,
          name: session.name,
          status: session.status,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
