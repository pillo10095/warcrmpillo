// ============================================================
// GET/POST/DELETE /api/openwa/config
//
// Manages the account's OpenWA gateway config (base URL + API key).
// The API key is encrypted with the same AES-256-GCM helper used
// for Meta tokens (encryption.ts) and never returned to the client.
// Session rows live under the same config and are returned alongside
// so the UI can render per-line status without a second round trip.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  try {
    const { accountId } = await requireRole('agent');

    const config = await prisma.openWAConfig.findUnique({
      where: { accountId },
      include: { sessions: true },
    });

    if (!config) {
      return NextResponse.json({
        configured: false,
        status: 'not_configured',
        sessions: [],
      });
    }

    return NextResponse.json({
      configured: true,
      api_url: config.apiUrl,
      status: config.status,
      connected_at: config.connectedAt,
      // api_key is intentionally omitted — never echo secrets back.
      sessions: config.sessions.map((s) => ({
        id: s.id,
        openwa_session_id: s.openwaSessionId,
        name: s.name,
        phone: s.phone,
        push_name: s.pushName,
        status: s.status,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');

    const body = await request.json();
    const { api_url, api_key } = body;

    if (!api_key || !api_url) {
      return NextResponse.json(
        { error: 'api_url and api_key are required' },
        { status: 400 }
      );
    }

    const apiUrl = String(api_url).trim();
    if (!/^https?:\/\//.test(apiUrl)) {
      return NextResponse.json(
        { error: 'api_url must be a valid http(s) URL' },
        { status: 400 }
      );
    }

    let encryptedKey: string;
    try {
      encryptedKey = encrypt(String(api_key));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown encryption error';
      return NextResponse.json(
        {
          error: `Failed to encrypt API key. Check ENCRYPTION_KEY: ${message}`,
        },
        { status: 500 }
      );
    }

    await prisma.openWAConfig.upsert({
      where: { accountId },
      create: {
        accountId,
        apiUrl,
        apiKey: encryptedKey,
      },
      update: {
        apiUrl,
        apiKey: encryptedKey,
        updatedAt: new Date(),
      },
    });

    console.log(
      `[openwa/config] config saved for account ${accountId} by user ${userId}`
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin');

    await prisma.openWAConfig.delete({ where: { accountId } }).catch(() => {
      // No row to delete is fine — idempotent reset.
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
