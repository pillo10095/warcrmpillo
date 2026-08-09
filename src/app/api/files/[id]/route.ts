import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { prisma } from "@/lib/db/prisma";
import { getSessionFromRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.fileRecord.findUnique({ where: { id } });
  if (!record || record.accountId !== session.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readFile(record.diskPath).catch(() => null);
  if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": record.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(buffer.length),
    },
  });
}
