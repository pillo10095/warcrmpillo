import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

function safeExtension(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "video/mp4": "mp4", "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

export interface SaveFileInput {
  accountId: string;
  originalName: string;
  mime: string;
  buffer: Buffer;
}

export async function saveFile({ accountId, originalName, mime, buffer }: SaveFileInput) {
  const id = randomUUID();
  const ext = safeExtension(mime);
  const diskName = `${id}.${ext}`;
  const accountDir = path.join(UPLOAD_DIR, accountId);
  const diskPath = path.join(accountDir, diskName);

  await mkdir(accountDir, { recursive: true });
  await writeFile(diskPath, buffer);

  const record = await prisma.fileRecord.create({
    data: { id, accountId, originalName, mime, size: buffer.length, diskPath },
  });

  return { id: record.id, url: `/api/files/${record.id}` };
}

export async function deleteFile(id: string, accountId: string): Promise<void> {
  const record = await prisma.fileRecord.findUnique({ where: { id } });
  if (!record || record.accountId !== accountId) return;
  await rm(record.diskPath, { force: true }).catch(() => {});
  await prisma.fileRecord.delete({ where: { id } }).catch(() => {});
}
