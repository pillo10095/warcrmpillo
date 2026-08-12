import { prisma } from "@/lib/db/prisma";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";
import type { ExistingContact } from "./dedupe";

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 *
 * SERVER-ONLY: this module imports `prisma`, so it must never be
 * imported from a client component. Client entry points call it through
 * the `/api/contacts/duplicate` route instead.
 */
export async function findExistingContact(
  _db: unknown,
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const rows = await prisma.contact.findMany({
    where: { accountId, phone: { endsWith: suffix } },
    select: { id: true, phone: true, name: true },
  });

  return rows.find((c) => phonesMatch(c.phone, phone)) ?? null;
}