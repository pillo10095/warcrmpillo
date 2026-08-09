// ============================================================
// Shared contact logic for the public API (v1) contact endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/contacts` and
// `GET/PATCH /api/v1/contacts/{id}` share one serializer, one
// find-or-create (built on the same `findExistingContact` dedupe the
// webhook and send path use), and one tag-sync routine.
//
// Prisma-backed (Task B): the `db` argument on the public signatures is
// kept so not-yet-migrated consumers (messages / broadcasts routes,
// resolve-conversation, broadcast-core) keep compiling; the queries hit
// the `prisma` singleton directly and are explicitly scoped by
// `accountId` (application-level RLS).
// ============================================================

import type { Prisma } from '@prisma/client';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { prisma } from '@/lib/db/prisma';

/** Prisma include that embeds the contact's tags for serialization. */
export const CONTACT_SELECT: Prisma.ContactInclude = {
  contactTags: { include: { tag: true } },
};

export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

type RawTagJoin = { tag: { id: string; name: string; color: string } | null };

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

/** Flatten a `CONTACT_SELECT` row into the public contact shape. */
export function serializeContact(row: Record<string, unknown>): ApiContact {
  const joins = (row.contactTags as RawTagJoin[] | null | undefined) ?? [];
  return {
    id: row.id as string,
    phone: row.phone as string,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    avatar_url: (row.avatarUrl as string | null) ?? null,
    tags: joins
      .map((j) => j?.tag)
      .filter((t): t is NonNullable<RawTagJoin['tag']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

/**
 * Resolve the audit `user_id` for API-created rows — the SINGLE source
 * of truth used by every public-API write (contacts, messages,
 * broadcasts, resolve-conversation), so the same key's writes are
 * always attributed to the same human. API callers have no logged-in
 * user, so — like the inbound webhook — we attribute writes to the
 * **WhatsApp config owner** (the webhook's own convention). Contacts
 * can be created before WhatsApp is connected, so we fall back to the
 * account owner when there's no config yet.
 */
export async function resolveAuditUserId(
  _db: unknown,
  accountId: string
): Promise<string> {
  try {
    const config = await prisma.whatsAppConfig.findUnique({
      where: { accountId },
      select: { userId: true },
    });
    const configOwner = config?.userId;
    if (configOwner) return configOwner;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { ownerUserId: true },
    });
    const owner = account?.ownerUserId;
    if (!owner) {
      throw new ContactError('Account owner could not be resolved', 500);
    }
    return owner;
  } catch (error) {
    if (error instanceof ContactError) throw error;
    throw new ContactError('Account owner could not be resolved', 500);
  }
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/**
 * Find (by fuzzy phone match) or create a contact in `accountId`.
 * Returns the contact id and whether it was created. Reuses the shared
 * `findExistingContact` dedupe + unique-violation race backstop so an
 * API-created contact is indistinguishable from a webhook-created one.
 */
export async function findOrCreateContact(
  _db: unknown,
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  const sanitized = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitized)) {
    throw new ContactError(
      "'phone' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  const existing = await findExistingContact(_db, accountId, sanitized);
  if (existing) return { id: existing.id, created: false };

  try {
    const created = await prisma.contact.create({
      data: {
        accountId,
        userId: auditUserId,
        phone: sanitized,
        name: input.name ?? sanitized,
        email: input.email ?? null,
        company: input.company ?? null,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    // Lost a race against a concurrent create — the unique index
    // (account_id, phone_normalized) rejected the duplicate.
    // Re-resolve to the winner.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(_db, accountId, sanitized);
      if (raced) return { id: raced.id, created: false };
    }
    console.error('[api/v1/contacts] create error:', error);
    throw new ContactError('Failed to create contact', 500);
  }
}

/**
 * Replace a contact's tags to exactly match `tagNames` (case-
 * insensitive; missing tags are created). A no-op when `tagNames` is
 * undefined — pass `[]` to clear all tags. Reuses `resolveImportTagIds`
 * so API and CSV-import tag handling stay consistent.
 */
export async function setContactTags(
  _db: unknown,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIds(_db, {
    accountId,
    userId: auditUserId,
    tagNames,
    canCreateTags: true,
  });
  const desired = new Set(tagIdByKey.values());

  // Diff against the current joins rather than delete-all-then-insert:
  // a diff only touches tags that actually change, so a mid-operation
  // failure can never wipe tags that were meant to stay. Every write
  // is error-checked and surfaced as a ContactError (→ 500) instead of
  // being swallowed behind a misleading 200.
  let current: { tagId: string }[];
  try {
    current = await prisma.contactTag.findMany({
      where: { contactId },
      select: { tagId: true },
    });
  } catch {
    throw new ContactError('Failed to read contact tags', 500);
  }
  const existing = new Set(current.map((r) => r.tagId));

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    try {
      await prisma.contactTag.deleteMany({
        where: { contactId, tagId: { in: toRemove } },
      });
    } catch {
      throw new ContactError('Failed to update contact tags', 500);
    }
  }
  if (toAdd.length > 0) {
    for (const tagId of toAdd) {
      try {
        await addContactTagAndDispatch({
          db: _db,
          accountId,
          contactId,
          tagId,
        });
      } catch (error) {
        console.error('[api/v1/contacts] tag add failed:', error);
        throw new ContactError('Failed to update contact tags', 500);
      }
    }
  }
}

/** Fetch + serialize a single contact scoped to the account, or null. */
export async function getContactById(
  _db: unknown,
  accountId: string,
  contactId: string
): Promise<ApiContact | null> {
  try {
    const row = await prisma.contact.findFirst({
      where: { id: contactId, accountId },
      include: CONTACT_SELECT,
    });
    if (!row) return null;
    return serializeContact(row as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}
