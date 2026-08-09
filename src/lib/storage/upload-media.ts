/**
 * Shared media-upload helper for the dashboard's file-upload UI.
 *
 * Replaces the Supabase Storage client-side uploads with a POST to our
 * own `/api/files` route handler, which resolves the session server-side
 * and persists the bytes to local disk via `saveFile` (`@/lib/storage/disk`).
 *
 * The returned `publicUrl` is the app-relative `/api/files/<id>` URL, which
 * the browser can fetch same-origin (session cookie auth). The `path` is the
 * file record id, used by callers to GC a staged upload via
 * `deleteAccountMedia` (which now hits the DELETE `/api/files/<id>` route).
 *
 * Callers may keep passing a bucket name — it is accepted for
 * compatibility and ignored by the server, which scopes the record to the
 * session's account itself.
 */

/** 16 MB — retained so the flows builder's client-side ceiling stays put. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Per-kind upload ceilings that mirror Meta's WhatsApp Cloud API caps so
 * a file the server would accept but Meta would reject is caught
 * client-side BEFORE upload.
 */
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

/**
 * Build the account-scoped object path for an upload. Retained for
 * backward compatibility with existing callers and tests; the disk
 * storage backend derives its own layout and this helper is no longer
 * used by the upload path.
 *
 * - `basename` is stripped of its extension, lower-cased non-safe chars
 *   are collapsed to `_`, and it's capped at 40 chars (falls back to
 *   "file" when empty).
 */
export function buildMediaPath(
  accountId: string,
  fileName: string,
  now: number = Date.now(),
): string {
  // Only treat the trailing segment as an extension when there's a real
  // one — a bare name like "README" has no extension and falls back to
  // "bin" rather than becoming "readme".
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split(".").pop()!.toLowerCase() : "bin";
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 40) || "file";
  return `account-${accountId}/${now}-${safeBase}.${ext}`;
}

export interface UploadAccountMediaResult {
  /** App-relative URL Meta/browser can fetch (`/api/files/<id>`). */
  publicUrl: string;
  /** File record id — used to GC the upload via `deleteAccountMedia`. */
  path: string;
}

/**
 * Upload a file to the local-disk store and return its app-relative URL.
 * Throws with a user-facing message on auth / upload failure — callers
 * surface it via a toast.
 *
 * Size validation is the caller's responsibility (limits can differ per
 * feature); `MEDIA_MAX_BYTES` is exported for the common case.
 */
export async function uploadAccountMedia(
  bucket: string,
  file: File,
): Promise<UploadAccountMediaResult> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/files", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message =
      data && typeof (data as { error?: string }).error === "string"
        ? (data as { error: string }).error
        : `Upload failed (HTTP ${res.status}).`;
    throw new Error(message);
  }

  const data = (await res.json()) as { url: string; path: string };
  return { publicUrl: data.url, path: data.path };
}

/**
 * Delete a previously-uploaded file. Used to GC media that was staged
 * (uploaded) but never sent — a cancelled draft or a failed Meta send —
 * so abandoned attachments don't accumulate on disk.
 *
 * Best-effort: callers fire-and-forget and swallow errors (a missed
 * delete is a storage nit, not something to surface to the user).
 */
export async function deleteAccountMedia(
  bucket: string,
  id: string,
): Promise<void> {
  const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete file (HTTP ${res.status}).`);
}
