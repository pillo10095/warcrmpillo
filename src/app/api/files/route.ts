import { NextResponse } from "next/server";
import { saveFile } from "@/lib/storage/disk";
import { getSessionFromRequest } from "@/lib/auth/request";
import { MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";

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

/**
 * Hard ceiling on a single upload — shared with the client via
 * `MEDIA_MAX_BYTES` (16 MB, mirroring Meta's WhatsApp Cloud API caps for
 * video/audio/document). Kept in sync with `upload-media.ts` so the
 * client-side ceiling can never accept a file the server rejects.
 */
const MAX_FILE_BYTES = MEDIA_MAX_BYTES;

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
      { error: "File exceeds the 16 MB limit" },
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
