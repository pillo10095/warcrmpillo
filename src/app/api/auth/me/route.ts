import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 401 });
  const session = await getSessionUser(token);
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  const account = await prisma.account.findUnique({ where: { id: session.accountId } });
  return NextResponse.json({
    user: user ? { id: user.id, email: user.email, fullName: user.fullName } : null,
    account: account ? { id: account.id, name: account.name } : null,
    role: session.role,
  });
}
