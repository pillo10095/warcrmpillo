import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { findExistingContact } from '@/lib/contacts/duplicate-lookup';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const url = new URL(request.url);
    const phone = url.searchParams.get('phone')?.trim() ?? '';
    if (!phone) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 });
    }

    // Server-side dedupe lookup. The client form calls this instead of
    // importing the Prisma-backed helper directly, so Prisma never
    // enters the browser bundle.
    const contact = await findExistingContact(ctx.supabase, ctx.accountId, phone);

    return NextResponse.json({ contact });
  } catch (error) {
    return toErrorResponse(error);
  }
}