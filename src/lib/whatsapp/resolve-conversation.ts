// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The dashboard composer always has a `conversation_id` in hand. The
// public API doesn't — an external automation knows a *phone number*,
// not an internal UUID. This helper bridges that: given an E.164
// phone, it finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// It deliberately reuses the exact find-or-create logic the inbound
// webhook uses (the `findExistingContact` dedupe helper, the
// one-conversation-per-(account, contact) convention, the
// account_id-tenancy / user_id-audit split) so a contact created via
// the API is indistinguishable from one created by an inbound message.
//
// Prisma-backed (Task D): the `db` argument on the public signature is
// kept so not-yet-migrated callers keep compiling — it is ignored by
// this file; every query hits the `prisma` singleton, scoped by
// `accountId` (application-level RLS). The shared helpers
// (`findExistingContact`, `resolveAuditUserId`) are Prisma-backed too
// and accept the now-ignored client.
//
// Audit user: created rows need a NOT NULL `user_id`. As with the
// webhook (where there's no logged-in human either), we attribute
// them to the WhatsApp config owner — a stable account-level default.
// ============================================================

import { prisma } from '@/lib/db/prisma';

import { findExistingContact } from '@/lib/contacts/duplicate-lookup';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
export async function resolveConversationByPhone(
  db: unknown,
  accountId: string,
  phone: string,
  name?: string | null
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway.
  const config = await prisma.whatsAppConfig.findFirst({
    where: { accountId },
    select: { id: true },
  });
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // Audit user for created rows = the single account-wide default used
  // by every public-API write (see resolveAuditUserId), so a contact
  // created here is attributed identically to one created via
  // POST /api/v1/contacts. resolveAuditUserId throws ContactError only
  // if the owner can't be resolved — remap it to the send error family
  // the callers already handle.
  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated = false;

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    if (name && name !== existing.name) {
      await prisma.contact.update({
        where: { id: existing.id },
        data: { name, updatedAt: new Date() },
      });
    }
  } else {
    try {
      const created = await prisma.contact.create({
        data: {
          accountId,
          userId: ownerUserId,
          phone: sanitized,
          name: name || sanitized,
        },
        select: { id: true },
      });
      contactId = created.id;
      contactCreated = true;
    } catch (createErr) {
      // Lost a race against a concurrent inbound/API create — the
      // unique index (migration 022) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError(
            'db_error',
            'Failed to create contact',
            500
          );
        }
      } else {
        console.error(
          '[resolve-conversation] contact create error:',
          createErr
        );
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    }
  }

  // ---- conversation -------------------------------------------
  // One conversation per (account, contact) — same convention as the
  // webhook. Order oldest-first and take one row rather than
  // `.maybeSingle()`, which errors on ≥2 rows: if duplicates predate the
  // unique index (migration 036), we resolve to the canonical survivor
  // instead of falling through and creating yet another (issue #363).
  const conversationId = await findOrCreateConversationRow(
    db,
    accountId,
    contactId,
    ownerUserId
  );

  return { conversationId, contactId, contactCreated };
}

/**
 * Find (oldest-first) or create the single conversation for
 * `(accountId, contactId)`. Handles the unique-index race the same way
 * the inbound webhook does: on a P2002/23505 from a concurrent create,
 * re-resolve the winning row rather than failing the send.
 */
async function findOrCreateConversationRow(
  _db: unknown,
  accountId: string,
  contactId: string,
  ownerUserId: string
): Promise<string> {
  let existing: { id: string } | null;
  try {
    existing = await prisma.conversation.findFirst({
      where: { accountId, contactId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  } catch (findErr) {
    console.error('[resolve-conversation] conversation lookup error:', findErr);
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500);
  }

  if (existing) {
    return existing.id;
  }

  try {
    const created = await prisma.conversation.create({
      data: { accountId, userId: ownerUserId, contactId },
      select: { id: true },
    });
    return created.id;
  } catch (convErr) {
    if (isUniqueViolation(convErr)) {
      const raced = await prisma.conversation
        .findFirst({
          where: { accountId, contactId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
        .catch(() => null);
      if (raced) {
        return raced.id;
      }
    }
    console.error('[resolve-conversation] conversation create error:', convErr);
    throw new SendMessageError('db_error', 'Failed to create conversation', 500);
  }
}
