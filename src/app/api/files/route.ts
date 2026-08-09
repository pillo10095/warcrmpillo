import { NextResponse } from "next/server";
import { saveFile } from "@/lib/storage/disk";
import { getSessionFromRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * MIME allowlist mirrors `safeExtension` in `@/lib/storage/disk.ts` — only
 * the media kinds the product can actually send (and the avatar pickers
 * accept) are persisted. Everything else is rejected before it touches
 * disk.
 */
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/ogg",
  "audio/mpeg",
  "video/mp4",
  "application/pdf",
]);

/** Hard ceiling on a single upload (10 MB) — independent of per-kind caps. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds the 10 MB limit" },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveFile({
    accountId: session.accountId,
    originalName: file.name,
    mime: file.type,
    buffer,
  });

  // `path` is the record id — the same shape `uploadAccountMedia` callers
  // relied on for GC (`deleteAccountMedia`) now feeds the DELETE endpoint.
  return NextResponse.json({ id: saved.id, url: saved.url, path: saved.id });
}
